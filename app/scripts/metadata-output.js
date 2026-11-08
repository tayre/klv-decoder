'use strict';

const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

function timestamp(packet) {
  const field = packet.payload.unix_time_stamp;
  const microseconds = field?.microseconds ?? null;
  const date = field?.value;
  // Date holds milliseconds; restore the exact fractional second from tag 2.
  const utc = date instanceof Date && Number.isFinite(date.getTime()) && microseconds !== null
    ? date.toISOString().replace(/\.\d{3}Z$/, `.${(BigInt(microseconds) % 1000000n).toString().padStart(6, '0')}Z`)
    : null;
  return { utc, microseconds };
}

function position(packet) {
  const latitude = numeric(packet.payload.sensor_latitude?.value);
  const longitude = numeric(packet.payload.sensor_longitude?.value);
  return latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? [longitude, latitude] : null;
}

function telemetry(packet) {
  const p = packet.payload;
  const time = timestamp(packet);
  return {
    timestamp_utc: time.utc,
    timestamp_microseconds: time.microseconds,
    pts_seconds: packet.pts,
    offset_bytes: packet.offset,
    mission_id: p.mission_id?.value ?? null,
    platform_tail_number: p.platform_tail_number?.value ?? null,
    sensor_latitude_deg: numeric(p.sensor_latitude?.value),
    sensor_longitude_deg: numeric(p.sensor_longitude?.value),
    sensor_altitude_hae_m: numeric(p.sensor_ellipsoid_height?.value),
    sensor_altitude_msl_m: numeric(p.sensor_true_altitude?.value),
    platform_heading_deg: numeric(p.platform_heading_angle?.value),
    platform_pitch_deg: numeric(p.platform_pitch_angle_full?.value) ?? numeric(p.platform_pitch_angle?.value),
    platform_roll_deg: numeric(p.platform_roll_angle_full?.value) ?? numeric(p.platform_roll_angle?.value),
    ground_speed_mps: numeric(p.platform_ground_speed?.value),
    frame_center_latitude_deg: numeric(p.frame_center_latitude?.value),
    frame_center_longitude_deg: numeric(p.frame_center_longitude?.value),
    warnings: packet.warnings,
    payload: p
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Identifiers originate in the feed. Keep spreadsheet formula-like text inert;
  // actual numeric values, including negative coordinates, remain numeric.
  if (typeof value === 'string' && /^(?:\s*[=+@-]|[\t\r\n])/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

class Summary {
  constructor({ format, pid }) {
    this.format = format;
    this.pid = pid;
    this.fields = new Map();
    this.warnings = {};
    this.timestampedPackets = 0;
    this.startTime = null;
    this.endTime = null;
    this.previousTime = null;
    this.outOfOrderTimestamps = 0;
    this.validPositions = 0;
  }

  start() { return ''; }

  write(packet) {
    const time = timestamp(packet);
    if (time.utc !== null) {
      const micros = BigInt(time.microseconds);
      this.timestampedPackets++;
      if (this.previousTime !== null && micros < this.previousTime) this.outOfOrderTimestamps++;
      this.previousTime = micros;
      if (this.startTime === null || micros < this.startTime.micros) this.startTime = { ...time, micros };
      if (this.endTime === null || micros > this.endTime.micros) this.endTime = { ...time, micros };
    }
    if (position(packet)) this.validPositions++;
    for (const warning of packet.warnings) {
      this.warnings[warning.code] = (this.warnings[warning.code] ?? 0) + 1;
    }
    for (const [name, field] of Object.entries(packet.payload)) {
      let counts = this.fields.get(field.key);
      if (!counts) {
        counts = { tag: field.key, name, packets: 0, decoded: 0, undecoded: 0, invalid: 0, unsupportedLength: 0 };
        this.fields.set(field.key, counts);
      }
      counts.packets++;
      if (field.decoded === false) counts.undecoded++;
      else if (field.value === null || field.error || field.unsupported_length) counts.invalid++;
      else counts.decoded++;
      if (field.unsupported_length) counts.unsupportedLength++;
    }
    return '';
  }

  end({ stats, transport }) {
    const duration = this.startTime === null ? null : Number(this.endTime.micros - this.startTime.micros) / 1e6;
    return JSON.stringify({
      inputFormat: this.format,
      metadataPid: this.pid,
      stats,
      ...(transport ? { transport } : {}),
      timestamps: {
        packets: this.timestampedPackets,
        missingOrInvalidPackets: stats.packetsDecoded - this.timestampedPackets,
        start: this.startTime?.utc ?? null,
        end: this.endTime?.utc ?? null,
        startMicroseconds: this.startTime?.microseconds ?? null,
        endMicroseconds: this.endTime?.microseconds ?? null,
        durationSeconds: duration,
        meanPacketRateHz: duration > 0 ? (this.timestampedPackets - 1) / duration : null,
        outOfOrder: this.outOfOrderTimestamps
      },
      positions: { valid: this.validPositions, missingOrInvalid: stats.packetsDecoded - this.validPositions },
      warnings: this.warnings,
      fields: [...this.fields.values()].sort((a, b) => a.tag - b.tag)
    }, null, 2) + '\n';
  }

  diagnostics() { return {}; }
}

function createOutput(options) {
  if (options.output === 'summary') return new Summary(options);

  const output = { start: () => '', end: () => '', diagnostics: () => ({}) };
  if (options.output === 'csv') {
    const columns = Object.keys(telemetry({ payload: {}, warnings: [], pts: null, offset: 0 }));
    output.start = () => columns.map(name => name === 'payload' || name === 'warnings' ? name + '_json' : name).join(',') + '\r\n';
    output.write = packet => {
      const row = telemetry(packet);
      return columns.map(name => csvCell(row[name])).join(',') + '\r\n';
    };
  } else if (options.output === 'geojson') {
    let features = 0;
    let skippedPositions = 0;
    output.start = () => '{"type":"FeatureCollection","features":[\n';
    output.write = packet => {
      const coordinates = position(packet);
      if (coordinates === null) { skippedPositions++; return ''; }
      // Keep geometry 2D: tag 15 is MSL, not GeoJSON's ellipsoid height.
      const feature = { type: 'Feature', geometry: { type: 'Point', coordinates }, properties: telemetry(packet) };
      return (features++ ? ',\n' : '') + JSON.stringify(feature);
    };
    output.end = () => '\n]}\n';
    output.diagnostics = () => ({ export: { format: 'geojson', features, skippedPositions } });
  } else {
    output.write = packet => JSON.stringify(packet) + '\n';
  }
  return output;
}

module.exports = { createOutput };
