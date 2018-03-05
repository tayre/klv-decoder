#!/bin/sh
uglifyjs \
	src/thirdparty/biginteger/biginteger.js \
	src/jsmpeg/jsmpeg.js \
	src/jsmpeg/video-element.js \
	src/jsmpeg/player.js \
	src/jsmpeg/buffer.js \
	src/jsmpeg/ajax.js \
	src/jsmpeg/ajax-progressive.js \
	src/jsmpeg/websocket.js \
	src/jsmpeg/ts.js \
	src/jsmpeg/decoder.js \
	src/jsmpeg/mpeg1.js \
	src/jsmpeg/mp2.js \
	src/jsmpeg/metadata.js \
	src/jsmpeg/webgl.js \
	src/jsmpeg/canvas2d.js \
	src/jsmpeg/webaudio.js \
	src/jsmpeg/klvoutput.js \
	-o www/js/dist/jsmpeg.min.js \

uglifyjs \
	src/thirdparty/jquery/jquery.js \
	src/thirdparty/bootstrap/tether.js \
	src/thirdparty/bootstrap/bootstrap.js \
	-o www/js/dist/jquery+bootstrap.min.js\

uglifyjs \
	src/uav/main.js \
	-o www/js/dist/main.min.js\
