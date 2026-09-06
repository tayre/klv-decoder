declare class Decoder {
  constructor(options?: Decoder.Options);
  push(input: Uint8Array | ArrayBuffer, pts?: number | null): number;
  reset(reason?: string): void;
  end(): Decoder.Stats;
  readonly bufferedBytes: number;
  readonly bufferCapacity: number;
  readonly stats: Decoder.Stats;
  static checksum(bytes: Uint8Array): number;
  static readonly names: Readonly<Record<number, string>>;
  static readonly fields: Readonly<Record<number, Readonly<{
    width: number; signed: boolean; min: number; max: number; unit: string | null;
  }>>>;
}
declare namespace Decoder {
  interface Options {
    maxPacketSize?: number;
    maxFields?: number;
    strict?: boolean;
    onPacket?: (packet: Packet) => void;
    onError?: (error: {code: string; offset: number}) => void;
  }
  interface Field {
    key: number; length: number; value: number | string | Date | null;
    microseconds?: string; unit?: string | null; raw?: string;
    unsupported_length?: boolean; decoded?: boolean; error?: string;
  }
  interface Packet {
    universal_key: string; payload_length: number; payload: Record<string, Field>;
    pts: number | null; offset: number; checksum_valid: true;
    warnings: {code: string; tag?: number}[];
    derived: {corners: {corner: number; latitude: number; longitude: number}[]};
  }
  interface Stats {
    bytesReceived: number; packetsDecoded: number; packetsRejected: number;
    discardedBytes: number; errors: Record<string, number>;
  }
}
export = Decoder;
