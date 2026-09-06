# Modernization verification

Checked on macOS with Node 24.18.0, npm 11.16.0, FFmpeg and local Chrome on
2026-09-05. No camera was available for a live hardware test.

## Reproduce the checks

From `app/`:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

An existing Chrome installation can be used via `CHROME_PATH`. The workflow in
`.github/workflows/test.yml` runs the build and Node tests on Node 22 and 24,
and the browser suite on Node 24. The hosted workflow has not been run as part
of this local pass.

## Results

- Clean `npm ci`: succeeded; npm reported zero known dependency vulnerabilities.
- `npm run check`: build succeeded; 20 Node tests passed.
- `npm run test:browser`: three Chrome tests passed. The main viewer test blocks
  all non-local HTTP requests, verifies that video frame numbers advance, and
  checks telemetry, the tracked aircraft position, FPV/Follow/Free controls,
  the grid and video toggles, missing-field handling, and absence of page errors.
- The raw telemetry page and the experimental video-material page both receive
  and decode the FFmpeg test pattern without page errors.
- Browser screenshots are written to `app/test-results/` (ignored by Git).

The Node tests include every split of a KLV packet and a multi-packet PES,
byte-at-a-time delivery, long BER lengths, malformed lengths, duplicate tags,
checksum rejection, signed error sentinels, unsigned 32-bit values, UTF-8 text,
unknown tags, unsupported legacy field widths, and 10,000 successive metadata
packets without accumulating stream history. Integration tests use actual
local HTTP and WebSocket connections to check rejected secrets/methods,
exclusive producers, transport decoding and static asset isolation.

## Independent recording check

Downloaded the first 16 MiB of the [Day Flight sample](https://samples.ffmpeg.org/MPEG2/mpegts-klv/Day%20Flight.mpg)
linked in the original README. Its first 2 MiB did not contain a complete KLV
packet. FFmpeg identified H.264 video and KLV data. The larger portion contains
one complete 163-byte KLV packet, now stored as the regression fixture in
`app/test/fixtures/day-flight.klv`.

The untranscoded transport stream, fed to the demuxer in 997-byte chunks,
produced one checksum-valid metadata packet. After conversion using:

```sh
ffmpeg -i day-flight-prefix.ts -map 0:v:0 -map 0:d:0 \
  -c:v mpeg1video -c:d copy -an -b:v 800k -r 25 -s 800x600 -bf 0 \
  -f mpegts day-flight-mpeg1.ts
node scripts/inspect-stream.js day-flight-mpeg1.ts
```

The same JSMpeg code used by the browser reported:

| Measurement | Result |
| --- | --- |
| Transcoded transport size | 3,722,024 bytes |
| Decoded MPEG-1 frames | 802 |
| Checksum-valid KLV packets | 1 |
| Timestamp | 2009-06-17T16:53:05.099Z |
| Sensor latitude | 54.681323284600545 |
| Sensor longitude | -110.1685597701783 |
| Checksum | 0x1c5f |

Because the input is a byte-range excerpt, FFmpeg warns about its truncated
last video packet. The recording also lacks a data-stream timestamp that
FFmpeg expects. These warnings were not treated as proof of a clean full-file
transcode. The complete KLV packet and the decoded video were verified.

The recording advertises ST 0601 version 1 and uses a four-byte target-width
field. The decoder does not guess its scaling: it returns `value: null`,
`raw: "000001c9"`, and `unsupported_length: true`, then continues decoding.
Other numeric tests use the published checksum, heading and pitch examples in
[MISB ST 0601.8](https://upload.wikimedia.org/wikipedia/commons/1/19/MISB_Standard_0601.pdf).

## Changes and limits

The original README introduction, architecture discussion, packet images,
flight notes and demo links remain. Setup details were updated to match the
code. The large diff mostly removes checked-in third-party libraries and
Cesium assets: npm's lockfile and the build now supply those files.

The application still uses its small vendored JSMpeg MPEG-1 implementation.
This pass is not an audit of that entire codec or full STANAG conformance.
Metadata must use the supported UAS local-set key and private stream 0xBD;
nested sets and many ST 0601 fields remain undecoded. Metadata seeking and
frame-accurate video/telemetry synchronization are not implemented.

Browser testing uses synthetic telemetry, not a physical drone. Third-party
satellite/street/weather services and a user-supplied terrain server have not
been tested end to end. The default offline globe is intentionally low
resolution and uses ellipsoid terrain. The relay is a local development
service; WebSocket viewers are not authenticated. Node 22/Linux/Windows are
configured or supported by the tooling but were not locally executed here.
