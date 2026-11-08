'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { item, packet } = require('./helpers');
const { transport } = require('../scripts/demo-stream');

const cli = path.join(__dirname, '../scripts/decode-klv.js');
const fixture = readFileSync(path.join(__dirname, 'fixtures/day-flight.klv'));
const position = [item(13, [0, 0, 0, 0]), item(14, [0, 0, 0, 0])];
function time(micros) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(micros);
  return item(2, bytes);
}
function run(args, input = fixture) {
  return spawnSync(process.execPath, [cli, ...args, '-'], {
    input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  });
}
function diagnostics(result) {
  return JSON.parse(result.stderr.trim().split('\n').at(-1));
}

// Independent CSV reader so quoted commas, line breaks, and quotes are checked
// as cells rather than by splitting the export on commas or newlines.
function csvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && text[i] === ',') {
      row.push(cell); cell = '';
    } else if (!quoted && text.slice(i, i + 2) === '\r\n') {
      rows.push([...row, cell]); row = []; cell = ''; i++;
    } else cell += text[i];
  }
  assert.equal(quoted, false, 'Unterminated CSV quote');
  assert.equal(cell, '', 'CSV records should end in CRLF');
  return rows;
}
function csvRecord(text) {
  const [header, row, ...extra] = csvRows(text);
  assert.equal(extra.length, 0);
  assert.equal(row.length, header.length);
  return Object.fromEntries(header.map((name, i) => [name, row[i]]));
}

test('recorded fixture exports exact timestamps, diagnostics, and map positions', () => {
  const summary = run(['--summary']);
  assert.equal(summary.status, 0, summary.stderr);
  const report = JSON.parse(summary.stdout);
  assert.equal(report.timestamps.start, '2009-06-17T16:53:05.099653Z');
  assert.equal(report.timestamps.startMicroseconds, '1245257585099653');
  assert.equal(report.timestamps.durationSeconds, 0);
  assert.equal(report.timestamps.meanPacketRateHz, null);
  assert.equal(report.warnings.unsupported_length, 1);
  assert.equal(report.fields.find(field => field.tag === 22).unsupportedLength, 1);
  assert.deepEqual(report.stats, diagnostics(summary).stats);

  const csv = run(['--output', 'csv']);
  assert.equal(csv.status, 0, csv.stderr);
  const row = csvRecord(csv.stdout);
  assert.equal(row.timestamp_utc, report.timestamps.start);
  assert.equal(row.timestamp_microseconds, '1245257585099653');
  assert.equal(row.sensor_altitude_hae_m, '');
  assert.ok(Number(row.sensor_altitude_msl_m) > 0);
  assert.equal(JSON.parse(row.payload_json).target_width.raw, '000001c9');
  assert.ok(JSON.parse(row.warnings_json).some(warning => warning.code === 'unsupported_length'));

  const geo = run(['--output', 'geojson']);
  assert.equal(geo.status, 0, geo.stderr);
  const collection = JSON.parse(geo.stdout);
  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(collection.features.length, 1);
  const feature = collection.features[0];
  assert.equal(feature.type, 'Feature');
  assert.equal(feature.geometry.type, 'Point');
  assert.deepEqual(feature.geometry.coordinates, [Number(row.sensor_longitude_deg), Number(row.sensor_latitude_deg)]);
  assert.ok(Math.abs(feature.geometry.coordinates[0] - -110.1685597701783) < 1e-10);
  assert.equal(feature.properties.timestamp_microseconds, row.timestamp_microseconds);
  assert.equal(feature.properties.sensor_altitude_msl_m, Number(row.sensor_altitude_msl_m));
  assert.equal(feature.properties.sensor_altitude_hae_m, null);
  assert.deepEqual(diagnostics(geo).export, { format: 'geojson', features: 1, skippedPositions: 0 });
});

test('summary counts time range, field coverage, invalid data, and rejections', () => {
  const first = packet([time(2000001n), ...position, item(5, [0, 0]), item(150, [1, 2])]);
  const later = packet([time(4000001n), item(5, [1]), item(13, [128, 0, 0, 0]), item(14, [0, 0, 0, 0])]);
  const earlier = packet([time(3000001n), item(3, [0xc3, 0x28])]);
  const missing = packet([item(65, [8])]);
  const corrupt = Buffer.from(first); corrupt[corrupt.length - 1] ^= 1;
  const result = run(['--output', 'summary'], Buffer.concat([first, later, earlier, missing, corrupt, first.subarray(0, 20)]));
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.stats.packetsDecoded, 4);
  assert.equal(report.stats.packetsRejected, 2);
  assert.deepEqual(report.stats.errors, { checksum_mismatch: 1, truncated_packet: 1 });
  assert.equal(report.timestamps.durationSeconds, 2);
  assert.equal(report.timestamps.meanPacketRateHz, 1);
  assert.equal(report.timestamps.outOfOrder, 1);
  assert.equal(report.timestamps.missingOrInvalidPackets, 1);
  assert.deepEqual(report.positions, { valid: 1, missingOrInvalid: 3 });
  assert.deepEqual(report.fields.find(field => field.tag === 5), {
    tag: 5, name: 'platform_heading_angle', packets: 2, decoded: 1,
    undecoded: 0, invalid: 1, unsupportedLength: 1
  });
  assert.equal(report.fields.find(field => field.tag === 150).undecoded, 1);
  assert.equal(report.warnings.invalid_utf8, 1);
  assert.equal(report.warnings.out_of_range, 1);
});

test('CSV quotes text safely and preserves microseconds beyond Number precision', () => {
  const micros = 9007199254740993n;
  const bytes = packet([time(micros), ...position, item(3, Buffer.from('Flight "North",\r\nsecond line')),
    item(4, Buffer.from('=HYPERLINK("https://example.invalid")')), item(75, [0, 0]),
    item(15, [0xff, 0xff]), item(90, [0x7f, 0xff, 0xff, 0xff]), item(6, [0, 0]),
    item(91, [0x80, 0, 0, 1]), item(7, [0, 0]), item(56, [42]), item(150, [0xff])]);
  const result = run(['--output', 'csv'], bytes);
  assert.equal(result.status, 0, result.stderr);
  const row = csvRecord(result.stdout);
  assert.equal(row.timestamp_microseconds, micros.toString());
  assert.match(row.timestamp_utc, /\.740993Z$/);
  assert.equal(row.mission_id, 'Flight "North",\r\nsecond line');
  assert.equal(row.platform_tail_number, '\'=HYPERLINK("https://example.invalid")');
  assert.equal(row.sensor_latitude_deg, '0');
  assert.equal(row.sensor_altitude_hae_m, '-900');
  assert.equal(row.sensor_altitude_msl_m, '19000');
  assert.equal(row.platform_pitch_deg, '90');
  assert.equal(row.platform_roll_deg, '-90');
  assert.equal(row.ground_speed_mps, '42');
  const payload = JSON.parse(row.payload_json);
  assert.equal(payload.platform_tail_number.value, '=HYPERLINK("https://example.invalid")');
  assert.equal(payload.unknown_150.raw, 'ff');
});

test('CSV protects leading whitespace and formula prefixes while retaining negative numbers', () => {
  for (const identifier of ['+1', '-1', '@SUM(1)', ' \t=1', '\tlabel', '\rlabel', '\nlabel']) {
    const result = run(['--output', 'csv'], packet([item(4, Buffer.from(identifier)), item(15, [0, 0])]));
    assert.equal(result.status, 0, result.stderr);
    const row = csvRecord(result.stdout);
    assert.equal(row.platform_tail_number, "'" + identifier);
    assert.equal(row.sensor_altitude_msl_m, '-900');
  }
});

test('GeoJSON skips invalid or missing positions without borrowing earlier values', () => {
  const bytes = Buffer.concat([
    packet([time(1000001n), item(13, [0, 0, 0, 0]), item(14, [0x80, 0, 0, 1]), item(75, [0, 0])]),
    packet([time(2000001n), item(13, [128, 0, 0, 0]), item(14, [0, 0, 0, 0])]),
    packet([time(3000001n), item(13, [0, 0, 0, 0])]),
    packet([time(4000001n), ...position, item(15, [0xff, 0xff])])
  ]);
  const result = run(['--output', 'geojson'], bytes);
  assert.equal(result.status, 0, result.stderr);
  const { features } = JSON.parse(result.stdout);
  assert.equal(features.length, 2);
  assert.deepEqual(features.map(feature => feature.geometry.coordinates), [[-180, 0], [0, 0]]);
  assert.equal(features[0].properties.sensor_altitude_hae_m, -900);
  assert.equal(features[1].properties.sensor_altitude_hae_m, null);
  assert.equal(features[1].properties.sensor_altitude_msl_m, 19000);
  assert.equal(features[1].properties.timestamp_microseconds, '4000001');
  assert.deepEqual(diagnostics(result).export, { format: 'geojson', features: 2, skippedPositions: 2 });
});

test('GeoJSON remains complete across input chunks and output backpressure', () => {
  const one = packet([time(1000001n), ...position]);
  const result = run(['--output', 'geojson'], Buffer.concat(Array(2000).fill(one)));
  assert.equal(result.status, 0, result.stderr);
  const { features } = JSON.parse(result.stdout);
  assert.equal(features.length, 2000);
  assert.equal(features.at(-1).properties.offset_bytes, one.length * 1999);
});

test('all new output modes work with selected TS input and retain transport errors', () => {
  const ts = transport(packet([time(1000001n), ...position])).bytes;
  for (const output of ['summary', 'csv', 'geojson']) {
    const result = run(['--format', 'ts', '--pid', '0x102', '--output', output], Buffer.concat([ts, Buffer.from([0x47])]));
    assert.equal(result.status, 2, output);
    assert.equal(diagnostics(result).transport.truncatedBytes, 1);
    assert.equal(diagnostics(result).pid, 258);
    if (output === 'summary') {
      const summary = JSON.parse(result.stdout);
      assert.equal(summary.metadataPid, 258);
      assert.equal(summary.inputFormat, 'ts');
      assert.equal(summary.transport.truncatedBytes, 1);
    } else if (output === 'csv') assert.equal(csvRecord(result.stdout).timestamp_microseconds, '1000001');
    else assert.equal(JSON.parse(result.stdout).features.length, 1);
  }
});

test('empty input and all-rejected input produce valid empty reports with nonzero exits', () => {
  for (const output of ['summary', 'csv', 'geojson']) {
    for (const [input, args, status] of [[Buffer.alloc(0), [], 1], [fixture, ['--strict'], 2]]) {
      const result = run(['--output', output, ...args], input);
      assert.equal(result.status, status, output);
      if (output === 'summary') {
        const summary = JSON.parse(result.stdout);
        assert.equal(summary.timestamps.start, null);
        assert.equal(summary.timestamps.durationSeconds, null);
        assert.equal(summary.timestamps.meanPacketRateHz, null);
        assert.deepEqual(summary.fields, []);
      } else if (output === 'csv') assert.equal(csvRows(result.stdout).length, 1);
      else assert.deepEqual(JSON.parse(result.stdout), { type: 'FeatureCollection', features: [] });
    }
  }
});

test('missing and unrepresentable timestamps remain explicit in exports', () => {
  const bytes = packet([time(0xffffffffffffffffn), ...position]);
  const result = run(['--output', 'csv'], bytes);
  assert.equal(result.status, 0);
  const row = csvRecord(result.stdout);
  assert.equal(row.timestamp_utc, '');
  assert.equal(row.timestamp_microseconds, '18446744073709551615');
  const summary = JSON.parse(run(['--summary'], bytes).stdout);
  assert.equal(summary.timestamps.missingOrInvalidPackets, 1);
  const geo = JSON.parse(run(['--output', 'geojson'], packet(position)).stdout);
  assert.equal(geo.features[0].properties.timestamp_utc, null);
  assert.equal(geo.features[0].properties.timestamp_microseconds, null);
});

test('output options reject conflicts and help documents the new modes', () => {
  assert.equal(run(['--output', 'jsonl']).stdout, run([]).stdout);
  assert.equal(run(['--summary', '--output', 'summary']).stdout, run(['--summary']).stdout);
  for (const args of [['--output', 'bad'], ['--summary', '--output', 'csv'], ['--summary', '--output', 'jsonl']]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--output jsonl\|summary\|csv\|geojson/);
  assert.match(help.stdout, /--summary/);
});
