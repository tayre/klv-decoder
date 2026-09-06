'use strict';
const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');
function createRelay({secret, streamPort=8081, websocketPort=8082, host='127.0.0.1', maxBufferedBytes=2*1024*1024} = {}) {
  if (!secret || !/^[A-Za-z0-9_-]+$/.test(secret)) { throw new Error('Set STREAM_SECRET to letters, numbers, underscores or hyphens.'); }
  const sockets = new WebSocketServer({port:websocketPort, host, perMessageDeflate:false});
  let producer = null;
  sockets.on('connection', socket => socket.on('error', () => socket.terminate()));
  const server = http.createServer((req, res) => {
    if (req.url !== '/' + secret) { res.writeHead(403); return res.end('Invalid stream secret'); }
    if (req.method !== 'POST') { res.writeHead(405, {Allow:'POST'}); return res.end(); }
    if (producer) { res.writeHead(409); return res.end('A stream is already connected'); }
    producer = req;
    req.socket.setTimeout(0);
    req.on('data', data => {
      for (const client of sockets.clients) {
        if (client.readyState !== WebSocket.OPEN) { continue; }
        if (client.bufferedAmount > maxBufferedBytes) { client.terminate(); continue; }
        client.send(data, {binary:true}, error => { if (error) client.terminate(); });
      }
    });
    req.on('close', () => { if (producer === req) producer = null; });
    req.on('end', () => res.end('Stream complete'));
  });
  server.requestTimeout = 0;
  server.listen(streamPort, host);
  return {server, sockets, close: async () => {
    if (producer) producer.destroy();
    for (const client of sockets.clients) client.terminate();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => sockets.close(resolve))]);
  }};
}
if (require.main === module) {
  const relay = createRelay({secret:process.argv[2] || process.env.STREAM_SECRET,
    streamPort:Number(process.argv[3] || process.env.STREAM_PORT || 8081),
    websocketPort:Number(process.argv[4] || process.env.WS_PORT || 8082), host:process.env.HOST || '127.0.0.1'});
  for (const server of [relay.server, relay.sockets]) server.on('error', error => { console.error(error.message); process.exit(1); });
  relay.server.on('listening', () => console.log(`Stream input: http://127.0.0.1:${relay.server.address().port}/<secret>`));
  relay.sockets.on('listening', () => console.log(`WebSocket: ws://127.0.0.1:${relay.sockets.address().port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => relay.close());
}
module.exports = {createRelay};
