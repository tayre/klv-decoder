'use strict';
const fs=require('node:fs');
const {once}=require('node:events');
const {parseArgs}=require('node:util');
const Decoder=require('../src/klv/decoder');
const TS=require('../src/jsmpeg/ts');
async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{strict:{type:'boolean'},help:{type:'boolean'},format:{type:'string',default:'klv'},pid:{type:'string'}}});
 if(values.help){console.log('node scripts/decode-klv.js [--strict] [--format klv|ts --pid PID] input-file-or-stdin-dash > packets.jsonl\nTS mode requires an explicit metadata PID and supports 188-byte TS, private PES 0xBD.');return;}
 if(positionals.length!==1)throw new Error('Provide one input file or - for stdin; see --help.');
 if(!['klv','ts'].includes(values.format))throw new Error('format must be klv or ts');
 const pid=values.pid===undefined?null:Number(values.pid);
 if(values.format==='ts' && (values.pid===undefined || !/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(values.pid) || !Number.isInteger(pid) || pid<16 || pid>=8191))throw new Error('TS mode requires --pid between 16 and 8190 (decimal or hex).');
 if(values.format==='klv' && values.pid!==undefined)throw new Error('--pid requires --format ts');
 let lines=[];
 const decoder=new Decoder({strict:values.strict,onPacket:p=>lines.push(JSON.stringify(p)),onError:e=>console.error(JSON.stringify(e))});
 const ts=values.format==='ts'?new TS():null;
 if(ts)ts.connect(0xbd,{write:(pts,buffers)=>{for(const bytes of buffers)decoder.push(bytes,pts);},reset:()=>decoder.reset('transport_discontinuity')},pid);
 async function flush(){if(lines.length){const output=lines.join('\n')+'\n';lines=[];if(!process.stdout.write(output))await once(process.stdout,'drain');}}
 const input=positionals[0]==='-'?process.stdin:fs.createReadStream(positionals[0],{highWaterMark:65536});
 for await(const chunk of input){if(ts)ts.write(chunk);else decoder.push(chunk);await flush();}
 const transport=ts?.end();await flush();
 const stats=decoder.end();console.error(JSON.stringify({stats,...(transport?{transport,pid}:{} )}));
 const transportFailure=transport && ['discardedBytes','truncatedBytes','continuityErrors','transportErrors','malformedPes','pesSizeLimit','pidStateLimit'].some(key=>transport[key]>0);
 process.exitCode=stats.packetsRejected || transportFailure?2:stats.packetsDecoded?0:1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
