import Decoder = require('../../src/klv/decoder');
const packets: Decoder.Packet[] = [];
const decoder = new Decoder({strict:true,onPacket: packet => packets.push(packet),
  onError: error => {const offset: number=error.offset; void offset;}});
const count: number=decoder.push(new Uint8Array());
const stats: Decoder.Stats=decoder.end();
const micros: string | undefined=packets[0]?.payload.unix_time_stamp?.microseconds;
const coordinate: number | undefined=packets[0]?.derived.corners[0]?.latitude;
void [count,stats,micros,coordinate];
// @ts-expect-error strings are not supported binary inputs
decoder.push('invalid');
// @ts-expect-error field values are nullable and may be text, dates, or numbers
const invalid: number=packets[0].payload.sensor_latitude.value;
void invalid;
