'use strict';
const {spawnSync,spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const path=require('node:path');
const {once}=require('node:events');
const {createServer}=require('../server');
const {createRelay}=require('../websocket-relay');
const {startDemo}=require('./demo-stream');
async function main(){
  const demo=process.argv.includes('--demo');
  if(process.argv.includes('--help')){console.log('npm run demo | STREAM_URL=rtsp://camera/... npm run dev\nOptional: PORT, STREAM_PORT, WS_PORT, STREAM_SECRET, HOST (default 127.0.0.1)');return;}
  const input=process.env.STREAM_URL;
  if(!demo&&!input)throw new Error('Set STREAM_URL to your camera URL, or run npm run demo.');
  if(spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status!==0)throw new Error('FFmpeg is required on PATH.');
  if(spawnSync(process.execPath,[path.join(__dirname,'build.js')],{stdio:'inherit'}).status!==0)throw new Error('Build failed. Run npm ci first.');
  const secret=process.env.STREAM_SECRET || randomBytes(16).toString('hex');
  const host=process.env.HOST || '127.0.0.1';
  const server=createServer();
  const relay=createRelay({secret,host,streamPort:Number(process.env.STREAM_PORT || 8081),websocketPort:Number(process.env.WS_PORT || 8082)});
  let stopSource=()=>{},closing=false;
  async function stop(code=0){
    if(closing)return;closing=true;stopSource();
    await Promise.all([relay.close(),new Promise(resolve=>server.close(resolve))]);
    process.exitCode=code;
  }
  const failure=error=>{console.error(error.message);stop(1);};
  for(const service of [server,relay.server,relay.sockets])service.on('error',failure);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
  const ready=[once(relay.server,'listening'),once(relay.sockets,'listening'),once(server,'listening')];
  server.listen(Number(process.env.PORT || 8085),host);
  await Promise.all(ready);
  const ingestHost=host==='0.0.0.0' ? '127.0.0.1':host;
  const url=`http://${ingestHost}:${relay.server.address().port}/${secret}`;
  if(demo)stopSource=startDemo({url,onError:failure});
  else {
    const ffmpeg=spawn('ffmpeg',['-hide_banner','-loglevel','warning','-i',input,'-map','0:v:0','-map','0:d:0',
      '-c:v','mpeg1video','-c:d','copy','-an','-b:v','800k','-r','25','-s','800x600','-bf','0','-f','mpegts',url],{stdio:'inherit'});
    ffmpeg.on('error',failure);ffmpeg.on('exit',code=>{if(!closing)failure(new Error(`FFmpeg exited (${code})`));});
    stopSource=()=>ffmpeg.kill('SIGTERM');
  }
  const ws=relay.sockets.address().port;
  console.log(`Open http://127.0.0.1:${server.address().port}/?stream=ws://127.0.0.1:${ws}/`);
  console.log(demo ? 'Synthetic video and KLV telemetry. Ctrl-C stops all services.' : 'Camera stream connected. Ctrl-C stops all services.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
