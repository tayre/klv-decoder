'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('built Cesium browser bundle contains patched DOMPurify', async () => {
  // npm audit cannot inspect dependencies embedded in an upstream bundle.
  // GHSA-cg2g-xh64-v4q7 and GHSA-mrv2-3pqr-j5jr are fixed in 3.4.17.
  const bundle = await readFile(path.join(__dirname, '../www/vendor/cesium/Cesium.js'), 'utf8');
  const versions = [...bundle.matchAll(/\bDOMPurify (\d+)\.(\d+)\.(\d+)\b/g)];
  assert.ok(versions.length > 0, 'Expected a DOMPurify version in the shipped bundle');
  for (const match of versions) {
    const [major, minor, patch] = match.slice(1).map(Number);
    assert.ok(major > 3 || major === 3 && (minor > 4 || minor === 4 && patch >= 17),
      `Vulnerable bundled ${match[0]}; update Cesium, not just the lockfile`);
  }
});
