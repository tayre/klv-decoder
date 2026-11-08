'use strict';

const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { parseArgs } = require('node:util');
const Decoder = require('../src/klv/decoder');
const TS = require('../src/jsmpeg/ts');
const { createOutput } = require('./metadata-output');

const help = `Usage: node scripts/decode-klv.js [options] input-file-or-stdin-dash

  --format klv|ts                       Input format (default: klv)
  --pid PID                             Required metadata PID for TS, decimal or hex
  --output jsonl|summary|csv|geojson      Output format (default: jsonl)
  --summary                             Shorthand for --output summary
  --strict                              Enable strict structural validation
  --help                                Show this help

Output goes to stdout; diagnostics and counters go to stderr.
Summary describes the selected stream; TS requires an explicit PID and supports
188-byte transport packets carrying private PES 0xBD. GeoJSON emits sensor points.
Exit codes: 0 decoded without rejections, 1 no packets or I/O/usage failure,
2 rejected packets or transport errors. See docs/decoder-api.md for output details.`;

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
      output: { type: 'string' },
      summary: { type: 'boolean' },
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
  const output = values.output ?? (values.summary ? 'summary' : 'jsonl');
  if (!['jsonl', 'summary', 'csv', 'geojson'].includes(output)) {
    throw new Error('output must be jsonl, summary, csv or geojson');
  }
  if (values.summary && output !== 'summary') {
    throw new Error('--summary cannot be combined with another output format');
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
  return { ...values, output, pid, input: positionals[0] };
}

async function main() {
  const options = parseOptions();
  if (options.help) {
    console.log(help);
    return;
  }

  const output = createOutput(options);
  let pendingOutput = [];
  const decoder = new Decoder({
    strict: options.strict,
    onPacket: packet => {
      const chunk = output.write(packet);
      if (chunk) pendingOutput.push(chunk);
    },
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
    const text = pendingOutput.join('');
    pendingOutput = [];
    return text;
  }

  const input = options.input === '-'
    ? process.stdin
    : fs.createReadStream(options.input, { highWaterMark: 65536 });
  let transport;
  let stats;
  // Pipeline propagates backpressure and closes the input on output failure.
  await pipeline(input, async function* decode(chunks) {
    const header = output.start();
    if (header) yield header;
    for await (const chunk of chunks) {
      if (ts) ts.write(chunk);
      else decoder.push(chunk);
      const text = takeOutput();
      if (text) yield text;
    }
    transport = ts?.end();
    stats = decoder.end();
    const text = takeOutput();
    if (text) yield text;
    const footer = output.end({ stats, transport });
    if (footer) yield footer;
  }, process.stdout);

  console.error(JSON.stringify({
    stats,
    ...output.diagnostics(),
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
