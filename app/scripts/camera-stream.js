'use strict';
const {spawn}=require('node:child_process');
const http=require('node:http');
function startCamera({input,url,onError=console.error,spawnProcess=spawn}) {
  let stopped=false;
  const request=http.request(url,{method:'POST',headers:{'Content-Type':'video/mp2t'}});
  // The relay credential stays in this process. FFmpeg writes transport bytes to stdout.
  const env={...process.env};delete env.STREAM_SECRET;
  const ffmpeg=spawnProcess('ffmpeg',['-hide_banner','-loglevel','warning','-i',input,
    '-map','0:v:0','-map','0:d:0','-c:v','mpeg1video','-c:d','copy','-an',
    '-b:v','800k','-r','25','-s','800x600','-bf','0','-f','mpegts','pipe:1'],
    {stdio:['ignore','pipe','inherit'],env});
  function stop(){
    if(stopped)return;
    stopped=true;ffmpeg.stdout.unpipe(request);ffmpeg.kill('SIGTERM');request.destroy();
  }
  function fail(message){if(stopped)return;stop();onError(new Error(message));}
  request.on('error',()=>fail('Relay connection failed'));
  request.on('response',res=>{res.resume();if(res.statusCode!==200)fail(`Relay returned ${res.statusCode}`);});
  ffmpeg.on('error',()=>fail('Could not start FFmpeg'));
  ffmpeg.stdout.on('error',()=>fail('FFmpeg output failed'));
  ffmpeg.on('exit',(code,signal)=>{if(code!==0)fail(`FFmpeg exited (${signal || code})`);});
  // pipe propagates HTTP backpressure to the encoder and ends the request at EOF.
  ffmpeg.stdout.pipe(request);
  return stop;
}
module.exports={startCamera};
