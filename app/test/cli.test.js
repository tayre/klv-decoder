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
const {transport,metadata}=require('../scripts/demo-stream');
const cli=path.join(__dirname,'../scripts/decode-klv.js');
test('TS exporter extracts metadata from stdin using an explicit PID',()=>{
 const result=spawnSync(process.execPath,[cli,'--format','ts','--pid','0x102','-'],{input:transport(metadata()).bytes,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).payload.platform_tail_number.value,'DEMO-UAV');
 assert.equal(JSON.parse(result.stderr).transport.packets,1);
});
test('TS exporter reports truncated input and incorrect PID with nonzero status',()=>{
 const bytes=transport(metadata()).bytes;
 const truncated=spawnSync(process.execPath,[cli,'--format','ts','--pid','258','-'],{input:Buffer.concat([bytes,Buffer.from([0x47])]),encoding:'utf8'});
 assert.equal(truncated.status,2);assert.equal(JSON.parse(truncated.stderr).transport.truncatedBytes,1);
 const wrong=spawnSync(process.execPath,[cli,'--format','ts','--pid','300','-'],{input:bytes,encoding:'utf8'});
 assert.equal(wrong.status,1);assert.equal(wrong.stdout,'');
});
test('TS exporter refuses implicit PID selection and invalid formats',()=>{
 for(const args of [['--format','ts'],['--format','ts','--pid','NaN'],['--format','bogus']]){
  const result=spawnSync(process.execPath,[cli,...args,'-'],{input:'',encoding:'utf8'});assert.equal(result.status,1);assert.equal(result.stdout,'');
 }
});
