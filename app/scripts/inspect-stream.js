'use strict';
// Read a local MPEG-TS recording through the same demuxer/decoders as the browser.
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
if(!process.argv[2]){console.error('Usage: node scripts/inspect-stream.js recording.ts');process.exit(1);}
const context=vm.createContext({Uint8Array,ArrayBuffer,Date,BigInt,TextDecoder,console,
  window:{performance},document:{readyState:'loading',addEventListener(){}}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/klv/decoder.js'),'utf8'),context);
for(const name of ['jsmpeg','buffer','decoder','metadata','ts','mpeg1']){
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/jsmpeg',name+'.js'),'utf8'),context);
}
const JSMpeg=context.JSMpeg;
const demux=new JSMpeg.Demuxer.TS({});
const metadata=new JSMpeg.Decoder.Metadata({streaming:true});
const video=new JSMpeg.Decoder.MPEG1Video({streaming:true});
let frames=0,packets=0,firstMetadata=null;
metadata.connect({render(data){packets++;firstMetadata ||= data;}});
video.connect({resize(){},render(){frames++;}});
demux.connect(0xbd,metadata);
demux.connect(0xe0,{write(pts,bytes){video.write(pts,bytes);while(video.decode()){};}});
(async()=>{
  let bytes=0;
  for await(const chunk of fs.createReadStream(process.argv[2],{highWaterMark:997})){
    bytes+=chunk.length;demux.write(chunk);
  }
  demux.end();metadata.parser.end();
  console.log(JSON.stringify({bytes,videoFrames:frames,metadataPackets:packets,metadataStats:metadata.parser.stats,transportStats:demux.stats,firstMetadata},null,2));
  if(!packets)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
