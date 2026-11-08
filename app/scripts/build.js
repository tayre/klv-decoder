'use strict';
const { build } = require('esbuild');
const { readFile, mkdir, cp, rm } = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function main() {
  const sources = ['jsmpeg', 'video-element', 'player', 'buffer', 'ajax', 'ajax-progressive',
    'websocket', 'ts', 'decoder', 'mpeg1', 'mp2', 'metadata', 'webgl', 'canvas2d',
    'webaudio', 'klvoutput'];
  await mkdir(path.join(root, 'www/dist'), { recursive: true });
  await build({ stdin: { contents: (await readFile(path.join(root,'src/klv/decoder.js'),'utf8')) + '\n' + (await Promise.all(sources.map(name =>
    readFile(path.join(root, 'src/jsmpeg', name + '.js'), 'utf8')))).join('\n') },
    outfile: path.join(root, 'www/dist/jsmpeg.min.js'), minify: true, target: 'es2022' });
  await cp(path.join(root,'src/klv/decoder.js'),path.join(root,'www/dist/klv.js'));
  await build({ entryPoints: [path.join(root, 'src/uav/main.js')],
    outfile: path.join(root, 'www/dist/main.min.js'), minify: true, target: 'es2022' });
  const cesiumAssets = path.join(root, 'www/vendor/cesium');
  // Replace generated assets so an upgrade cannot leave old chunks available.
  await rm(cesiumAssets, { recursive: true, force: true });
  await cp(path.join(root, 'node_modules/cesium/Build/Cesium'), cesiumAssets, { recursive: true });
  console.log('Built JSMpeg, UAV viewer and Cesium assets.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
