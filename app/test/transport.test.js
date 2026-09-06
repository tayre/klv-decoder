'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,decoder,item,packet}=require('./helpers');
const {transport,metadata}=require('../scripts/demo-stream');
function setup(options={},pid=null){const d=decoder(load('ts'));const ts=new d.context.JSMpeg.Demuxer.TS(options);ts.connect(0xbd,d.decoder,pid);return{...d,ts};}
function pidOf(bytes,pid){bytes=Buffer.from(bytes);for(let i=0;i<bytes.length;i+=188){bytes[i+1]=(bytes[i+1]&224)|(pid>>8);bytes[i+2]=pid&255;}return bytes;}
function tsPacket(payload,{cc=0,start=true,pid=258}={}){
 const b=Buffer.alloc(188,255),pad=184-payload.length;b[0]=0x47;b[1]=(pid>>8)|(start?64:0);b[2]=pid&255;b[3]=(pad?0x30:0x10)|cc;
 if(pad){b[4]=pad-1;if(pad>1)b[5]=0;}payload.copy(b,188-payload.length);return b;
}
test('duplicate transport packets do not emit duplicate metadata',()=>{
 const d=setup(),bytes=transport(metadata()).bytes;d.ts.write(Buffer.concat([bytes,bytes]));assert.equal(d.output.length,1);assert.equal(d.ts.stats.duplicates,1);
});
test('lost continuation drops incomplete PES and recovers at next start',()=>{
 const d=setup();const multi=transport(packet([item(4,Buffer.alloc(600,65))]));
 d.ts.write(multi.bytes.subarray(0,188));d.ts.write(multi.bytes.subarray(376));
 d.ts.write(transport(metadata(),multi.counter).bytes);
 assert.equal(d.output.length,1);assert.equal(d.output[0].payload.platform_tail_number.value,'DEMO-UAV');assert.equal(d.ts.stats.continuityErrors,1);
});
test('two private-stream PIDs stay isolated, explicit selection works',()=>{
 const a=transport(packet([item(4,Buffer.from('A'))])).bytes,b=pidOf(transport(packet([item(4,Buffer.from('B'))])).bytes,300);
 const first=setup();first.ts.write(Buffer.concat([a,b]));assert.equal(first.output.length,1);assert.equal(first.output[0].payload.platform_tail_number.value,'A');
 const selected=setup({},300);selected.ts.write(Buffer.concat([a,b]));assert.equal(selected.output.length,1);assert.equal(selected.output[0].payload.platform_tail_number.value,'B');
});
test('transport errors, scrambling and invalid adaptation fields cannot leak payload',()=>{
 for(const mutate of [b=>b[1]|=128,b=>b[3]|=128,b=>{b[3]|=0x20;b[4]=184;}]){
  const d=setup(),bad=Buffer.from(transport(metadata()).bytes);mutate(bad);d.ts.write(bad);d.ts.write(transport(metadata(),1).bytes);assert.equal(d.output.length,1);assert.equal(d.ts.stats.transportErrors,1);
 }
});
test('PES headers split across transport packets are assembled before parsing',()=>{
 const klv=metadata(),pes=Buffer.concat([Buffer.from([0,0,1,0xbd,0,(klv.length+3),128,0,0]),klv]);
 for(let split=1;split<9;split++){
  const d=setup();d.ts.write(Buffer.concat([tsPacket(pes.subarray(0,split)),tsPacket(pes.subarray(split),{cc:1,start:false})]));assert.equal(d.output.length,1,`split ${split}`);
 }
});
test('malformed PES length/header is rejected without advancing across TS boundaries',()=>{
 const d=setup();const bad=transport(metadata()).bytes;const begin=188-(bad.length===188?metadata().length+9:0);
 bad[begin+8]=255;d.ts.write(bad);d.ts.write(transport(metadata(),1).bytes);assert.equal(d.output.length,1);assert.equal(d.ts.stats.malformedPes,1);
});
test('zero-length PES accumulation is bounded',()=>{
 const d=setup({maxPesSize:300});const first=Buffer.concat([Buffer.from([0,0,1,0xbd,0,0,128,0,0]),Buffer.alloc(175)]);
 d.ts.write(tsPacket(first));d.ts.write(tsPacket(Buffer.alloc(184),{start:false,cc:1}));assert.equal(d.ts.stats.pesSizeLimit,1);
});
test('adaptation on first video TS packet does not prematurely flush PES',()=>{
 const {JSMpeg}=load('ts'),ts=new JSMpeg.Demuxer.TS({}),writes=[];ts.connect(0xe0,{write:(pts,buffers)=>writes.push(buffers)});
 const start=Buffer.from([0,0,1,0xe0,0,0,128,0,0,11,22]);ts.write(tsPacket(start));assert.equal(writes.length,0);
 ts.write(tsPacket(Buffer.from([33,44]),{start:false,cc:1}));assert.equal(writes.length,1);
});
test('transport tail copies only remaining bytes from a large input',()=>{
 const d=setup();const bytes=Buffer.concat([transport(metadata()).bytes,Buffer.from([0x47,0,0])]);d.ts.write(bytes);
 assert.equal(d.ts.leftoverBytes.length,3);assert.equal(d.ts.leftoverBytes.buffer.byteLength,3);
});
test('resynchronizes after leading noise containing false sync bytes',()=>{
 const d=setup();d.ts.write(Buffer.concat([Buffer.alloc(20,0x47),transport(metadata()).bytes]));assert.equal(d.output.length,1);assert.equal(d.ts.stats.discardedBytes,20);
});
test('reset prevents old partial KLV bytes from crossing a reconnection',()=>{
 const d=setup();const bytes=metadata();d.ts.write(transport(bytes.subarray(0,30)).bytes);d.ts.reset();d.ts.write(transport(bytes).bytes);assert.equal(d.output.length,1);
});
test('changed payload with repeated continuity counter is not silently treated as duplicate',()=>{
 const d=setup();d.ts.write(transport(packet([item(4,Buffer.from('A'))])).bytes);
 d.ts.write(transport(packet([item(4,Buffer.from('B'))])).bytes);
 assert.equal(d.output.length,2);assert.equal(d.output[1].payload.platform_tail_number.value,'B');
 assert.equal(d.ts.stats.continuityErrors,1);assert.equal(d.ts.stats.duplicates,0);
});
test('explicit PID cannot be starved by unrelated incomplete PES headers',()=>{
 const d=setup({maxPidStates:2},258);
 for(let pid=300;pid<310;pid++)d.ts.write(tsPacket(Buffer.from([0]),{pid}));
 d.ts.write(transport(metadata()).bytes);assert.equal(d.output.length,1);assert.equal(d.ts.stats.pidStateLimit,0);
});
test('33-bit PES timestamps retain raw clock values across rollover',()=>{
 const d=setup(),klv=metadata();
 for(const [cc,pts] of [[0,[0x2f,255,255,255,255]],[1,[0x21,0,1,0,1]]]){
  const header=Buffer.from([0,0,1,0xbd,0,klv.length+8,128,128,5,...pts]);
  d.ts.write(tsPacket(Buffer.concat([header,klv]),{cc}));
 }
 assert.equal(d.output.length,2);assert.equal(d.output[0].pts,(2**33-1)/90000);assert.equal(d.output[1].pts,0);
});
