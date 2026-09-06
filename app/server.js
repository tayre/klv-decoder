'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const root = path.join(__dirname, 'www');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.wasm':'application/wasm', '.glb':'model/gltf-binary',
  '.gltf':'model/gltf+json', '.woff':'font/woff', '.woff2':'font/woff2' };
function createServer() {
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}); return res.end(); }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); return res.end('Invalid URL'); }
    // Keep the old /www/ links working, but serve only public assets.
    if (pathname.startsWith('/www/')) { pathname = pathname.slice(4); }
    if (pathname === '/') { pathname = '/index.html'; }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || pathname.includes('\0')) { res.writeHead(403); return res.end(); }
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type':types[path.extname(file)] || 'application/octet-stream',
        'Content-Length':stat.size, 'X-Content-Type-Options':'nosniff' });
      if (req.method === 'HEAD') { return res.end(); }
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch { res.writeHead(404); res.end('Not found. Run npm run build before starting the viewer.'); }
  });
}
if (require.main === module) {
  const {values} = parseArgs({options:{port:{type:'string',default:process.env.PORT || '8085'}, public:{type:'boolean'},help:{type:'boolean'}}});
  if (values.help) { console.log('node server.js [--port 8085] [--public]'); }
  else {
    const server = createServer();
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(Number(values.port), values.public ? '0.0.0.0' : '127.0.0.1', () => console.log(`Viewer: http://127.0.0.1:${server.address().port}`));
    for (const signal of ['SIGINT','SIGTERM']) { process.on(signal, () => server.close()); }
  }
}
module.exports = {createServer};
