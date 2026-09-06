/* UAS local-set decoder. Original integration by Tom Ayre. Apache-2.0. */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KLVDecoder = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';
    const names = {
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
	};
    Object.assign(names, {90:'platform_pitch_angle_full',91:'platform_roll_angle_full',
        92:'platform_angle_of_attack_full',93:'platform_sideslip_angle_full'});
    const key = Uint8Array.from([6,14,43,52,2,11,1,1,14,1,3,1,1,0,0,0]);
    const keyHex = '060e2b34020b01010e01030101000000';
    const hexBytes = Array.from({length:256}, (_,i) => i.toString(16).padStart(2,'0'));
    const text = new TextDecoder('utf-8');
    const hex = bytes => {
        const chunks=[];
        for(let start=0;start<bytes.length;start+=4096){
            const end=Math.min(start+4096,bytes.length),chars=new Array(end-start);
            for(let i=start;i<end;i++)chars[i-start]=hexBytes[bytes[i]];
            chunks.push(chars.join(''));
        }
        return chunks.join('');
    };
    // [width, signed, physical minimum, physical maximum, unit]. ST 0601.8.
    const fields = {};
    const add = (tags,width,signed,min,max,unit) => {
        for (const tag of tags) fields[tag] = Object.freeze({width,signed,min,max,unit,
            scale:signed ? max/(2**(width*8-1)-1):(max-min)/(2**(width*8)-1),
            invalid:-(2**(width*8-1))});
    };
    add([5,64,71],2,false,0,360,'degrees');
    add([6,50,52],2,true,-20,20,'degrees');
    add([7],2,true,-50,50,'degrees');
    add([8,9,56],1,false,0,255,'m/s');
    add([13,23,40,67,82,84,86,88,90,91,92],4,true,-90,90,'degrees');
    add([14,19,24,41,68,83,85,87,89,93],4,true,-180,180,'degrees');
    add([15,25,38,42,54,69,75],2,false,-900,19000,'m');
    add([16,17],2,false,0,180,'degrees');
    add([18,20],4,false,0,360,'degrees');
    add([21,57],4,false,0,5000000,'m');
    add([22],2,false,0,10000,'m');
    add([26,27,28,29,30,31,32,33],2,true,-0.075,0.075,'degrees');
    add([35],2,false,0,360,'degrees');
    add([36],1,false,0,100,'m/s');
    add([37,49,53],2,false,0,5000,'mbar');
    add([45,46],2,false,0,4095,'m');
    add([51],2,true,-180,180,'m/s');
    add([55],1,false,0,100,'%');
    add([58],2,false,0,10000,'kg');
    add([65],1,false,0,255,null);
    const strings = new Set([3,4,10,11,12,59,70]);
    const checksum = bytes => {
        let sum=0;
        for(let i=0;i<bytes.length;i++) sum=(sum+bytes[i]*(i%2 ? 1:256)) & 65535;
        return sum;
    };
    function lengthAt(bytes, pos, end, strict) {
        if(pos>=end) return null;
        const first=bytes[pos++];
        if(first<128) return {value:first,next:pos};
        const count=first & 127;
        if(count===0 || count>4) return {error:'invalid_ber_length'};
        if(pos+count>end) return null;
        let value=0;
        for(let i=0;i<count;i++) value=value*256+bytes[pos+i];
        if(strict && (value<128 || bytes[pos]===0)) return {error:'noncanonical_ber_length'};
        return {value,next:pos+count};
    }
    function decodeValue(tag, bytes, view, offset) {
        const result={key:tag,length:bytes.length,value:null};
        const width=tag===1 ? 2 : tag===2 ? 8 : fields[tag]?.width;
        if(width!==undefined && bytes.length!==width) {
            return {...result,raw:hex(bytes),unsupported_length:true};
        }
        
        if(tag===1) result.value=view.getUint16(offset);
        else if(tag===2) {
            const micros=view.getBigUint64(offset);
            result.microseconds=micros.toString();
            const date=new Date(Number(micros/1000n));
            result.value=Number.isNaN(date.getTime()) ? null:date;
        } else if(fields[tag]) {
            const f=fields[tag];
            let integer=f.width===1 ? view.getUint8(offset) : f.width===2 ?
                (f.signed ? view.getInt16(offset):view.getUint16(offset)) : (f.signed ? view.getInt32(offset):view.getUint32(offset));
            result.unit=f.unit;
            if(f.signed && integer===f.invalid) result.error='out_of_range';
            else result.value=(f.signed ? 0:f.min)+integer*f.scale;
        } else if(strings.has(tag)) result.value=text.decode(bytes);
        else {result.value=hex(bytes);result.raw=result.value;result.decoded=false;}
        return result;
    }
    class Decoder {
        constructor(options={}) {
            this.maxPacketSize=options.maxPacketSize ?? 1024*1024;
            this.maxFields=options.maxFields ?? 1024;
            if(!Number.isInteger(this.maxPacketSize) || this.maxPacketSize<4 || this.maxPacketSize>16*1024*1024)
                throw new RangeError('maxPacketSize must be between 4 and 16777216 bytes');
            if(!Number.isInteger(this.maxFields) || this.maxFields<1) throw new RangeError('maxFields must be positive');
            this.strict=options.strict ?? false;
            this.onPacket=options.onPacket || (()=>{});
            this.onError=options.onError || (()=>{});
            this.bytes=new Uint8Array(Math.min(4096,this.maxPacketSize+21));
            this.start=0;this.limit=0;this.offset=0;this.pending=null;this.busy=false;this.marks=[];
            this.stats={bytesReceived:0,packetsDecoded:0,packetsRejected:0,discardedBytes:0,errors:{}};
        }
        get bufferedBytes(){return this.limit-this.start;}
        get bufferCapacity(){return this.bytes.length;}
        _error(code,offset=this.offset+this.start) {
            this.stats.packetsRejected++;
            this.stats.errors[code]=(this.stats.errors[code] || 0)+1;
            this.onError({code,offset});
        }
        push(input,pts=null) {
            if(this.busy) throw new Error('Decoder.push is not reentrant');
            const inputBytes=input instanceof ArrayBuffer ? new Uint8Array(input):input;
            if(!(inputBytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array or ArrayBuffer');
            this.busy=true;
            const before=this.stats.packetsDecoded;
            try {
                if(inputBytes.length && (!this.marks.length || this.marks[this.marks.length-1].pts!==pts))
                    this.marks.push({offset:this.stats.bytesReceived,pts});
                this.stats.bytesReceived+=inputBytes.length;
                let pos=0;
                while(pos<inputBytes.length) {
                    if(this.limit===this.bytes.length) {
                        if(this.start) {
                            this.bytes.copyWithin(0,this.start,this.limit);
                            this.limit-=this.start;this.offset+=this.start;this.start=0;
                        } else {
                            const grown=new Uint8Array(Math.min(this.bytes.length*2,this.maxPacketSize+21));
                            if(grown.length===this.bytes.length) throw new Error('Internal framing limit exceeded');
                            grown.set(this.bytes);this.bytes=grown;
                        }
                    }
                    const count=Math.min(inputBytes.length-pos,this.bytes.length-this.limit);
                    this.bytes.set(inputBytes.subarray(pos,pos+count),this.limit);
                    this.limit+=count;pos+=count;
                    this._drain(pts);
                }
                return this.stats.packetsDecoded-before;
            } finally {
                const oldest=this.pending ? this.offset+this.limit:this.offset+this.start;
                while(this.marks.length>1 && this.marks[1].offset<=oldest)this.marks.shift();
                this.busy=false;
            }
        }
        _drain(pts) {
            while(this.start<this.limit) {
                if(!this.pending) {
                    let found=false;
                    while(this.start+16<=this.limit) {
                        let j=0;while(j<16 && this.bytes[this.start+j]===key[j])j++;
                        if(j===16){found=true;break;}
                        this.start++;this.stats.discardedBytes++;
                    }
                    if(!found)return;
                    const length=lengthAt(this.bytes,this.start+16,this.limit,this.strict);
                    if(!length)return;
                    if(length.error || length.value<4 || length.value>this.maxPacketSize) {
                        const offset=this.offset+this.start;this.start++;
                        this._error(length.error || 'packet_length_limit',offset);continue;
                    }
                    let packetPts=pts;
                    for(const mark of this.marks){if(mark.offset<=this.offset+this.start)packetPts=mark.pts;else break;}
                    this.pending={header:length.next-this.start,total:length.next-this.start+length.value,pts:packetPts};
                }
                if(this.bufferedBytes<this.pending.total)return;
                const offset=this.offset+this.start;
                const packet=this.bytes.subarray(this.start,this.start+this.pending.total);
                const pending=this.pending;
                this.start+=pending.total;this.pending=null;
                const result=this._packet(packet,pending.header,pending.pts,offset);
                if(result){this.stats.packetsDecoded++;this.onPacket(result);}
            }
        }
        _packet(bytes,header,pts,offset) {
            const reject=code=>{this._error(code,offset);return null;};
            if(bytes[bytes.length-4]!==1 || bytes[bytes.length-3]!==2) return reject('missing_checksum');
            if(checksum(bytes.subarray(0,-2))!==bytes[bytes.length-2]*256+bytes[bytes.length-1])return reject('checksum_mismatch');
            const payload={},seen=new Set(),warnings=[];
            const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
            let pos=header;
            while(pos<bytes.length) {
                if(seen.size>=this.maxFields)return reject('field_count_limit');
                let tag=0,count=0,byte;
                do {
                    if(pos>=bytes.length || ++count>4)return reject('invalid_tag');
                    byte=bytes[pos++];
                    if(this.strict && count===1 && byte===128)return reject('noncanonical_tag');
                    tag=tag*128+(byte & 127);
                } while(byte & 128);
                if(tag===0 || seen.has(tag))return reject('duplicate_or_reserved_tag');
                if(this.strict && !seen.size && tag!==2)return reject('timestamp_not_first');
                seen.add(tag);
                const length=lengthAt(bytes,pos,bytes.length,this.strict);
                if(!length || length.error || length.next+length.value>bytes.length)return reject(length?.error || 'field_overrun');
                const item=decodeValue(tag,bytes.subarray(length.next,length.next+length.value),view,length.next);
                if(this.strict && (item.unsupported_length || (tag===2 && item.value===null)))return reject('invalid_field');
                if(item.unsupported_length)warnings.push({code:'unsupported_length',tag});
                payload[names[tag] || 'unknown_'+tag]=item;
                pos=length.next+length.value;
                if(tag===1 && pos!==bytes.length)return reject('checksum_not_last');
            }
            if(!seen.has(2))warnings.push({code:'missing_timestamp'});
            // Offsets remain offsets; expose absolute corners separately, only when
            // the same packet supplies a valid frame center. Never reuse prior state.
            const corners=[];
            for(let i=0;seen.has(26) && i<4;i++) {
                const lat=payload[names[26+i*2]]?.value,lon=payload[names[27+i*2]]?.value;
                const centerLat=payload.frame_center_latitude?.value,centerLon=payload.frame_center_longitude?.value;
                if([lat,lon,centerLat,centerLon].every(v=>typeof v==='number' && Number.isFinite(v))) {
                    const latitude=centerLat+lat;
                    if(Math.abs(latitude)<=90)corners.push({corner:i+1,latitude,longitude:((centerLon+lon+540)%360)-180});
                }
            }
            return {universal_key:keyHex,payload_length:bytes.length-header,payload,pts,offset,
                checksum_valid:true,warnings,derived:{corners}};
        }
        reset(reason='stream_reset') {
            if(this.busy)throw new Error('Cannot reset while decoding');
            const buffered=this.bufferedBytes;
            this.start=0;this.limit=0;this.pending=null;this.offset=this.stats.bytesReceived;this.marks=[];
            if(buffered)this._error(reason,0);
        }
        end() {
            this.reset('truncated_packet');
            return {...this.stats,errors:{...this.stats.errors}};
        }
    }
    Decoder.checksum=checksum;
    Decoder.fields=Object.freeze(fields);
    Decoder.names=Object.freeze(names);
    return Decoder;
});
