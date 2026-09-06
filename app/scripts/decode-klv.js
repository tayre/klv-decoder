'use strict';
const fs=require('node:fs');
const {once}=require('node:events');
const {parseArgs}=require('node:util');
const Decoder=require('../src/klv/decoder');
async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{strict:{type:'boolean'},help:{type:'boolean'}}});
 if(values.help){console.log('node scripts/decode-klv.js [--strict] input.klv > packets.jsonl');return;}
 if(positionals.length!==1)throw new Error('Provide one raw KLV file; see --help.');
 let lines=[];
 const decoder=new Decoder({strict:values.strict,onPacket:p=>lines.push(JSON.stringify(p)),onError:e=>console.error(JSON.stringify(e))});
 for await(const chunk of fs.createReadStream(positionals[0],{highWaterMark:65536})){
  decoder.push(chunk);
  if(lines.length){const output=lines.join('\n')+'\n';lines=[];if(!process.stdout.write(output))await once(process.stdout,'drain');}
 }
 const stats=decoder.end();console.error(JSON.stringify({stats}));
 process.exitCode=stats.packetsRejected?2:stats.packetsDecoded?0:1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
