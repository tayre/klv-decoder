'use strict';
const {spawn}=require('node:child_process');
const http=require('node:http');
function metadata(frame=0) {
  const fields=[];
  const field=(tag,bytes)=>fields.push(Buffer.from([tag,bytes.length]),bytes);
  const uint16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;};
  const int32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};
  const timestamp=Buffer.alloc(8);timestamp.writeBigUInt64BE(BigInt(Date.now())*1000n);
  field(2,timestamp);field(4,Buffer.from('DEMO-UAV'));
  field(5,uint16(Math.round((frame*3 % 360)*65535/360)));
  field(6,uint16(0));field(7,uint16(0));
  field(13,int32(Math.round((43.504+Math.sin(frame/20)*0.001)*2147483647/90)));
  field(14,int32(Math.round((-80.530+Math.cos(frame/20)*0.001)*2147483647/180)));
  field(75,uint16(Math.round((350+900)*65535/19900)));
  field(16,uint16(Math.round(70*65535/180)));
  field(18,Buffer.alloc(4));field(19,int32(Math.round(-15*2147483647/180)));
  field(65,Buffer.from([8]));field(1,Buffer.alloc(2));
  const body=Buffer.concat(fields);
  const packet=Buffer.concat([Buffer.from('060e2b34020b01010e01030101000000','hex'),Buffer.from([body.length]),body]);
  let sum=0;for(let i=0;i<packet.length-2;i++)sum+=packet[i]*(i%2 ? 1:256);
  packet.writeUInt16BE(sum & 65535,packet.length-2);
  return packet;
}
function transport(payload,counter=0) {
  const header=Buffer.from([0,0,1,0xbd,0,0,0x80,0,0]);header.writeUInt16BE(payload.length+3,4);
  const pes=Buffer.concat([header,payload]),packets=[];
  for(let offset=0;offset<pes.length;offset+=184){
    const bytes=pes.subarray(offset,offset+184),packet=Buffer.alloc(188,255);
    packet[0]=0x47;packet[1]=(offset===0 ? 0x40:0)|1;packet[2]=2; // PID 258
    const padding=184-bytes.length;
    packet[3]=(padding ? 0x30:0x10)|(counter++ & 15);
    if(padding){packet[4]=padding-1;if(padding>1)packet[5]=0;}
    bytes.copy(packet,188-bytes.length);packets.push(packet);
  }
  return {bytes:Buffer.concat(packets),counter};
}
function startDemo({url,onError=console.error}) {
  const request=http.request(url,{method:'POST',headers:{'Content-Type':'video/mp2t'}});
  request.on('error',onError);
  request.on('response',res=>{res.resume();if(res.statusCode!==200)onError(new Error(`Relay returned ${res.statusCode}`));});
  const ffmpeg=spawn('ffmpeg',['-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc=size=640x360:rate=25',
    '-an','-c:v','mpeg1video','-b:v','800k','-bf','0','-f','mpegts','pipe:1'],{stdio:['ignore','pipe','inherit']});
  ffmpeg.on('error',onError);
  let pending=Buffer.alloc(0),last=0,frame=0,counter=0,stopped=false;
  ffmpeg.stdout.on('data',chunk=>{
    if(stopped)return;
    pending=Buffer.concat([pending,chunk]);
    const length=pending.length-pending.length%188;
    if(!length)return;
    let output=pending.subarray(0,length);pending=pending.subarray(length);
    if(Date.now()-last>=1000){
      const klv=transport(metadata(frame++),counter);counter=klv.counter;
      output=Buffer.concat([output,klv.bytes]);last=Date.now();
    }
    if(!request.write(output)){ffmpeg.stdout.pause();request.once('drain',()=>ffmpeg.stdout.resume());}
  });
  ffmpeg.on('exit',(code,signal)=>{if(!stopped)onError(new Error(`FFmpeg exited (${signal || code})`));});
  return ()=>{stopped=true;ffmpeg.kill('SIGTERM');request.destroy();};
}
module.exports={metadata,transport,startDemo};
