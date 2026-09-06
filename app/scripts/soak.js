'use strict';
// Bounded synthetic stress check; not a substitute for a multi-day live soak.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Decoder=require('../src/klv/decoder');
const fixture=fs.readFileSync(path.join(__dirname,'../test/fixtures/day-flight.klv'));
const corrupt=Buffer.from(fixture);corrupt[corrupt.length-1]^=1;
let received=0;const decoder=new Decoder({onPacket:()=>received++});
const batch=Buffer.concat([...Array(99).fill(fixture),corrupt]);
const samples=[];const start=performance.now();
for(let round=0;round<10;round++){
 for(let n=0;n<1000;n++){
  // Split keys, lengths and payloads; avoid retaining emitted packet objects.
  const split=(n*137)%batch.length;
  decoder.push(batch.subarray(0,split),n);decoder.push(batch.subarray(split),n);
 }
 global.gc?.();samples.push({packets:received,heapUsed:process.memoryUsage().heapUsed,bufferCapacity:decoder.bufferCapacity});
}
const stats=decoder.end();
assert.equal(received,990000);assert.equal(stats.errors.checksum_mismatch,10000);
assert.equal(stats.packetsRejected,10000);assert.ok(decoder.bufferCapacity<=decoder.maxPacketSize+21);
console.log(JSON.stringify({node:process.version,seconds:(performance.now()-start)/1000,gc:!!global.gc,stats,samples},null,2));
