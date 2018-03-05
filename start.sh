stream_url="rtsp://" # url to your rtsp feed

gnome-terminal -x bash -c "node app/server.js --public"
gnome-terminal -x bash -c "node app/websocket-relay.js secretkey 8081 8082"
gnome-terminal -x bash -c "ffmpeg -i ${stream_url} -map: 0:0 -map 0:1 -f mpegts -codec:v mpeg1video -b:v 800k -r 24 -s 800:600 -streamid 1:42 http://127.0.0.1:8081/secretkey"
