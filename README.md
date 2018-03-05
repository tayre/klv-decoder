### Build and Install

`sudo apt-get install nodejs`

`sudo ln -s /usr/bin/nodejs /usr/bin/node`

`sudo apt-get install npm`

`npm install -g uglify-js`

`chmod 751 build.sh`

`./build.sh && npm install`

### Run
Enable KLV metadata on your video feed, and run:

`./start.sh`

In this example, video is being streamed via RTSP.