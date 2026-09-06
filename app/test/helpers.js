'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function load(...files) {
  const context = vm.createContext({Uint8Array,ArrayBuffer,Date,console,BigInt,TextDecoder,CustomEvent:global.CustomEvent,
    document:{readyState:'loading',addEventListener(){},removeEventListener(){}},
    JSMpeg:{Decoder:{},Demuxer:{},DataOutput:{},Source:{}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/klv/decoder.js'),'utf8'),context);
  for (const file of ['buffer','decoder','metadata',...files]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/jsmpeg',file+'.js'),'utf8'),context,{filename:file+'.js'});
  }
  return context;
}
const key = Buffer.from('060e2b34020b01010e01030101000000','hex');
function ber(n) {
  if (n < 128) return Buffer.from([n]);
  const bytes=[];
  while (n) {bytes.unshift(n & 255); n=Math.floor(n/256);}
  return Buffer.from([128+bytes.length,...bytes]);
}
function item(tag, bytes) {
  const encoded=[tag & 127];
  while (tag >= 128) {tag=Math.floor(tag/128);encoded.unshift(128 | (tag & 127));}
  bytes=Buffer.from(bytes);
  return Buffer.concat([Buffer.from(encoded),ber(bytes.length),bytes]);
}
function packet(items) {
  const payload=Buffer.concat([...items, Buffer.from([1,2,0,0])]);
  const result=Buffer.concat([key,ber(payload.length),payload]);
  // Sum big-endian words; the final odd byte is the high byte of its word.
  let sum=0;
  for (let i=0;i<result.length-2;i+=2) sum+=result[i]*256+(i+1<result.length-2 ? result[i+1]:0);
  result.writeUInt16BE(sum & 65535,result.length-2);
  return result;
}
function decoder(context=load(), options={streaming:true}) {
  const output=[];
  const decoder=new context.JSMpeg.Decoder.Metadata(options);
  decoder.connect({render:data=>output.push(data)});
  return {decoder,output,context};
}
module.exports={load,key,ber,item,packet,decoder};
