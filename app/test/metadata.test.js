'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {load,key,item,packet,decoder}=require('./helpers');
const sample=packet([item(2,Buffer.from('00046050584e0180','hex')),item(13,[0x40,0,0,0]),item(14,[0xc0,0,0,0])]);
test('known coordinates and microsecond timestamp decode',()=>{
  const d=decoder();d.decoder.write(0,[sample]);
  assert.equal(d.output.length,1);
  const p=d.output[0].payload;
  assert.ok(Math.abs(p.sensor_latitude.value-45)<1e-6);
  assert.ok(Math.abs(p.sensor_longitude.value+90)<1e-6);
  assert.equal(p.unix_time_stamp.value.toISOString(),'2009-01-12T22:08:22.000Z');
  assert.equal(d.output[0].universal_key,'060e2b34020b01010e01030101000000');
});
test('every possible two-part split retains the whole packet',()=>{
  for(let split=1;split<sample.length;split++){
    const d=decoder();d.decoder.write(0,[sample.subarray(0,split)]);
    assert.equal(d.output.length,0,`split ${split}`);
    d.decoder.write(0,[sample.subarray(split)]);assert.equal(d.output.length,1,`split ${split}`);
  }
});
test('byte-by-byte input, leading junk, and consecutive packets',()=>{
  const d=decoder();
  for(const byte of Buffer.concat([Buffer.alloc(30,99),sample,sample])) d.decoder.write(0,[Buffer.from([byte])]);
  assert.equal(d.output.length,2);
  assert.equal(d.decoder.decode(),false);
});
test('bad checksum is discarded and next valid packet survives',()=>{
  const bad=Buffer.from(sample);bad[bad.length-1]^=1;
  const d=decoder();d.decoder.write(0,[Buffer.concat([bad,sample])]);assert.equal(d.output.length,1);
});
test('long BER item lengths and multi-byte unknown tags preserve raw bytes',()=>{
  const d=decoder();d.decoder.write(0,[packet([item(4,Buffer.alloc(130,65)),item(150,[0xab,0xcd])])]);
  assert.equal(d.output[0].payload.platform_tail_number.value,'A'.repeat(130));
  assert.equal(d.output[0].payload.unknown_150.value,'abcd');
});
test('signed 16-bit fields, unsigned 32-bit fields, elevation scaling and sentinels',()=>{
  const d=decoder();d.decoder.write(0,[packet([item(6,[0xff,0xff]),item(7,[0x80,0]),item(18,[255,255,255,255]),item(21,[255,255,255,255]),item(25,[255,255]),item(13,[128,0,0,0]),item(75,[0,0])])]);
  const p=d.output[0].payload;
  assert.ok(p.platform_pitch_angle.value<0);
  assert.equal(p.platform_roll_angle.value,null);
  assert.equal(p.sensor_latitude.value,null);
  assert.equal(p.sensor_relative_azimuth_angle.value,360);
  assert.equal(p.slant_range.value,5000000);
  assert.equal(p.frame_center_elevation.value,19000);
  assert.equal(p.sensor_ellipsoid_height.value,-900);
});
test('rejects missing checksum, duplicate tags and length overrun',()=>{
  for (const items of [[item(5,[0,0]),item(5,[1,1])],[Buffer.from([5,10,0])]]) {
    const d=decoder();d.decoder.write(0,[Buffer.concat([packet(items),sample])]);assert.equal(d.output.length,1);
  }
  const d=decoder();d.decoder.write(0,[Buffer.concat([key,Buffer.from([4,4,2,65,66]),sample])]);assert.equal(d.output.length,1);
});
test('invalid and excessive outer BER lengths recover without waiting',()=>{
  for(const length of [[128],[133],[132,127,255,255,255]]){
    const d=decoder();d.decoder.write(0,[Buffer.concat([key,Buffer.from(length),sample])]);assert.equal(d.output.length,1);
  }
});
test('streaming history stays bounded across thousands of packets',()=>{
  const d=decoder();for(let i=0;i<10000;i++)d.decoder.write(0,[sample]);
  assert.equal(d.output.length,10000);assert.ok(d.decoder.bits.byteLength<=sample.length);assert.equal(d.decoder.timestamps.length,0);
});
test('MISB ST 0601.8 section 8.1.2 published checksum vector',()=>{
  const d=decoder();d.decoder.bits=new d.context.JSMpeg.BitBuffer(Buffer.from('060e2b34020081bbb4fd','hex'));
  d.decoder.bits.index=80;assert.equal(d.decoder.verifyCRC(0xb4fd,2,0),true);
});
test('large buffer writes grow correctly in expand and evict modes',()=>{
  const {JSMpeg}=load();
  for(const mode of [JSMpeg.BitBuffer.MODE.EXPAND,JSMpeg.BitBuffer.MODE.EVICT]){
    const b=new JSMpeg.BitBuffer(8,mode);b.write(Buffer.alloc(7));b.write(Buffer.alloc(100,42));assert.ok(b.byteLength>=100);
  }
});
test('metadata output treats incoming text as text, not HTML',()=>{
  const {JSMpeg}=load('klvoutput');const element={textContent:'',dispatchEvent(e){this.event=e;}};
  const out=new JSMpeg.DataOutput.KLV({klvelement:element});const data={payload:{name:{key:4,length:5,value:'<img onerror=alert(1)>'}}};
  out.render(data);assert.ok(element.textContent.includes('<img'));assert.equal(element.event.detail,data);
});
test('published MISB heading and negative pitch examples',()=>{
  const d=decoder();d.decoder.write(0,[packet([item(5,[0x71,0xc2]),item(6,[0xfd,0x3d])])]);
  assert.ok(Math.abs(d.output[0].payload.platform_heading_angle.value-159.9744)<0.0001);
  assert.ok(Math.abs(d.output[0].payload.platform_pitch_angle.value-(-0.4315251))<0.00031);
});
test('transport demuxer handles every split of a multi-packet PES',()=>{
  const {transport}=require('../scripts/demo-stream');
  const input=transport(packet([item(4,Buffer.alloc(400,65))])).bytes;
  for(let split=1;split<input.length;split++){
    const d=decoder(load('ts'));const ts=new d.context.JSMpeg.Demuxer.TS({});ts.connect(0xbd,d.decoder);
    ts.write(input.subarray(0,split));ts.write(input.subarray(split));
    assert.equal(d.output.length,1,`split ${split}`);assert.equal(d.output[0].payload.platform_tail_number.value.length,400);
  }
});
test('real FFmpeg Day Flight metadata survives legacy field widths',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const bytes=fs.readFileSync(path.join(__dirname,'fixtures/day-flight.klv'));
  const d=decoder();d.decoder.write(0,[bytes]);assert.equal(d.output.length,1);
  const p=d.output[0].payload;
  assert.equal(p.unix_time_stamp.value.toISOString(),'2009-06-17T16:53:05.099Z');
  assert.ok(Math.abs(p.sensor_latitude.value-54.6813232846)<1e-9);
  assert.ok(Math.abs(p.sensor_longitude.value-(-110.1685597702))<1e-9);
  assert.equal(p.target_width.value,null);assert.equal(p.target_width.raw,'000001c9');
  assert.equal(p.target_width.unsupported_length,true);assert.equal(p.checksum.value,0x1c5f);
});
test('unsupported numeric widths do not shift later fields',()=>{
  const d=decoder();d.decoder.write(0,[packet([item(13,[1]),item(5,[0x71,0xc2])])]);
  assert.equal(d.output.length,1);assert.equal(d.output[0].payload.sensor_latitude.value,null);
  assert.equal(d.output[0].payload.sensor_latitude.raw,'01');assert.ok(d.output[0].payload.platform_heading_angle.value>159);
});
test('text fields decode UTF-8 without losing non-ASCII characters',()=>{
  const d=decoder();d.decoder.write(0,[packet([item(4,Buffer.from('Drone Éclair'))])]);
  assert.equal(d.output[0].payload.platform_tail_number.value,'Drone Éclair');
});
