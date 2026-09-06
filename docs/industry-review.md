# Industry-readiness review

Reviewed against commit `75517c3`, with the deeper-pass changes left uncommitted.

## Assessment

This project is useful as an open, inspectable UAV telemetry diagnostic and an
integration starting point. The reusable decoder is now the strongest part.
It is not yet a production FMV engine, survey/geolocation solution, or complete
STANAG/MISB implementation. A checksum-valid packet is not evidence that its
position, altitude datum, camera geometry, or timestamp is physically correct.

| Use case | Assessment |
| --- | --- |
| Inspect/extract ST 0601 metadata from known feeds | Useful now, within documented tag/carriage coverage |
| Prototype telemetry dashboards or Node processing | Useful; standalone API, exact timestamps, diagnostics, JSONL export |
| Compare sensor positions and frame-center metadata | Useful after checking units/datum and the source's behavior |
| Multi-vendor, frame-synchronized operational FMV | Further engineering and interoperability testing required |
| Accurate camera footprints or orthorectification | Not implemented; current FPV view is illustrative |
| Mission-critical processing of arbitrary untrusted video | Not established by this review |

Real systems already use KLV with broader media stacks. GStreamer's
[mpegtsmux](https://gstreamer.freedesktop.org/documentation/mpegtsmux/mpegtsmux.html)
accepts parsed KLV alongside modern video codecs. A practical deployment path
is to use a mature media framework for ingest and video, then feed raw metadata
to this decoder. This avoids transcoding video to MPEG-1 merely to read KLV.

Esri's [FMV metadata requirements](https://support.esri.com/en-us/knowledge-base/what-misb-compliant-metadata-attributes-should-data-hav-000015970)
also distinguish locating a sensor/frame center from computing a video footprint.
The project should make the same distinction: drawing a moving aircraft is not
proof that the camera view aligns with the terrain.

## Issues addressed in this pass

- Extracted a dependency-free decoder from the JSMpeg-specific class. It works
  directly in Node or as a browser script, with TypeScript declarations.
- Preserved exact UTC microseconds as a decimal string alongside the Date, plus
  the transport PTS associated with the first packet byte and a stream offset.
- Added error callbacks/counters, structural strict mode, packet/field limits,
  EOF and connection-reset handling. Checksum verification now precedes value
  conversions and allocations for decoded fields.
- Added a table of 64 numeric mappings, seven UTF-8 fields, timestamp/checksum
  handling, units, full attitude fields, and raw preservation of unsupported
  values. See [supported fields](supported-fields.md).
- Derived absolute offset corners only from values in the same packet; no
  previous stream's/frame's center can leak into that calculation.
- Reworked PES assembly to handle fragmented headers, continuity gaps,
  duplicate packets, malformed headers, transport errors, and explicit PID
  selection. Different PIDs sharing private-stream ID 0xBD cannot be merged.
- Bounded zero-length PES accumulation and copied only retained bytes, avoiding
  a small Buffer/subarray holding a whole large network chunk alive.
- Kept every metadata callback/event while limiting UI work to the latest
  update per animation frame. Added stale-telemetry indication and full-angle
  preference in the aircraft model.
- Added a backpressure-aware raw KLV-to-JSONL exporter and reproducible benchmark.

The metadata parser and transport demuxer are substantial internal changes.
They preserve the public `payload` shape, but consumers relying on undocumented
BitBuffer internals or the old conversion helper methods need to migrate to
the [standalone API](decoder-api.md). Unknown values now explicitly indicate
that they are not decoded. Additional packet properties are additive.

## Performance evidence

Node 24.18.0, Apple M4 Pro, median of five runs per case through the same VM
adapter harness, without retaining emitted objects. Baseline is the parser
pushed in `75517c3`. Each small-packet run used 50,000 repetitions of the real
163-byte fixture; each large-packet run used 200 repetitions. Warm-up and
explicit GC occurred outside timed sections.

| Case | Baseline packets/s | Revised packets/s | Relative throughput |
| --- | ---: | ---: | ---: |
| Real 163-byte packet | 226,723 | 304,056 | 1.34× |
| Valid packet with 64 KiB unknown value | 707 | 2,693 | 3.81× |
| Corrupted packet with 64 KiB value | 711 | 20,219 rejected/s | 28.44× |

For the small fixture, internal stream-buffer capacity fell from 524,288 bytes
to 4,096 bytes (128× smaller). For the large cases it was 131,072 bytes. These
are buffer capacities, not total heap/RSS measurements. Unknown data still
expands when rendered as hex, and caller-retained output remains the caller's
responsibility.

The results are local microbenchmarks, not latency/SLA guarantees, camera
throughput estimates, or a comparison with another vendor's parser. Video
transcoding, JavaScript MPEG-1 decoding, WebGL rendering, network jitter and
consumer work are excluded. Both outputs and exercised code changed: the new
parser decodes more fields and provides diagnostics.

Raw results: [industry-benchmark.json](industry-benchmark.json).
Run `node --expose-gc app/scripts/benchmark.js /path/to/baseline/app` to compare
with a baseline checkout, or omit the argument for the current implementation.

## Verification

- 46 Node unit/integration tests, including a deterministic 5,000-packet
  malformed-input exercise, byte-at-a-time parsing, every packet split,
  exact microseconds/PTS, bounded buffers, same-packet corners, PID separation,
  loss/duplication, header fragmentation, reconnection and JSONL export.
- Four local Chrome tests: moving video, raw output, experimental video
  material, controls, plus a 1,000-event telemetry burst coalesced into at most
  two display updates and a stale-data check.
- The same 3,722,024-byte transcoded flight excerpt still produces 802 decoded
  video frames and one checksum-valid metadata packet. No continuity,
  transport, malformed-PES or parser errors were reported for that excerpt.
- Independent reference material includes the real FFmpeg flight packet and
  published numerical examples from
  [MISB ST 0601.8](https://upload.wikimedia.org/wikipedia/commons/1/19/MISB_Standard_0601.pdf).
  This is a narrow corpus, not a multi-vendor certification exercise.

The previous hosted CI run passed the Node 22 job. Its Node 24 globe browser
test exceeded the 30-second timeout; the other two browser tests passed. This
pass reduces the viewport, allows 90 seconds and retains failure traces. The
new configuration passes locally but has not yet been rerun on Linux. The
previous dependency removals have been reassessed by GitHub: zero open
Dependabot alerts were returned during this review.

## Remaining adoption gates, in priority order

1. **Standards and corpus coverage.** Pin target versions with prospective
   users, gather authorized recordings from several encoders, and compare
   decoded values with an independent implementation. Implement version-aware
   mappings, nested security/VMTI sets and newer encodings such as IMAP as
   required. Strict mode here does not validate every ST 0601 rule, allowed
   value, version transition, or required reporting frequency.
2. **Media interoperability and synchronization.** Use PAT/PMT and registration
   descriptors to identify programs and metadata rather than guessing from
   PES IDs. Add synchronous carriage/access-unit support and clock rollover,
   discontinuity and UTC/PTS alignment. The current demuxer supports 188-byte
   TS and the private-stream path; it does not establish support for ST 1402,
   192/204-byte framing, or every camera's transport. Native H.264/H.265 playback
   and timestamp-matched metadata should replace MPEG-1 for operational use.
3. **Geospatial correctness.** Compose platform and sensor rotations correctly,
   preserve altitude datum information, apply geoid/terrain models, and validate
   camera calibration and footprints against known ground truth. The existing
   heading addition/level-roll FPV approximation is unsuitable for measurement.
4. **Operational behavior.** Add authenticated viewers, TLS/ingest controls,
   metrics, application timeouts, long-duration soak tests, load tests with
   slow clients, and worker/process isolation for media decoding. The Node
   relay remains a local development service. The vendored MPEG-1 decoder was
   not comprehensively fuzzed and should not be treated as hardened against
   arbitrary hostile video.
5. **Reusable release discipline.** Package/version the standalone decoder,
   define compatibility guarantees, verify its declarations with a TypeScript
   consumer, broaden the OS/browser matrix, and publish compatibility fixtures
   and a supported-standard/version matrix. No npm release was made here.

A sensible next milestone is a metadata-only library release for a small,
agreed set of encoders, with independent cross-decoder fixtures. A full
operational video/geolocation product is a materially larger scope.
