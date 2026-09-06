`day-flight.klv` is one 163-byte telemetry packet extracted from the public FFmpeg
sample linked in the original project README:
https://samples.ffmpeg.org/MPEG2/mpegts-klv/Day%20Flight.mpg

Retrieved 2026-09-05 from the first 16 MiB. Extraction:

    ffmpeg -i day-flight-prefix.ts -map 0:d:0 -c copy -f data day-flight.klv

Only telemetry is included here, not footage. The packet advertises ST 0601
version 1 and ends with checksum 0x1c5f. Its target-width field is four bytes,
where the implemented modern conversion expects two; the test verifies that
this value is preserved as raw bytes rather than corrupting subsequent fields.

The independent checksum/heading/pitch vectors in metadata.test.js come from
MISB ST 0601.8 sections 8.1.2, 8.5 and 8.6:
https://upload.wikimedia.org/wikipedia/commons/1/19/MISB_Standard_0601.pdf
The pitch example is compared within half a quantization step.
