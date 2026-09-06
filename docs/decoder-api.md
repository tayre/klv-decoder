# Using the metadata decoder without the viewer

The decoder lives in `app/src/klv/decoder.js`. It has no npm runtime dependencies,
DOM dependency, video decoder, or Cesium dependency. It is intentionally still
part of this repository, not a published package. CommonJS types are provided
in the adjacent `.d.ts` file.

```js
const Decoder = require('./app/src/klv/decoder');
const decoder = new Decoder({
  maxPacketSize: 1024 * 1024, // maximum local-set payload bytes
  maxFields: 1024,
  strict: false,
  onPacket(packet) {
    console.log(packet.payload.sensor_latitude?.value);
    console.log(packet.payload.unix_time_stamp?.microseconds);
  },
  onError(error) {
    console.error(error.code, error.offset);
  }
});

decoder.push(bytes);          // Uint8Array, Buffer, or ArrayBuffer
const counters = decoder.end();
```

For a browser, `npm run build` creates `app/www/dist/klv.js`; include it as a
script to get `globalThis.KLVDecoder`. The JSMpeg bundle includes the same
implementation through a thin adapter.

`push(bytes, pts)` returns the number of packets emitted by that call. `pts`
is optional transport presentation time in seconds; the value associated with
the first byte of a KLV packet is retained across fragmented writes. It is not
converted into UTC or corrected for MPEG clock rollover. Call `reset()` when
changing connections or sources; `end()` reports an unfinished final packet.
Callbacks run synchronously and must not call `push`, `reset`, or `end` on the
same instance. Exceptions from callbacks propagate to the caller.

Each decoded packet keeps the original `payload` map and adds:

- `checksum_valid`, absolute stream-byte `offset`, and optional transport `pts`;
- `warnings` for missing timestamps/version, unverified versions, unsupported widths,
  undecoded fields, malformed UTF-8, and reserved numeric error values;
- `derived.corners` for offset corners with a frame center in the same packet.

Timestamps retain both a millisecond-resolution `Date` and the original
microseconds as a decimal string, which is safe to serialize to JSON. Numeric
fields include units; reserved signed error values return `null` and
`error: "out_of_range"`. Unknown fields and nested sets stay hexadecimal with
`decoded: false`. A recognized numeric field with an unexpected width returns
`null`, `raw`, and `unsupported_length: true`; no scaling is guessed.

Malformed UTF-8 is preserved in `raw` with a null value and `invalid_utf8` error,
rather than silently replacing bytes in identifiers. Version warnings describe
coverage, not a claim that another version is invalid. Nested security metadata
is preserved but not interpreted or enforced.

The default mode tolerates missing timestamps and legacy widths while still
requiring bounded, structurally valid packets and correct checksums. Strict
mode additionally requires tag 2 first, supported widths for known fields,
a representable timestamp, valid UTF-8, and canonical BER/OID forms. It is a structural
validation option, **not a full ST 0601 conformance validator**. Strict mode can still accept an unverified version with a warning. Interpretation
is based on the implemented ST 0601.8 mappings, not version-dispatched schemas.

The stream buffer starts at 4 KiB and cannot exceed `maxPacketSize + 21` bytes
(default approximately 1 MiB). Caller-owned input and emitted objects are not
included in that limit. Unknown values expand to hexadecimal strings, and the
consumer is responsible for retaining only the output it needs. A plausible
but incomplete length may wait indefinitely for more bytes: use `reset()` on
an application timeout or `end()` at EOF. The parser does not search inside a
plausible incomplete payload, where a key could legitimately be nested.

Diagnostics are cumulative in `stats`; parser state resets do not clear them.
`packetsRejected` counts rejected candidates/reset events, not a guaranteed
count of lost wire packets. `discardedBytes` counts bytes skipped while looking
for the UAS key.

## Raw-file export

```sh
cd app
node scripts/decode-klv.js recording.klv > packets.jsonl
node scripts/decode-klv.js --strict recording.klv > packets.jsonl
```

The exporter applies stdout backpressure between input chunks, writes
errors/counters to stderr, and exits 0 for decoded input without rejections,
1 for no packets or an I/O/usage failure, and 2 when packets were rejected.
## Metadata-only TS export

```sh
node scripts/decode-klv.js --format ts --pid 0x1f1 recording.ts > packets.jsonl
cat recording.ts | node scripts/decode-klv.js --format ts --pid 497 - > packets.jsonl
```

Choose the metadata PID using a media probe or the producer's configuration.
For example, `ffprobe -v error -show_streams recording.ts` shows stream IDs.
TS mode requires an explicit PID to prevent accidental selection of a different
program. It uses the same demuxer as the viewer but never loads a video decoder.
It supports 188-byte TS carrying raw UAS KLV in private PES 0xBD; it does not
implement synchronous metadata access units, PAT/PMT discovery, or 192/204-byte
framing. Video codec bytes on other PIDs are ignored. PTS is the raw 33-bit
clock in seconds, including its rollover; no UTC alignment is inferred.

Transport counters and the selected PID are included on stderr. Truncation,
continuity faults, malformed transport/PES and limit failures produce exit 2,
even when some metadata was recovered. An empty or wrong-PID extraction exits 1.
Counters for explicit-PID mode describe selected-stream errors, not an audit of
all other media programs. JSON offsets are bytes within the extracted metadata
stream, not offsets within the original TS file. Warnings alone do not change
the exit status; consumers must apply their own supported-version/field policy.

For other carriage formats, FFmpeg can extract the raw stream first:

```sh
ffmpeg -i recording.ts -map 0:d:0 -c copy -f data recording.klv
```

This extraction path does not require transcoding H.264/H.265 to MPEG-1.
`inspect-stream.js` is a separate diagnostic for this repository's MPEG-1
video/demuxer path.

## Viewer and transport behavior

`JSMpeg.Player` accepts `metadataPid`, `metadataStrict`, `metadataMaxPacketSize`,
`onMetadata`, and `onMetadataError`. In the main viewer, `?metadataPid=258`
selects a PID. The demuxer defaults to the first matching PID per registered
PES stream ID and ignores other PIDs carrying the same ID; it never merges
them. It does not discover programs via PAT/PMT.

Transport continuity loss resets incomplete metadata. Duplicate transport
packets, malformed PES headers, transport-error/scrambled packets, and
oversized PES accumulation are rejected. Parser and transport counters are
available through `UAV.player.data.parser.stats` and `UAV.player.demuxer.stats`.
The transport buffer limit is separate from the local-set limit.

Every accepted packet reaches metadata callbacks/events. DOM updates are
coalesced to the latest packet once per animation frame, and the viewer marks
telemetry stale after three seconds. Thus the viewer is not an archival sink;
subscribe to callbacks or use the raw-file exporter to retain every packet.
