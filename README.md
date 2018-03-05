This sample application was constructed after hours as an exercise to understand how video data streams can be sent an quadcopter camera to a web browser.  
This [page](http://impleotv.com/2017/02/17/klv-encoded-metadata-in-stanag-4609-streams/) provides a good primer on [KLV](https://en.wikipedia.org/wiki/KLV) encoded data in [STANAG 4609](http://www.gwg.nga.mil/misb/docs/nato_docs/STANAG_4609_Ed3.pdf).

Once we can read incoming metadata in the browser, we can do interesting things such as displaying our UAV in [Cesium](https://github.com/AnalyticalGraphicsInc/cesium), which is a JavaScript library for creating WebGL globes and time-dynamic content (i.e, a flying SkyRanger!)

In order for this to be compelling we need to minimize video latency from the base station to the browser.  The [JSMpeg](https://github.com/phoboslab/jsmpeg) project does a lot of the heavy lifting for getting the mpeg transport stream to the client, and rendering the video (and mp2 audio if present). We extend this project by adding a KLV decoder, and a simple rendering of the decoded data as JSON. 

TL;DR jump to the [demo videos](#demoarea).

# Setup

JSMpeg comes with a websocket server, that accepts a mpeg-ts source and serves it via ws to all connecting browsers. JSMpeg then reads this transport stream passing it as a source to the demuxer, which in turn passes it to the decoder.

We also have a small node webserver that [is packaged with Cesium](https://github.com/AnalyticalGraphicsInc/cesium/blob/master/server.js) to serve static assets. This server nicely handles CORS requests to other domains (such as map or terrain providers). Nginx or any other webserver could easily be used instead.

To establish a stream from the Flyer to the websocket server, we [map](https://trac.ffmpeg.org/wiki/Map) our video and data feeds. Since JSMpeg only supports playback of mpeg1, we need to be explicit in our codec choice as well.

```bash
ffmpeg -i rtsp://{camera_source_url} -map: 0:0 -map 0:1 -f mpegts -codec:v mpeg1video -b:v 800k -r 24 -s 800:600 http://127.0.0.1:8081/secretkey
```
This is obviously using a hd-zoom stream, but we could extend this to other payload RTSP feeds.

As noted in the JSMpeg [docs](https://github.com/phoboslab/jsmpeg/blob/master/src/jsmpeg.js), the [player](app_url/src/jsmpeg/player.js#L46) sets up the connections between the source, demuxer, decoders, and renderer. In order to extend JSMpeg to accept a data stream we subscribe the demuxer to the correct stream identifier (per the STANAG spec it is _0xBD_), implement the decoder, and then send the resultant data to the renderer. 

```javascript
var data = new JSMpeg.Decoder.Metadata();
this.demuxer.connect(JSMpeg.Demuxer.TS.STREAM.PRIVATE_1, data);
var klvOut = new JSMpeg.DataOutput.KLV();
data.connect(klvOut);
```
# Details 
### Decoder
The decoder is implemented by [metadata.js](app/src/jsmpeg/metadata.js). The basic flow of control is to look for the 16-byte universal UAS LDS key within the bit stream, and once found, start reading the remainder of the LDS packet. The payload boundaries are easily checked, since they begin with a Unix timestamp, and end with a checksum. Of note, in JavaScript, the max integer is [2^53](http://ecma262-5.com/ELS5_HTML.htm#Section_8.5), so we need to use [BigInteger.js](https://www.npmjs.com/package/big-integer) in order to handle 8 byte timestamps, which are always the first KLV set within the payload.

The key reference here is [MISB STANDARD 0601.8](https://upload.wikimedia.org/wikipedia/commons/1/19/MISB_Standard_0601.pdf) (the UAS LDS standard) which lists 95 KLV metadata elements, a subset of which STANAG 4609 requires. Importantly, floating point values (for example latitude/longitude points) are mapped to integers, so we must [convert ](app_url/src/jsmpeg/metadata.js#L99) the incoming values to a more useful realworld datum. 

<img src="/uploads/c271cc91ad8b31368311e3a3dd238f71/example_packet.png" width="300">

Each length in the KLV set is [BER](https://en.wikipedia.org/wiki/X.690#BER_encoding) encoded. In practice it looks like our KLV encoder uses long form encoding for the UAS metadata payload length, and short encoding for each metadata item. Regardless, for demonstration purposes we [read the most significant bit](app_url/src/jsmpeg/metadata.js#L57) of the payload length to determine the encoding scheme.

<img src="/uploads/c22adf234ba53aca2cb5e446a99ca3da/example_metadata.png" width="300">

A 16-bit block character checksum appears to be used for CRC. Validation is done by a running 16-bit sum through the entire LDS packet starting with the 16 byte local data set key and ending with summing the 2 byte length field of the checksum data item (but not its value). A sample implementation is given in MISB 0601.8, which we implement [here](app_url/src/jsmpeg/metadata.js#L299). Efficiency could be gained if we didn't loop twice over the packet, but rather accumulated the sum as the packet is processed.

### Renderer
The renderer is implemented by [klvoutput.js](app_url/src/jsmpeg/klvoutput.js). It accepts the JSON object constructed by the decoder, and emits a [CustomEvent](https://developer.mozilla.org/en/docs/Web/API/CustomEvent) .
```javascript
this.element.dispatchEvent(new CustomEvent('klv', { "detail": data}));
```
Interested parties can then listen for this event. This is how we hook up JSMpeg's decoded data to Cesium. 
```javascript
var klv = document.getElementById('somelementid');
klv.addEventListener('klv', _callback_);
```

### Cesium
Once in Cesium, and listening for custom events, we [update](app_url/src/uav/main.js#L68) our HTML telemetry and camera or model position. There are two modes that are currently implemented: a FPV mode and track entity mode. 

In FPV mode we take the sensor latitude, longitude, height, roll, pitch and yaw, calling [flyTo](https://cesiumjs.org/Cesium/Build/Documentation/Camera.html#flyTo) with the provided destination and orientation. In track entity mode, we set the position and orientation of a model, and follow it with [trackedEntity](https://cesiumjs.org/Cesium/Build/Documentation/Viewer.html#trackedEntity). Unlike _flyTo_, which has nicely animated interpolation, we must use [sampled properties](https://cesiumjs.org/Cesium/Build/Documentation/SampledProperty.html) when tracking the model, in order to simulate the effect of motion.  In reality we do not know the current velocity or acceleration of the aircraft, so this is really just an approximation of the aircraft's flight path. We also only receive metadata at a rate of 1Hz. Increasing this frequency could provide smoother results.

A note on altitude: per STANAG 4609, tag 75 should provide the height above the [ellipsoid](https://support.pix4d.com/hc/en-us/articles/202559869-Orthometric-and-Ellipsoidal-Height#gsc.tab=0) (HAE), but instead it appears we are only getting sensor true altitude (tag 15) measured from MSL. Cesium uses HAE for positioning objects, so we need to convert. 

Nominally our height above the ellipsoid is calculated by:
```math
HAE = N + H
```
where N = geoid undulation (height of the geoid above the ellipsoid) H = orthometric height, roughly the height above MSL. Geoid height above WGS84 using EGM2008 for 575 Kumpf Drive is [-36.2835]( https://geographiclib.sourceforge.io/cgi-bin/GeoidEval?input=43.504001%2C+-80.530135) There is a NodeJS implementation of [GeographicLib](https://www.npmjs.com/package/geographiclib), so we could create a simple server to return heights given lat/long input. However, after conducting a parking lot flight the value in tag 15 is roughly 300m, and we would expect a value of 336m, so I think HAE is actually being returned. Win!

#  <a name="demoarea"></a>Demos

The frame rate here is slightly reduced because of the screen recorder utilized. True FPS is displayed in Cesium. As previously mentioned, if we could receive LDS packets more frequently, the flyer animation could be smoothed. We could also attempt to change the [interpolation algorithm](https://cesiumjs.org/Cesium/Build/Documentation/HermitePolynomialApproximation.html) in use. 

### Latency Test
[![Latency Test](https://img.youtube.com/vi/d7o2-0aC6og/0.jpg)](https://www.youtube.com/watch?v=d7o2-0aC6og)

### KLV Data Stream
[![KLV Data Stream](https://img.youtube.com/vi/GD6u1hLnP0c/0.jpg)](https://www.youtube.com/watch?v=GD6u1hLnP0c)

### Sim Flight in Cesium
[![Sim Flight in Cesium](https://img.youtube.com/vi/LVPCbZOgEF4/0.jpg)](https://www.youtube.com/watch?v=LVPCbZOgEF4)

### Real Flight with Video
[![Flight Test 1](https://img.youtube.com/vi/9e9eacnLZuw/0.jpg)](https://www.youtube.com/watch?v=9e9eacnLZuw)
[![Flight Test 2](https://img.youtube.com/vi/LHkXWjpnZeY/0.jpg)](https://www.youtube.com/watch?v=LHkXWjpnZeY)

### Future Work
- Extend this application to include increased FOV (essentially decrease the focal length), so we can have more situational awareness. Currently we centre the video, and perform CSS clipping around the video in order to see the surrounding scene.  In this [example](app_url/www/video-test.html) we show how to use canvas data as an image material, in order to have the video included in the 3d space. While this works, the frame rate drops considerably.
- We need to manually enable STANAG metadata in MCS in order to get our output stream. It would be sweet to do this programmatically.
- Full offline support: we need an Internet connection to provide map and terrain data. Cesium does support offline data, so we could potentially use the MCS tile sets. 
- It would be interesting to add additional information/visuals in Cesium. e.g., camera targets, acoustic footprint, terrain sections, etc.
- This code was purely written for fun and learning about STANAG 4609 - so it is by no means production quality :)

### Build and Install

`chmod 751 app/build.sh`

`cd app && ./build.sh && npm install`

### Run
Enable KLV metadata on your video feed, and run:

`./start.sh`

In this example, video is being streamed via RTSP.