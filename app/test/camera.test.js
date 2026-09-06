'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter,once}=require('node:events');
const {PassThrough}=require('node:stream');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {WebSocket}=require('ws');
const {createRelay}=require('../websocket-relay');
const {startCamera}=require('../scripts/camera-stream');
function encoder(){const child=new EventEmitter();child.stdout=new PassThrough();child.killed=false;child.kill=()=>{child.killed=true;};return child;}
test('camera forwards exact bytes without exposing relay credentials to FFmpeg',async t=>{
  const secret='regression_secret';
  const relay=createRelay({secret,streamPort:0,websocketPort:0});t.after(()=>relay.close());
  await Promise.all([once(relay.server,'listening'),once(relay.sockets,'listening')]);
  const ws=new WebSocket(`ws://127.0.0.1:${relay.sockets.address().port}`);await once(ws,'open');
  const child=encoder();let invocation;
  const previous=process.env.STREAM_SECRET;process.env.STREAM_SECRET=secret;
  t.after(()=>{if(previous===undefined)delete process.env.STREAM_SECRET;else process.env.STREAM_SECRET=previous;});
  const stop=startCamera({input:'test-camera',url:`http://127.0.0.1:${relay.server.address().port}/${secret}`,
    onError:error=>assert.fail(error.message),spawnProcess:(...args)=>{invocation=args;return child;}});
  t.after(stop);
  assert.equal(invocation[1].at(-1),'pipe:1');
  assert.ok(!JSON.stringify(invocation).includes(secret));
  assert.equal(invocation[2].env.STREAM_SECRET,undefined);
  const ingest=once(relay.server,'request');
  const received=once(ws,'message');const bytes=Buffer.from([0x47,0,1,2,255]);child.stdout.write(bytes);
  assert.deepEqual((await received)[0],bytes);
  const [request]=await ingest;const ended=once(request,'end');
  child.stdout.end();await ended;
  stop();assert.equal(child.killed,true);
});
test('camera stops encoder on rejected ingest without logging secret URL',async t=>{
  const relay=createRelay({secret:'correct',streamPort:0,websocketPort:0});t.after(()=>relay.close());
  await Promise.all([once(relay.server,'listening'),once(relay.sockets,'listening')]);
  const child=encoder();let report;
  const failed=new Promise(resolve=>{report=resolve;});
  const stop=startCamera({input:'test-camera',url:`http://127.0.0.1:${relay.server.address().port}/private_wrong_secret`,
    spawnProcess:()=>child,onError:report});t.after(stop);child.stdout.write('transport');
  assert.equal((await failed).message,'Relay returned 403');assert.equal(child.killed,true);
});
test('relay rejects legacy CLI secrets without printing them',()=>{
  const result=spawnSync(process.execPath,[path.join(__dirname,'../websocket-relay.js'),'private_cli_secret'],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/Command-line secrets are no longer accepted/);
  assert.ok(!(result.stdout+result.stderr).includes('private_cli_secret'));
});
