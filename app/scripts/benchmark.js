'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {performance}=require('node:perf_hooks');
const {packet,item}=require('../test/helpers');
const roots=[{name:'current',root:path.resolve(__dirname,'..')}];
if(process.argv[2])roots.unshift({name:'baseline',root:path.resolve(process.argv[2])});
const fixture=fs.readFileSync(path.join(__dirname,'../test/fixtures/day-flight.klv'));
const cases={recorded:fixture,unknown64k:packet([item(150,Buffer.alloc(65536,42))])};
cases.corrupt64k=Buffer.from(cases.unknown64k);cases.corrupt64k[cases.corrupt64k.length-1]^=1;
const result={node:process.version,cpu:os.cpus()[0].model,method:'Median of 5 runs, same VM adapter harness, no output retention',results:{}};
for(const {name,root} of roots){
 result.results[name]={};
 const {decoder}=require(path.join(root,'test/helpers.js'));
 for(const [scenario,bytes] of Object.entries(cases)){
  const count=scenario==='recorded'?50000:200,times=[];let capacity=0;
  for(let run=0;run<5;run++){
   global.gc?.();const d=decoder();let emitted=0;d.decoder.connect({render(){emitted++;}});
   for(let i=0;i<200;i++)d.decoder.write(0,[fixture]);emitted=0;
   const start=performance.now();for(let i=0;i<count;i++)d.decoder.write(0,[bytes]);times.push(performance.now()-start);
   if(emitted!==(scenario==='corrupt64k'?0:count))throw new Error('Unexpected decode count');
   capacity=d.decoder.parser?.bufferCapacity ?? d.decoder.bits.bytes.length;
  }
  times.sort((a,b)=>a-b);const median=times[2];
  result.results[name][scenario]={packets:count,medianMs:median,packetsPerSecond:Math.round(count*1000/median),mibPerSecond:Math.round(bytes.length*count/median*1000/1048576),bufferCapacity:capacity};
 }
}
console.log(JSON.stringify(result,null,2));
