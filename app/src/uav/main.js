/* UAV video/telemetry integration. The decoder emits ordinary `klv` events. */
'use strict';
window.addEventListener('DOMContentLoaded', function() {
    const status = document.getElementById('status');
    const params = new URLSearchParams(location.search);
    const wsUrl = params.get('stream') || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname}:8082/`;
    const output = document.getElementById('klv-output');
    const canvas = document.getElementById('video-canvas');
    const viewer = new Cesium.Viewer('cesiumContainer', {
        baseLayer: false, baseLayerPicker: false, geocoder: false, shouldAnimate:true,
        timeline: false, animation: false, homeButton: false,
        navigationHelpButton: false, sceneModePicker: false,
        selectionIndicator: false, infoBox: false,
        terrainProvider: new Cesium.EllipsoidTerrainProvider()
    });
    // Natural Earth imagery ships with Cesium; no token or network is needed.
    function setMap(name) {
        let provider;
        if (name === 'osm') provider = new Cesium.OpenStreetMapImageryProvider({url:'https://tile.openstreetmap.org/'});
        else if (name === 'satellite' || name === 'street') provider = new Cesium.UrlTemplateImageryProvider({
            url:`https://server.arcgisonline.com/ArcGIS/rest/services/${name === 'street' ? 'World_Street_Map' : 'World_Imagery'}/MapServer/tile/{z}/{y}/{x}`,
            credit:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'});
        else provider = Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'), {maximumLevel:2});
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.add(Cesium.ImageryLayer.fromProviderAsync(Promise.resolve(provider)));
        document.getElementById('grid').checked = false;
        grid = null;
        document.getElementById('weather').checked = false;
        weather = null;
    }
    let grid = null, weather = null;
    setMap('local');
    viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(-80.53,43.50,2500)});
    const position = new Cesium.SampledPositionProperty();
    const orientation = new Cesium.SampledProperty(Cesium.Quaternion);
    for (const property of [position, orientation]) {
        property.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
        property.forwardExtrapolationDuration = 5;
    }
    const aircraft = viewer.entities.add({
        name:'UAV', position, orientation, viewFrom:new Cesium.Cartesian3(-120,-120,100),
        model:{uri:'data/models/sample_uas.glb', minimumPixelSize:40, maximumScale:100},
        point:{pixelSize:8, color:Cesium.Color.YELLOW}
    });
    let mode = 'free', last = null;
    const value = (payload, name) => payload[name]?.value ?? null;
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    function update(data) {
        const p = data.payload;
        const lat = value(p,'sensor_latitude'), lon = value(p,'sensor_longitude');
        // HAE is preferred. MSL needs the user-supplied local geoid correction.
        const hae = value(p,'sensor_ellipsoid_height');
        const msl = value(p,'sensor_true_altitude');
        const correction = Number(params.get('geoidHeight') || 0);
        const altitude = finite(hae) ? hae : finite(msl) ? msl + correction : null;
        const heading = value(p,'platform_heading_angle');
        const pitch = value(p,'platform_pitch_angle');
        const roll = value(p,'platform_roll_angle');
        document.getElementById('telemetry').textContent = [
            value(p,'platform_tail_number') || 'UAV',
            `Latitude: ${lat ?? '—'}  Longitude: ${lon ?? '—'}`,
            `Altitude: ${altitude === null ? '—' : altitude.toFixed(1) + ' m'}${finite(hae) ? ' HAE' : ' (MSL + geoid offset)'}`,
            `Heading: ${heading ?? '—'}  Pitch: ${pitch ?? '—'}  Roll: ${roll ?? '—'}`
        ].join('\n');
        status.textContent = 'Receiving telemetry';
        if (![lat, lon, altitude].every(finite)) return;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        const point = Cesium.Cartesian3.fromDegrees(lon, lat, altitude);
        // Use receipt time so old recordings are visible against the live viewer clock.
        const now = Cesium.JulianDate.now();
        viewer.clock.currentTime = now;
        position.addSample(now, point);
        orientation.addSample(now, Cesium.Transforms.headingPitchRollQuaternion(point,
            new Cesium.HeadingPitchRoll(...[heading, pitch, roll].map(v => Cesium.Math.toRadians(finite(v) ? v : 0)))));
        const cutoff = Cesium.JulianDate.addSeconds(now, -60, new Cesium.JulianDate());
        position.removeSamples(new Cesium.TimeInterval({start:Cesium.JulianDate.MINIMUM_VALUE,stop:cutoff}));
        orientation.removeSamples(new Cesium.TimeInterval({start:Cesium.JulianDate.MINIMUM_VALUE,stop:cutoff}));
        document.getElementById('focus-flyer').disabled = false;
        last = {point, p, heading};
        if (mode === 'fpv') updateFPV();
    }
    function updateFPV() {
        if (!last) return;
        const elevation = value(last.p,'sensor_relative_elevation_angle');
        const azimuth = value(last.p,'sensor_relative_azimuth_angle');
        const fov = value(last.p,'sensor_horizontal_fov');
        if (finite(fov) && fov > 0 && fov < 180) viewer.camera.frustum.fov = Cesium.Math.toRadians(fov);
        viewer.camera.setView({destination:last.point, orientation:{
            heading:Cesium.Math.toRadians((last.heading || 0) + (azimuth || 0)),
            pitch:Cesium.Math.toRadians(elevation || 0), roll:0}});
    }
    output.addEventListener('klv', e => update(e.detail));
    const player = new JSMpeg.Player(wsUrl, {audio:false,canvas,klvelement:output});
    window.UAV = {viewer, player, aircraft};
    document.querySelector('#tools a').href = 'view-stream.html' + location.search;
    player.source.socket.addEventListener('open', () => {status.textContent='Connected; waiting for telemetry…';});
    player.source.socket.addEventListener('close', () => {status.textContent='Stream disconnected; reconnecting…';});
    document.getElementById('camera-mode').addEventListener('change', e => {
        mode = e.target.value;
        viewer.trackedEntity = mode === 'follow' ? aircraft : undefined;
        if (mode === 'fpv') updateFPV();
        else viewer.camera.frustum.fov = Cesium.Math.PI_OVER_THREE;
    });
    document.getElementById('map-layer').addEventListener('change', e => setMap(e.target.value));
    document.getElementById('grid').addEventListener('change', e => {
        if (e.target.checked) grid = viewer.imageryLayers.addImageryProvider(new Cesium.GridImageryProvider());
        else if (grid) { viewer.imageryLayers.remove(grid); grid=null; }
    });
    document.getElementById('weather').addEventListener('change', e => {
        if (e.target.checked) weather = viewer.imageryLayers.addImageryProvider(new Cesium.WebMapServiceImageryProvider({
            url:'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi', layers:'nexrad-n0r',
            credit:'Radar data courtesy Iowa Environmental Mesonet', parameters:{transparent:true,format:'image/png'}}));
        else if (weather) {viewer.imageryLayers.remove(weather);weather=null;}
    });
    const terrain = document.getElementById('terrain');
    terrain.disabled = !params.has('terrainUrl');
    terrain.addEventListener('change', async () => {
        if (!terrain.checked) {viewer.terrainProvider=new Cesium.EllipsoidTerrainProvider();return;}
        try {
            const provider=await Cesium.CesiumTerrainProvider.fromUrl(params.get('terrainUrl'));
            if (terrain.checked) viewer.terrainProvider=provider;
        } catch {terrain.checked=false;status.textContent='Terrain unavailable; using the ellipsoid.';}
    });
    document.getElementById('show-video').addEventListener('change', e => {canvas.hidden = !e.target.checked;});
    document.getElementById('centre-video').addEventListener('change', e => {canvas.classList.toggle('centre',e.target.checked);});
    document.getElementById('focus-flyer').addEventListener('click', () => {if (last) viewer.flyTo(aircraft);});
    window.addEventListener('pagehide', () => {player.destroy(); viewer.destroy();}, {once:true});
});
