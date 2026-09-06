'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Decoder=require('../src/klv/decoder');
const {item,packet,key}=require('./helpers');
const timestamp=item(2,Buffer.from('00046c8e20038385','hex'));
const valid=packet([timestamp,item(5,[0x71,0xc2])]);
const create=options=>{const packets=[],errors=[];return{packets,errors,decoder:new Decoder({...options,onPacket:p=>packets.push(p),onError:e=>errors.push(e)})};};
test('standalone API preserves exact timestamp, PTS and absolute byte offset',()=>{
 const d=create();d.decoder.push(Buffer.concat([Buffer.alloc(10),valid.subarray(0,20)]),12.5);
 d.decoder.push(valid.subarray(20),13.5);
 assert.equal(d.packets.length,1);const p=d.packets[0];
 assert.equal(p.payload.unix_time_stamp.microseconds,BigInt('0x00046c8e20038385').toString());
 assert.equal(p.pts,12.5);assert.equal(p.offset,10);assert.equal(p.checksum_valid,true);
});
test('strict mode requires a timestamp first and rejects invalid known widths',()=>{
 for(const bytes of [packet([item(5,[0,0])]),packet([item(5,[0,0]),timestamp]),packet([timestamp,item(5,[1])])]){
   const d=create({strict:true});d.decoder.push(bytes);assert.equal(d.packets.length,0);assert.equal(d.errors.length,1);
 }
 const d=create({strict:true});d.decoder.push(valid);assert.equal(d.packets.length,1);
});
test('checksum failure reported before payload conversions',()=>{
 const d=create();const bad=Buffer.from(valid);bad[bad.length-1]^=1;
 d.decoder.push(bad);assert.equal(d.errors[0].code,'checksum_mismatch');assert.equal(d.decoder.stats.packetsRejected,1);
});
test('end reports truncated packets and reset allows a new connection',()=>{
 const d=create();d.decoder.push(valid.subarray(0,25));
 assert.equal(d.decoder.end().errors.truncated_packet,1);assert.equal(d.decoder.bufferedBytes,0);
 d.decoder.push(valid);assert.equal(d.packets.length,1);d.decoder.end();assert.equal(d.errors.length,1);
});
test('buffer capacity stays capped for huge writes and rejected claimed lengths',()=>{
 const d=create({maxPacketSize:256});const batch=Buffer.concat(Array.from({length:10000},()=>valid));
 d.decoder.push(batch);assert.equal(d.packets.length,10000);assert.ok(d.decoder.bufferCapacity<=277);
 d.decoder.push(Buffer.concat([key,Buffer.from([0x84,0xff,0xff,0xff,0xff]),valid]));
 assert.equal(d.packets.length,10001);assert.ok(d.errors.some(e=>e.code==='packet_length_limit'));
});
test('retains a large packet sent one byte at a time',()=>{
 const d=create({maxPacketSize:20000});const bytes=packet([timestamp,item(150,Buffer.alloc(16384,0x42))]);
 for(const b of bytes)d.decoder.push(Uint8Array.of(b));
 assert.equal(d.packets.length,1);assert.equal(d.packets[0].payload.unknown_150.raw.length,32768);
 assert.ok(d.decoder.bufferCapacity<=20021);
});
test('limits the number of fields before constructing an unbounded object',()=>{
 const d=create({maxFields:2});d.decoder.push(valid);assert.equal(d.packets.length,0);assert.equal(d.errors[0].code,'field_count_limit');
});
test('derived corner coordinates use only this packet, regardless of tag order',()=>{
 const d=create();d.decoder.push(packet([item(26,[0x7f,0xff]),item(27,[0x80,1]),item(23,[0x40,0,0,0]),item(24,[0xc0,0,0,0])]));
 const corner=d.packets[0].derived.corners[0];assert.ok(Math.abs(corner.latitude-45.075)<1e-6);assert.ok(Math.abs(corner.longitude+90.075)<1e-6);
 d.decoder.push(packet([item(26,[0,0]),item(27,[0,0])]));assert.equal(d.packets[1].derived.corners.length,0);
});
test('full attitude, target location and speed fields decode with units',()=>{
 const d=create();d.decoder.push(packet([item(90,[0x7f,255,255,255]),item(91,[128,0,0,1]),item(40,[0,0,0,0]),item(56,[140])]));
 const p=d.packets[0].payload;assert.equal(p.platform_pitch_angle_full.value,90);assert.equal(p.platform_roll_angle_full.value,-90);
 assert.equal(p.target_location_latitude.value,0);assert.equal(p.platform_ground_speed.value,140);assert.equal(p.platform_ground_speed.unit,'m/s');
});
test('published numeric boundary matrix matches independent encodings',()=>{
 for(const [tag,width,signed,min,max] of [[35,2,false,0,360],[36,1,false,0,100],[37,2,false,0,5000],[45,2,false,0,4095],[51,2,true,-180,180],[55,1,false,0,100],[58,2,false,0,10000],[93,4,true,-180,180]]){
  const lo=Buffer.alloc(width),hi=Buffer.alloc(width,255);
  if(signed){if(width===2){lo.writeInt16BE(-32767);hi.writeInt16BE(32767);}else{lo.writeInt32BE(-2147483647);hi.writeInt32BE(2147483647);}}
  for(const [bytes,expected] of [[lo,min],[hi,max]]){const d=create();d.decoder.push(packet([item(tag,bytes)]));assert.ok(Math.abs(d.packets[0].payload[Decoder.names[tag]].value-expected)<1e-8,`tag ${tag}`);}
 }
});
test('rejects malformed BER-OID, duplicate and reserved tags',()=>{
 for(const bytes of [[0,1,0],[128,128,128,128,1,0],[5,2,0,0,5,2,0,1]]){
  const d=create();d.decoder.push(packet([Buffer.from(bytes)]));assert.equal(d.packets.length,0);assert.equal(d.errors.length,1);
 }
});
test('seeded malformed packet fuzz stays bounded and recovers to a good packet',()=>{
 let seed=123456789;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 const d=create({maxPacketSize:1024,maxFields:64});
 for(let i=0;i<5000;i++){
  const bytes=Buffer.alloc(random()%256);for(let j=0;j<bytes.length;j++)bytes[j]=random()&255;
  d.decoder.push(packet([bytes]));assert.ok(d.decoder.bufferCapacity<=1045);
 }
 const before=d.packets.length;d.decoder.push(valid);assert.equal(d.packets.length,before+1);
});
test('PTS follows the first byte even when the universal key is fragmented',()=>{
 for(let split=1;split<22;split++){
  const d=create();d.decoder.push(valid.subarray(0,split),10);d.decoder.push(valid.subarray(split),11);assert.equal(d.packets[0].pts,10,`split ${split}`);
 }
});
