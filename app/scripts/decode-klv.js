'use strict';

const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { parseArgs } = require('node:util');
const Decoder = require('../src/klv/decoder');
const TS = require('../src/jsmpeg/ts');

const transportErrorCounters = [
  'discardedBytes', 'truncatedBytes', 'continuityErrors', 'transportErrors',
  'malformedPes', 'pesSizeLimit', 'pidStateLimit'
];

function parseOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      strict: { type: 'boolean' },
      help: { type: 'boolean' },
      format: { type: 'string', default: 'klv' },
      pid: { type: 'string' }
    }
  });
  if (values.help) return { help: true };
  if (positionals.length !== 1) {
    throw new Error('Provide one input file or - for stdin; see --help.');
  }
  if (!['klv', 'ts'].includes(values.format)) {
    throw new Error('format must be klv or ts');
  }

  const pid = values.pid === undefined ? null : Number(values.pid);
  if (values.format === 'ts' && (
    values.pid === undefined || !/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(values.pid) ||
    !Number.isInteger(pid) || pid < 16 || pid >= 8191
  )) {
    throw new Error('TS mode requires --pid between 16 and 8190 (decimal or hex).');
  }
  if (values.format === 'klv' && values.pid !== undefined) {
    throw new Error('--pid requires --format ts');
  }
  return { ...values, pid, input: positionals[0] };
}

async function main() {
  const options = parseOptions();
  if (options.help) {
    console.log('node scripts/decode-klv.js [--strict] [--format klv|ts --pid PID] input-file-or-stdin-dash > packets.jsonl\nTS mode requires an explicit metadata PID and supports 188-byte TS, private PES 0xBD.');
    return;
  }

  let lines = [];
  const decoder = new Decoder({
    strict: options.strict,
    onPacket: packet => lines.push(JSON.stringify(packet)),
    onError: error => console.error(JSON.stringify(error))
  });
  const ts = options.format === 'ts' ? new TS() : null;
  ts?.connect(0xbd, {
    write(pts, buffers) {
      for (const bytes of buffers) decoder.push(bytes, pts);
    },
    reset: () => decoder.reset('transport_discontinuity')
  }, options.pid);

  function takeOutput() {
    const output = lines.join('\n') + '\n';
    lines = [];
    return output;
  }

  const input = options.input === '-'
    ? process.stdin
    : fs.createReadStream(options.input, { highWaterMark: 65536 });
  let transport;
  let stats;
  // Pipeline propagates backpressure and closes the input on output failure.
  await pipeline(input, async function* decode(chunks) {
    for await (const chunk of chunks) {
      if (ts) ts.write(chunk);
      else decoder.push(chunk);
      if (lines.length) yield takeOutput();
    }
    transport = ts?.end();
    stats = decoder.end();
    if (lines.length) yield takeOutput();
  }, process.stdout);

  console.error(JSON.stringify({
    stats,
    ...(transport ? { transport, pid: options.pid } : {})
  }));
  const transportFailure = transport &&
    transportErrorCounters.some(key => transport[key] > 0);
  process.exitCode = stats.packetsRejected || transportFailure
    ? 2
    : stats.packetsDecoded ? 0 : 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
