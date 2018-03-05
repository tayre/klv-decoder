/*
 * @author Tom Ayre <ayre.tom+github@gmail.com>
 */
Cesium.BingMapsApi.defaultKey = "AhI0NfRpiC24Gpc_LkSO2rnAQFoeyLkKKJcW9mhJvWeey_fw3gc7_KFL2T0BHv4E"

$(document).ready(function() {

    var websocket_url = "ws://" + document.location.hostname + ":8082/";
    var player = new JSMpeg.Player(websocket_url, {
        audio: false,
        canvas: document.getElementById("video-canvas"),
        klvelement: document.getElementById("klv-output")
    });

    // Setup cesium container
    CesiumViewer = new Cesium.Viewer("cesiumContainer", {
        timeline: false,
        animation: false,
        baseLayerPicker: false,
        vrButton: true,
        homeButton: false,
        shadows: true,
        terrainShadows: Cesium.ShadowMode.ENABLED,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        geocoder: false
    });

    var options = {}

    // Only the compass will show on the map
    options.enableCompass = true;
    options.enableZoomControls = false;
    options.enableDistanceLegend = true;
    CesiumViewer.extend(Cesium.viewerCesiumNavigationMixin, options);

    CesiumViewer.scene.debugShowFramesPerSecond = true;
    CesiumViewer.scene.globe.depthTestAgainstTerrain = true;
    CesiumViewer.scene.globe.maximumScreenSpaceError = 5; // higher values better performance, less quality
    // CesiumViewer.scene._screenSpaceCameraController.minimumCollisionTerrainHeight = 0.5

    // Older browsers do not support WebGL video textures,
    CesiumViewer.scene.renderError.addEventListener(function() {
        if (!videoElement.paused) {
            videoElement.pause();
        }
        CesiumViewer.cesiumWidget.showErrorPanel("This browser does not support cross-origin WebGL video textures.", "", "");
    });

    UAV.attachEventHandlers();
    UAV.bingSatMaps();
    UAV.enableTerrain();

    var options = {
        duration: 0,
        easingFunction: Cesium.EasingFunction.LINEAR_NONE,
        destination: Cesium.Cartesian3.fromDegrees(-122.4769744567931, 37.810634592459834, 25),
    }

    CesiumViewer.camera.flyTo(options);

});

var UAV = {
    interval: 0,
    INITIAL_FLY_IN: true,
    CURRENT_BASE_LAYER: null,
    WEATHER_LAYER: null,
    GRID_LAYER: null,
    TIME_OUT: 1000,
    UAV_ENTITY: null,
    GEOID_HEIGHT: 0,
    FOV_FUDGE: 0,

    // Update Telemetry HTML output
    updateTelemetry: function(data) {
        var payload = data.payload;

        var platform_tail_number = payload.platform_tail_number.value;
        var altitude = payload.sensor_true_altitude.value + UAV.GEOID_HEIGHT;
        var latitude = payload.sensor_latitude.value;
        var longitude = payload.sensor_longitude.value;

        var roll = payload.platform_roll_angle.value;
        var pitch = payload.sensor_relative_elevation_angle.value;
        var yaw = payload.platform_heading_angle.value + payload.sensor_relative_azimuth_angle.value;

        var result = [];
        result.push(platform_tail_number);
        result.push("Altitude: " + altitude + "m");
        result.push("Camera Pitch: " + pitch);
        result.push("Camera Yaw: " + yaw);
        result.push(latitude + "," + longitude);
        $("#telemetry").html(result.join("<br/>"));
    },

    // Update camera position
    updateFPV: function(data) {
        var payload = data.payload

        var latitude = payload.sensor_latitude.value;
        var longitude = payload.sensor_longitude.value;

        /* 
         * Ideally we would get sensor ellipsoid height (Tag 75), but instead we are getting sensor true altitude measured from MSL.
         * Cesium uses height above ellipsoid (HAE) for altitude, so we need to convert.
         * 
         * HAE = N + H where N = geoid undulation (height of the geoid above the ellipsoid) H = orthometric height, roughly the height above MSL.
         * Geoid height above WGS84 using EGM2008 for 575 Kumpf Drive is -36.2835 (https://geographiclib.sourceforge.io/cgi-bin/GeoidEval?input=43.504001%2C+-80.530135&option=Submit)
         * 
         * There is a NodeJS implementation of GeographicLib, so we could create a simple server to return heights given lat/long input.
         * For now, we will just hardcode for local demos.
         * 
         * After conducting an actual flight it looks like sensor_true_altitude is actually HAE.
         */
        var altitude = payload.sensor_true_altitude.value + UAV.GEOID_HEIGHT;

        var camera_roll = 0; // Cesium.Math.toRadians(payload.platform_roll_angle.value + payload.sensor_relative_roll_angle.value);
        var camera_pitch = Cesium.Math.toRadians(payload.sensor_relative_elevation_angle.value);
        var camera_yaw = Cesium.Math.toRadians(payload.platform_heading_angle.value + payload.sensor_relative_azimuth_angle.value);

        var options = {

            duration: 1,
            easingFunction: Cesium.EasingFunction.LINEAR_NONE,
            destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude),
            orientation: {
                roll: camera_roll,
                pitch: camera_pitch,
                heading: camera_yaw
            }
        }

        // HDZOOM is 71.8 degrees
        CesiumViewer.camera.frustum.fov = Cesium.Math.toRadians(payload.sensor_horizontal_fov.value + UAV.FOV_FUDGE)
        CesiumViewer.camera.flyTo(options);
    },

    // Update model position
    updateModel: function(data) {
        CesiumViewer.trackedEntity = UAV.UAV_ENTITY;

        var payload = data.payload;

        var date = payload.unix_time_stamp.value;

        var latitude = payload.sensor_latitude.value;
        var longitude = payload.sensor_longitude.value;
        var altitude = payload.sensor_true_altitude.value + UAV.GEOID_HEIGHT;

        var aircraft_roll = 0;
        Cesium.Math.toRadians(payload.platform_roll_angle.value); //roll seems wrong
        var aircraft_pitch = 0;
        Cesium.Math.toRadians(payload.platform_pitch_angle.value);
        var aircraft_yaw = Cesium.Math.toRadians(payload.platform_heading_angle.value);

        var position = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude)
        var hpr = new Cesium.HeadingPitchRoll(aircraft_yaw, aircraft_pitch, aircraft_roll);
        var quant = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

        // var time = Cesium.JulianDate.now(); // we can either use the current time, or the time metadata was created
        var time = Cesium.JulianDate.fromDate(date);

        // whenever we receive a new position, add it to the property
        UAV.UAV_ENTITY.orientation.addSample(time, quant);
        UAV.UAV_ENTITY.position.addSample(time, position);
    },


    createModel: function(url) {
        var positionProperty = new Cesium.SampledPositionProperty(); // could also do new Cesium.SampledProperty(PositionProperty)

        // We will create a sampled position for the property, and addSamples as we receive the data
        positionProperty.setInterpolationOptions({
            interpolationDegree: 3,
            interpolationAlgorithm: Cesium.LinearApproximation
        });

        // Gets or sets the amount of time to extrapolate forward before the property becomes undefined. A value of 0 will extrapolate forever.
        positionProperty.forwardExtrapolationDuration = 0;
        positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE

        var orientationProperty = new Cesium.SampledProperty(Cesium.Quaternion);
        orientationProperty.setInterpolationOptions({
            interpolationAlgorithm: Cesium.LinearApproximation
        });

        orientationProperty.forwardExtrapolationDuration = 0;
        orientationProperty.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE

        var modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(-75.62898254394531, 40.02804946899414, 0.0));

        CesiumViewer.entities.removeAll();

        UAV.UAV_ENTITY = CesiumViewer.entities.add({
            name: url,

            position: positionProperty,
            orientation: orientationProperty,

            model: {
                uri: url,
            }
        });
    },

    removeBaseLayers: function() {
        var layers = CesiumViewer.scene.imageryLayers;
        if (typeof UAV.CURRENT_BASE_LAYER !== "undefined") {
            layers.remove(UAV.CURRENT_BASE_LAYER);
        }
    },

    bingSatMaps: function() {
        var layers = CesiumViewer.scene.imageryLayers;
        UAV.removeBaseLayers();

        UAV.CURRENT_BASE_LAYER = layers.addImageryProvider(new Cesium.BingMapsImageryProvider({
            url: "https://dev.virtualearth.net",
            mapStyle: Cesium.BingMapsStyle.AERIAL_WITH_LABELS
        }));

        layers.lowerToBottom(UAV.CURRENT_BASE_LAYER);
        layers.raise(UAV.CURRENT_BASE_LAYER);
    },

    arcGISstreetMaps: function() {
        var layers = CesiumViewer.scene.imageryLayers;
        UAV.removeBaseLayers();

        UAV.CURRENT_BASE_LAYER = layers.addImageryProvider(new Cesium.ArcGisMapServerImageryProvider({
            url: "http://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer"
        }));

        layers.lowerToBottom(UAV.CURRENT_BASE_LAYER);
        layers.raise(UAV.CURRENT_BASE_LAYER);
    },

    openStreetMaps: function() {
        var layers = CesiumViewer.scene.imageryLayers;
        UAV.removeBaseLayers();

        UAV.CURRENT_BASE_LAYER = layers.addImageryProvider(Cesium.createOpenStreetMapImageryProvider());
        layers.lowerToBottom(UAV.CURRENT_BASE_LAYER);
        layers.raise(UAV.CURRENT_BASE_LAYER);
    },

    addWeatherLayer: function() {
        var layers = CesiumViewer.scene.imageryLayers;
        UAV.WEATHER_LAYER = layers.addImageryProvider(new Cesium.WebMapServiceImageryProvider({
            url: "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi?",
            layers: "nexrad-n0r",
            credit: "Radar data courtesy Iowa Environmental Mesonet",
            parameters: {
                transparent: "true",
                format: "image/png"
            },
            proxy: new Cesium.DefaultProxy("/proxy/")
        }));
        UAV.WEATHER_LAYER.alpha = 0.5;
    },

    removeWeatherLayer: function() {
        CesiumViewer.scene.imageryLayers.remove(UAV.WEATHER_LAYER);
    },

    addGridLayer: function() {
        var layers = CesiumViewer.scene.imageryLayers;
        UAV.GRID_LAYER = layers.addImageryProvider(new Cesium.GridImageryProvider());
        UAV.GRID_LAYER.alpha = 0.2
    },

    removeGridLayer: function() {
        CesiumViewer.scene.imageryLayers.remove(UAV.GRID_LAYER);
    },

    centreVideo: function(centre) {
        var video_canvas = $("#video-canvas");
        if (centre) {
            video_canvas.addClass("centre")
        } else {
            video_canvas.removeClass("centre")
        }
    },

    showVideo: function(show) {
        var video_canvas = $("#video-canvas");
        if (show) {
            video_canvas.removeClass("hide");
        } else {
            video_canvas.addClass("hide");
        }
    },

    enableTerrain: function() {
        var terrainProvider = new Cesium.CesiumTerrainProvider({
            url: "https://assets.agi.com/stk-terrain/v1/tilesets/world/tiles",
            requestWaterMask: false
        });
        CesiumViewer.terrainProvider = terrainProvider;
    },

    disableTerrain: function() {
        var terrainProvider = new Cesium.EllipsoidTerrainProvider({})
        CesiumViewer.terrainProvider = terrainProvider;
    },

    startFPVMode: function() {
        var klv = document.getElementById("klv-output");
        klv.addEventListener("klv", UAV.callback_fpv_mode);
    },

    stopFPVMode: function() {
        var klv = document.getElementById("klv-output");
        klv.removeEventListener("klv", UAV.callback_fpv_mode);
    },

    callback_fpv_mode: function(e) {
        UAV.updateTelemetry(e.detail);
        UAV.updateFPV(e.detail);
    },

    startFollowMode: function() {
        UAV.createModel("data/models/sample_uas.glb");
        var klv = document.getElementById("klv-output");
        klv.addEventListener("klv", UAV.callback_follow_mode);
    },

    stopFollowMode: function() {
        var klv = document.getElementById("klv-output");
        klv.removeEventListener("klv", UAV.callback_follow_mode);
    },

    callback_follow_mode: function(e) {
        UAV.updateTelemetry(e.detail);
        UAV.updateModel(e.detail);
    },

    zoomToFlyer: function(e) {
        CesiumViewer.flyTo(UAV.UAV_ENTITY);
    },

    attachEventHandlers: function() {
        $("#camera_options :input").change(function() {

            UAV.stopFPVMode();
            UAV.stopFollowMode();
            CesiumViewer.trackedEntity = undefined;

            var val = $(this).attr("id");

            switch (val) {
                case "fpv_cam":
                    UAV.startFPVMode();
                    break;
                case "follow_cam":
                    UAV.startFollowMode();
                    break;
                case "free_cam":
                    break;
            }
        });

        $("#zoom_to_flyer").click(function() {
            UAV.zoomToFlyer();
        });

        $("#basemap_options :input").change(function() {
            var val = $(this).attr("id");
            switch (val) {
                case "sat_base_layer": // bing maps with labels
                    UAV.bingSatMaps();
                    break;

                case "street_base_layer": // arcgis street maps
                    UAV.arcGISstreetMaps();
                    break;

                case "open_street_base_layer": // osm maps
                    UAV.openStreetMaps();
                    break;
            }
        });

        var weather_checkbox = $("input#weather_checkbox");
        weather_checkbox.change(function() {
            if (weather_checkbox.is(":checked")) {
                UAV.addWeatherLayer();
            } else {
                UAV.removeWeatherLayer();
            }
        });

        var grid_checkbox = $("input#grid_checkbox");
        grid_checkbox.change(function() {
            if (grid_checkbox.is(":checked")) {
                UAV.addGridLayer();
            } else {
                UAV.removeGridLayer();
            }
        });

        var terrain_checkbox = $("input#terrain_checkbox");
        terrain_checkbox.change(function() {
            if (terrain_checkbox.is(":checked")) {
                UAV.enableTerrain();
            } else {
                UAV.disableTerrain();
            }
        });

        var centrevideo_checkbox = $("input#centrevideo_checkbox");
        centrevideo_checkbox.change(function() {
            if (centrevideo_checkbox.is(":checked")) {
                UAV.centreVideo(true);
            } else {
                UAV.centreVideo(false);
            }
        });

        var showvideo_checkbox = $("input#showvideo_checkbox")
        showvideo_checkbox.change(function() {
            if (showvideo_checkbox.is(":checked")) {
                UAV.showVideo(true);
            } else {
                UAV.showVideo(false);
            }
        });
    }
}