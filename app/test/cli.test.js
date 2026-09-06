'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
test('JSONL exporter decodes real KLV without video or DOM',()=>{
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/decode-klv.js'),path.join(__dirname,'fixtures/day-flight.klv')],{encoding:'utf8'});
 assert.equal(result.status,0);const data=JSON.parse(result.stdout.trim());assert.equal(data.checksum_valid,true);assert.equal(data.payload.unix_time_stamp.microseconds,'1245257585099653');
 assert.equal(JSON.parse(result.stderr.trim()).stats.packetsDecoded,1);
});
test('strict exporter returns a nonzero exit for the unsupported legacy width',()=>{
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/decode-klv.js'),'--strict',path.join(__dirname,'fixtures/day-flight.klv')],{encoding:'utf8'});
 assert.equal(result.status,2);assert.equal(result.stdout,'');assert.match(result.stderr,/invalid_field/);
});
