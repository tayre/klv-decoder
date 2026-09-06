# Industrial and defense integration readiness

Follow-up sweep of `9a87b64` plus the working changes described here.
This is an engineering assessment, not certification or accreditation.

## Appropriate uses

The strongest component is the standalone metadata decoder. It is useful for
bench diagnostics, recording inspection, ingestion prototypes, and checking
known encoder feeds. The added TS exporter can read KLV without decoding or
transcoding video. Its raw-field output is also useful for investigating gaps.

| Capability | Evidence / current boundary |
| --- | --- |
| UAS local-set inspection | 64 numerical mappings and seven text fields; ST 0601.8 mapping basis |
| H.264 recording metadata extraction | Verified on the public Day Flight excerpt, with an explicit PID |
| H.265 and other video alongside metadata | Video PIDs are ignored by design; no H.265 recording was tested |
| Corrupt packet recovery and bounded parser buffer | Regression tests plus one million synthetic packets |
| Raw timestamps | Exact UTC microseconds and raw 33-bit PTS; no clock alignment or rollover unwrapping |
| Multi-vendor interoperability | Not established; the real recording corpus is still one source |
| Nested ST 0102 security and ST 0903 sets | Raw preservation with warnings; no semantic interpretation |
| Operational geolocation, footprints, orthorectification | Not validated; FPV geometry remains illustrative |
| Authenticated network service | Not provided; localhost remains the supported development default |

Current encoder requirements extend beyond this implementation. For example,
[Sightline's metadata documentation](https://knowledge.sightlineintelligence.com/wp-content/uploads/EAN-KLV-Metadata.pdf)
lists ST 0601 version 17, ST 0102 version 12 and ST 0903 version 4, with older
versions depending on firmware. This is evidence for pinning encoder/firmware
profiles before claiming interoperability, not evidence that this repository
supports those profiles.

## Changes made

- Added explicit-PID TS-to-JSONL extraction and stdin support. The tool neither
  executes a media decoder nor guesses which program the operator intended.
  Selected-stream transport failures and truncated tails return nonzero status.
- Made the existing TS demuxer directly importable in Node while retaining its
  browser integration. Explicit PID selection now filters unrelated streams
  before they can consume bounded PES state slots.
- A repeated continuity counter is treated as a duplicate only when payload
  bytes and payload-start status also match. Changed data is a continuity fault;
  incomplete metadata is reset and a fresh PES start can recover.
- Invalid UTF-8 now retains raw bytes with a null value and diagnostic. Strict
  mode rejects it. This avoids silently changing identifiers on decode.
- Added coverage warnings for missing/unverified versions, undecoded fields
  (including nested security sets), and reserved numerical error values.
  These diagnostics do not turn strict mode into full standards validation.
- Fixed EOF/reset error offsets and derived partial-corner sets: corner two,
  three or four no longer depends on corner one being present. Same-packet
  coordinates and valid latitude bounds remain required.
- Added a repeatable stress script and a strict TypeScript consumer fixture.
  No runtime dependency was added. Original README narrative was retained.

## Verification evidence

- 59 Node tests: the previous 49 plus ten tests for UTF-8, diagnostics, corner
  subsets/longitude wrap, EOF offsets, changed duplicate packets, state-slot
  isolation, TS CLI behavior and raw PTS rollover boundaries.
- Four browser tests passed in installed Chrome (23.6 seconds). The initial
  attempt could not launch because Playwright's bundled browser was absent;
  using the configured `CHROME_PATH` resolved that environment issue.
- TypeScript 7.0.2 compiled the API consumer with strict checking, including
  expected rejection of text input and unsafe nullable-field assumptions.
- Direct extraction from 16,777,216 bytes of the original H.264 Day Flight
  recording on PID 497 produced the same decoded payload as FFmpeg's raw data
  extraction. One KLV packet was recovered. The 96-byte incomplete transport
  tail was reported; this downloaded excerpt is intentionally incomplete.
  This compares extraction paths, not two independent semantic KLV decoders.
- The synthetic stress run processed 163 MB / one million packets in 2.33 s:
  990,000 accepted, 10,000 deliberately bad checksums rejected, no unexpected
  errors. The parser buffer stayed at 4,096 bytes. Ten forced-GC heap samples
  ranged from 4,272,728 to 4,298,488 bytes. Outputs were not retained.
  This short repeated-fixture exercise is not a live multi-day soak, total-RSS
  bound, latency guarantee, or hostile-video fuzz test.
- `npm audit` returned zero known vulnerabilities at the time of this sweep.

Reproduce from the repository root:

```sh
npm run check --prefix app
npm run test:browser --prefix app
node --expose-gc app/scripts/soak.js
npm exec --yes --package=typescript@7.0.2 -- tsc --noEmit --strict --module node16 --target es2022 app/test/types/consumer.ts
node app/scripts/decode-klv.js --format ts --pid 497 recording.ts > packets.jsonl
```

For an installed browser, set `CHROME_PATH` to its executable. The TypeScript
command downloads a pinned temporary compiler; it does not add a dependency to
the project. Browser dependencies and FFmpeg must already be installed.
Raw stress results: [readiness-soak.json](readiness-soak.json).

## Before operational adoption

1. Pin an interface profile: encoder model/firmware, ST 0601 version, required
   tags, security/VMTI requirements, metadata PID/program, carriage and rates.
   Obtain authorized representative recordings, including interruption,
   rollover, rate changes and multiple programs. Compare decoded values with
   an independent implementation and agreed tolerances.
2. Implement the missing profile features. In particular, raw security metadata
   is not an access-control mechanism. Missing or undecoded security fields
   must not be interpreted as evidence that data is unclassified or releasable.
   This software does not perform classification, redaction or release decisions.
3. Use an established media stack for program discovery, modern-codec playback
   and synchronization. [GStreamer's TS demuxer](https://gstreamer.freedesktop.org/documentation/mpegtsdemux/tsdemux.html)
   exposes program selection and demultiplexed streams. The local demuxer does
   not cover synchronous access units, 192/204-byte framing, UTC/PTS mapping,
   or seeking. A raw timestamp alone is not frame synchronization.
4. Define deployment controls and measured limits: authenticated viewers,
   TLS, trusted origins, ingest timeouts, connection limits, slow-client load,
   process isolation, supervision and several days of representative load.
   The relay credential authenticates ingest only; viewer connections remain
   unauthenticated. The JavaScript MPEG-1 decoder has not been hardened by this
   metadata sweep. Use a maintained external service boundary for deployments.
5. Validate spatial behavior with terrain/geoid models, camera calibration and
   ground truth before using coordinates for measurement. Define loss/staleness
   handling separately from display behavior. The viewer coalesces updates and
   is not an archive; use the decoder callback or JSONL output to retain packets.

The next practical release target is a metadata inspection tool qualified for
specific encoder profiles, with a published fixture corpus and compatibility
matrix. Operational suitability must be established for the intended system;
there is no defensible blanket claim of “military ready” from these tests.
