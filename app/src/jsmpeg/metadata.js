/*
 * @author Tom Ayre <ayre.tom+github@gmail.com>
 */

JSMpeg.Decoder.Metadata = (function() {
	"use strict";

	var DATA = function(options) {
        options = options || {};
        JSMpeg.Decoder.Base.call(this, options);
        this.maxPacketSize = options.metadataMaxPacketSize || 1024 * 1024;
        this.bits = new JSMpeg.BitBuffer(512 * 1024, JSMpeg.BitBuffer.MODE.EXPAND);
    };
    DATA.prototype = Object.create(JSMpeg.Decoder.Base.prototype);
    DATA.prototype.constructor = DATA;

    // Compact consumed bytes, retaining an incomplete key or packet between writes.
    DATA.prototype.write = function(pts, buffers) {
        var consumed = this.bits.index >> 3;
        this.bits.bytes.copyWithin(0, consumed, this.bits.byteLength);
        this.bits.byteLength -= consumed;
        this.bits.index = 0;
        this.bits.write(buffers);
        this.canPlay = true;
        this.decode();
    };

    DATA.prototype.decode = function() {
        var decoded = false;
        while (this.readLDSPacket()) { decoded = true; }
        return decoded;
    };

    // Definite BER length, bounded to keep malformed inputs from allocating forever.
    DATA.prototype.readLength = function(end) {
        if ((this.bits.index >> 3) >= end) { return null; }
        var first = this.bits.read(8);
        if (first < 128) { return first; }
        var count = first & 127;
        if (count === 0 || count > 4) { return -1; }
        if ((this.bits.index >> 3) + count > end) { return null; }
        var length = 0;
        while (count--) { length = length * 256 + this.bits.read(8); }
        return length;
    };

    DATA.prototype.readLDSPacket = function() {
        var bits = this.bits;
        var searchStart = bits.index;
        if (bits.findNextUniversalKey() === -1) {
            bits.index = Math.max(searchStart, (bits.byteLength - 15) * 8);
            return false;
        }
        var start = (bits.index >> 3) - 16;
        var length = this.readLength(bits.byteLength);
        if (length === null) { bits.index = start * 8; return false; }
        if (length < 4 || length > this.maxPacketSize) {
            bits.index = (start + 1) * 8;
            return true;
        }
        var end = (bits.index >> 3) + length;
        if (end > bits.byteLength) { bits.index = start * 8; return false; }
        var result = {
            universal_key: '060e2b34020b01010e01030101000000',
            payload_length: length,
            payload: {}
        };
        var valid = false;
        var seen = {};
        while ((bits.index >> 3) < end) {
            // Local tags are BER-OID integers; preserve unknown tags by number.
            var key = 0, octet, count = 0;
            do {
                if ((bits.index >> 3) >= end || ++count > 4) { break; }
                octet = bits.read(8);
                key = key * 128 + (octet & 127);
            } while (octet & 128);
            if (count > 4 || (octet & 128) || seen[key]) { break; }
            seen[key] = true;
            var size = this.readLength(end);
            var valueEnd = (bits.index >> 3) + size;
            if (size === null || size < 0 || valueEnd > end) { break; }
            var expected = DATA.LENGTHS[key];
            if (key === 1 && size !== 2) { break; }
            // Older ST 0601 versions can use different widths. Keep those bytes
            // without guessing a conversion or losing the rest of a valid packet.
            var unsupported = expected !== undefined && size !== expected;
            var raw = unsupported ? Array.from(bits.bytes.subarray(bits.index >> 3, valueEnd), function(b) {
                return b.toString(16).padStart(2, '0');
            }).join('') : null;
            var value = unsupported ? null : this.getKLVValue(key, size);
            bits.index = valueEnd * 8;
            var tag = DATA.KLV_METADATA_ELEMENTS[key] || ('unknown_' + key);
            result.payload[tag] = {key: key, length: size, value: value};
            if (unsupported) { result.payload[tag].raw = raw; result.payload[tag].unsupported_length = true; }
            if (key === 1) {
                valid = valueEnd === end && this.verifyCRC(value, size, start * 8);
                break;
            }
        }
        bits.index = end * 8;
        if (valid && this.destination) { this.destination.render(result); }
        return true;
    };

    DATA.LENGTHS = {1:2, 2:8, 5:2, 6:2, 7:2, 8:1, 9:1,
        13:4, 14:4, 15:2, 16:2, 17:2, 18:4, 19:4, 20:4, 21:4,
        22:2, 23:4, 24:4, 25:2, 26:2, 27:2, 28:2, 29:2, 30:2,
        31:2, 32:2, 33:2, 65:1, 75:2, 82:4, 83:4, 84:4, 85:4,
        86:4, 87:4, 88:4, 89:4};

    DATA.prototype.readSigned = function(width) {
        var value = this.bits.read(width);
        if (width === 16 && value >= 32768) { value -= 65536; }
        return value === -(Math.pow(2, width - 1)) ? null : value;
    };

	DATA.prototype.getKLVValue = function(key, length) {
		switch (key) {
			case 1: // crc
				return this.bits.read(16);
            case 2: // UTC microseconds; divide before converting to Number.
                var micros = 0n;
                for (var i = 0; i < 8; i++) { micros = (micros << 8n) | BigInt(this.bits.read(8)); }
                var date = new Date(Number(micros / 1000n));
                return Number.isNaN(date.getTime()) ? null : date;
			case 5:
				return this.to_lds_platform_heading(this.bits.read(16));
			case 6:
				return this.to_lds_platform_pitch(this.readSigned(16));
			case 7:
				return this.to_lds_platform_roll(this.readSigned(16));
			case 8:
				return this.to_lds_platform_true_airspeed(this.bits.read(8));
			case 9:
				return this.to_lds_platform_indicated_airspeed(this.bits.read(8));
			case 13:
				return this.to_lds_latitude(this.readSigned(32));
			case 14:
				return this.to_lds_longitude(this.readSigned(32));
			case 75:
			case 15:
				return this.to_lds_altitude(this.bits.read(16));
			case 16:
				return this.to_lds_sensor_horizontal_fov(this.bits.read(16));
			case 17:
				return this.to_lds_sensor_vertical_fov(this.bits.read(16));
			case 18:
				return this.to_lds_sensor_rel_azimuth_angle(this.bits.read(32) >>> 0);
			case 19:
				return this.to_lds_rel_elevation_angle(this.readSigned(32));
			case 20:
				return this.to_lds_rel_roll_angle(this.bits.read(32) >>> 0);
			case 21:
				return this.to_lds_slant_range(this.bits.read(32) >>> 0);
			case 22:
				return this.to_lds_target_width(this.bits.read(16));
			case 23:
				var lds_dec = this.to_lds_frame_center_latitude(this.readSigned(32));
				DATA.LDS_23 = lds_dec;
				return lds_dec;
			case 24:
				var lds_dec = this.to_lds_frame_center_longitude(this.readSigned(32));
				DATA.LDS_24 = lds_dec;
				return lds_dec;
			case 25:
				return this.to_lds_frame_center_elevation(this.bits.read(16));
			case 26:
				return this.to_lds_offset_corner_latitude_point(this.readSigned(16));
			case 27:
				return this.to_lds_offset_corner_longitude_point(this.readSigned(16));
			case 28:
				return this.to_lds_offset_corner_latitude_point(this.readSigned(16));
			case 29:
				return this.to_lds_offset_corner_longitude_point(this.readSigned(16));
			case 30:
				return this.to_lds_offset_corner_latitude_point(this.readSigned(16));
			case 31:
				return this.to_lds_offset_corner_longitude_point(this.readSigned(16));
			case 32:
				return this.to_lds_offset_corner_latitude_point(this.readSigned(16));
			case 33:
				return this.to_lds_offset_corner_longitude_point(this.readSigned(16));
			case 65:
				return this.to_uas_lds_version_number(this.bits.read(8));
			case 3:
			case 4:
			case 10:
			case 11:
			case 12:
			case 59:
				return this.to_lds_string(length);
			case 82:
				return this.to_lds_latitude(this.readSigned(32));
			case 83:
				return this.to_lds_longitude(this.readSigned(32));
			case 84:
				return this.to_lds_latitude(this.readSigned(32));
			case 85:
				return this.to_lds_longitude(this.readSigned(32));
			case 86:
				return this.to_lds_latitude(this.readSigned(32));
			case 87:
				return this.to_lds_longitude(this.readSigned(32));
			case 88:
				return this.to_lds_latitude(this.readSigned(32));
			case 89:
				return this.to_lds_longitude(this.readSigned(32));
			default:
				var raw = [];
                for (var i = 0; i < length; i++) { raw.push(this.bits.read(8).toString(16).padStart(2, '0')); }
                return raw.join('');
		}
	}

    DATA.prototype.to_lds_string = function(numbytes) {
        var bytes = new Uint8Array(numbytes);
        for (var i = 0; i < numbytes; i++) { bytes[i] = this.bits.read(8); }
        return new TextDecoder('utf-8').decode(bytes);
    };

	// Convert int16 to LDS platform heading
	DATA.prototype.to_lds_platform_heading = function(lds_int) {
		return (360 / 65535) * lds_int;
	}

	// Convert int16 to LDS platform pitch
	DATA.prototype.to_lds_platform_pitch = function(lds_int) {
        if (lds_int === null) { return null; }
		return (40 / 65534) * lds_int;
	}

	// Convert int16 to LDS platform roll
	DATA.prototype.to_lds_platform_roll = function(lds_int) {
        if (lds_int === null) { return null; }
		return (100 / 65534) * lds_int;
	}

	// Convert int8 to LDS true airspeed
	DATA.prototype.to_lds_platform_true_airspeed = function(lds_int) {
		return lds_int;
	}

	// Convert int8 to LDS true airspeed
	DATA.prototype.to_lds_platform_indicated_airspeed = function(lds_int) {
		return lds_int;
	}

	// Convert int32 latitude to degrees latitude
	DATA.prototype.to_lds_latitude = function(lds_int) {
        if (lds_int === null) { return null; }
		return 180 / 0xFFFFFFFE * lds_int;
	}

	// Convert int32 longitude to degrees longitude
	DATA.prototype.to_lds_longitude = function(lds_int) {
        if (lds_int === null) { return null; }
		return 360 / 0xFFFFFFFE * lds_int;
	}

	// Convert int16 altitude to decimal altitude
	DATA.prototype.to_lds_altitude = function(lds_alt) {
		return 19900 / 0xFFFF * lds_alt - 900;
	}

	// Convert int16 to LDS sensor horizontal field of view
	DATA.prototype.to_lds_sensor_horizontal_fov = function(lds_int) {
		return 180 / 0xFFFF * lds_int;
	}

	// Convert int16 to LDS sensor vertical field of view
	DATA.prototype.to_lds_sensor_vertical_fov = function(lds_int) {
		return 180 / 0xFFFF * lds_int;
	}

	// Convert int32 to LDS sensor relative azimuth angle
	DATA.prototype.to_lds_sensor_rel_azimuth_angle = function(lds_int) {
		return 360 / 0xFFFFFFFF * lds_int;
	}

	// Convert int32 to LDS sensor relative elevation angle
	DATA.prototype.to_lds_rel_elevation_angle = function(lds_int) {
        if (lds_int === null) { return null; }
		return 360 / 0XFFFFFFFE * lds_int;
	}

	// Convert int32 to LDS sensor relative roll angle
	DATA.prototype.to_lds_rel_roll_angle = function(lds_int) {
		return 360 / 0xFFFFFFFF * lds_int;
	}

	// Convert int32 to LDS slant range
	DATA.prototype.to_lds_slant_range = function(lds_int) {
		return 5000000 / 0xFFFFFFFF * lds_int;
	}

	// Convert int16 to LDS target width
	DATA.prototype.to_lds_target_width = function(lds_int) {
		return 10000 / 0xFFFF * lds_int;
	}

	// Convert int32 to LDS frame center latitude
	DATA.prototype.to_lds_frame_center_latitude = function(lds_int) {
        if (lds_int === null) { return null; }
		return 180 / 0xFFFFFFFE * lds_int;
	}

	// Convert int32 to LDS frame center longitude
	DATA.prototype.to_lds_frame_center_longitude = function(lds_int) {
        if (lds_int === null) { return null; }
		return 360 / 0xFFFFFFFE * lds_int;
	}

	// Convert int16 to LDS frame center elevation
	DATA.prototype.to_lds_frame_center_elevation = function(lds_int) {
		return (19900 / 0xFFFF * lds_int) - 900;
	}

	// Convert int16 to LDS offset corner latitude point 1 to 4
	DATA.prototype.to_lds_offset_corner_latitude_point = function(lds_int, lds23) {
        if (lds_int === null) { return null; }
		return 0.15 / 65534 * lds_int;
	}

	// Convert int16 to LDS offset corner latitude point 1 to 4
	DATA.prototype.to_lds_offset_corner_longitude_point = function(lds_int, lds24) {
        if (lds_int === null) { return null; }
		return 0.15 / 65534 * lds_int;
	}

	// Convert int8 to uas lds version number
	DATA.prototype.to_uas_lds_version_number = function(lds_int) {
		return lds_int;
	}

	/* The paylod checksum is a running 16-bit sum through the entire LDS packet starting with the 16 byte Local Data Set key
	 * and ending with summing the 2 byte length field of the checksum data item (but not it's value).
	 * This is slighly inefficiently, since we are re-scanning the LDS packet.
	 * It would be better to maintain a sum as we read the LDS packet.
	 */
	DATA.prototype.verifyCRC = function(checksum, length, startIndex) {
		var endIndex = this.bits.index; // save pointer to current index
		var diff = this.bits.index - startIndex - (length << 3);
		var numbytes = diff >> 3;

		// rewind to the start of the packet
		this.bits.index = startIndex;

		var sum = 0;
		for (var i = 0; i < numbytes; i++) {
			sum += this.bits.read(8) << (8 * ((i + 1) % 2));
		}

		// fast forward to where we were before computing the checksum
		this.bits.index = endIndex;

		var bitMask = 0xFFFF; // get last 16 bits of the running sum
		return (sum & bitMask) === checksum;
	}

	DATA.LDS_23 = 0;
	DATA.LDS_24 = 0;

	DATA.KLV_METADATA_ELEMENTS = {
		1: "checksum",
		2: "unix_time_stamp",
		3: "mission_id",
		4: "platform_tail_number",
		5: "platform_heading_angle",
		6: "platform_pitch_angle",
		7: "platform_roll_angle",
		8: "platform_true_airspeed",
		9: "platform_indicated_airspeed",
		10: "platform_designation",
		11: "image_source_sensor",
		12: "image_coordinate_system",
		13: "sensor_latitude",
		14: "sensor_longitude",
		15: "sensor_true_altitude",
		16: "sensor_horizontal_fov",
		17: "sensor_vertical_fov",
		18: "sensor_relative_azimuth_angle",
		19: "sensor_relative_elevation_angle",
		20: "sensor_relative_roll_angle",
		21: "slant_range",
		22: "target_width",
		23: "frame_center_latitude",
		24: "frame_center_longitude",
		25: "frame_center_elevation",
		26: "offset_corner_latitude_point_1",
		27: "offset_corner_longitude_point_1",
		28: "offset_corner_latitude_point_2",
		29: "offset_corner_longitude_point_2",
		30: "offset_corner_latitude_point_3",
		31: "offset_corner_longitude_point_3",
		32: "offset_corner_latitude_point_4",
		33: "offset_corner_longitude_point_4",
		34: "icing_detected",
		35: "wind_direction",
		36: "wind_speed",
		37: "static_pressure",
		38: "density_altitude",
		39: "outside_air_temperature",
		40: "target_location_latitude",
		41: "target_location_longitude",
		42: "target_location_Elevation",
		43: "target_track_gate_width",
		44: "target_track_gate_height",
		45: "target_error_estimate_ce90",
		46: "target_error_estimate_le90",
		47: "generic_flag_data_01",
		48: "security_local_metadata_set",
		49: "differential_pressure",
		50: "platform_angle_of_attack",
		51: "platform_vertical_speed",
		52: "platform_sideslip_angle",
		53: "airfield_barometric_pressure",
		54: "airfield_elevation",
		55: "relative_humidity",
		56: "platform_ground_speed",
		57: "ground_range",
		58: "platform_fuel_remaining ",
		59: "platform_call_sign",
		60: "weapon_load",
		61: "weapon_fired",
		62: "laser_prf_code",
		63: "sensor_fov_name",
		64: "platform_magnetic_heading",
		65: "uas_lds_version_number",
		66: "target_location_covariance_matrix",
		67: "alternate_platform_latitude",
		68: "alternate_platform_longitude",
		69: "alternate_platform_altitude",
		70: "alternate_platform_name",
		71: "alternate_platform_heading",
		72: "event_start_time_utc",
		73: "remote_video_terminal_lds_conversion",
        75: "sensor_ellipsoid_height",
		82: "corner_latitude_point_1",
		83: "corner_longitude_point_1",
		84: "corner_latitude_point_2",
		85: "corner_longitude_point_2",
		86: "corner_latitude_point_3",
		87: "corner_longitude_point_3",
		88: "corner_latitude_point_4",
		89: "corner_longitude_point_4",
	}

	return DATA;
})();
