/* MPEG-TS/PES demuxer for the JSMpeg live viewer. No PAT/PMT discovery. */
JSMpeg.Demuxer.TS = (function() {
    'use strict';
    function TS(options={}) {
        this.leftoverBytes=null;
        this.connections=new Map();
        this.states=new Map();
        this.maxPesSize=options.maxPesSize ?? 4*1024*1024;
        this.maxPidStates=options.maxPidStates ?? 64;
        if(!Number.isInteger(this.maxPesSize) || this.maxPesSize<264)throw new RangeError('maxPesSize must be at least 264');
        if(!Number.isInteger(this.maxPidStates) || this.maxPidStates<1)throw new RangeError('maxPidStates must be positive');
        this.guessVideoFrameEnd=true;
        this.startTime=0;this.currentTime=0;this.hasTime=false;
        this.stats={packets:0,discardedBytes:0,truncatedBytes:0,continuityErrors:0,duplicates:0,transportErrors:0,
            malformedPes:0,pesSizeLimit:0,ignoredPids:0,pidStateLimit:0};
    }
    TS.prototype.connect=function(streamId,destination,pid=null){
        if(pid!==null && (!Number.isInteger(pid) || pid<0 || pid>8191))throw new RangeError('Invalid PID');
        this.connections.set(streamId,{destination,pid,explicit:pid!==null});
    };
    TS.prototype.reset=function(){
        this.leftoverBytes=null;this.states.clear();this.hasTime=false;
        for(const connection of this.connections.values()){
            if(!connection.explicit)connection.pid=null;
            connection.destination.reset?.();
        }
    };
    TS.prototype.write=function(input){
        const bytes=input instanceof Uint8Array ? input:new Uint8Array(input);
        let data=bytes;
        if(this.leftoverBytes){
            data=new Uint8Array(this.leftoverBytes.length+bytes.length);
            data.set(this.leftoverBytes);data.set(bytes,this.leftoverBytes.length);
        }
        let pos=0;
        while(pos+188<=data.length){
            if(data[pos]!==0x47 || (pos+188<data.length && data[pos+188]!==0x47)){pos++;this.stats.discardedBytes++;continue;}
            this._packet(data.subarray(pos,pos+188));pos+=188;
        }
        // Copy only the tail: retaining a subarray can pin an entire network chunk.
        this.leftoverBytes=pos<data.length ? new Uint8Array(data.subarray(pos)):null;
    };
    TS.prototype._drop=function(state){
        if(state?.destination)state.destination.reset?.();
        if(state){state.buffers=[];state.length=0;state.active=false;state.header=null;}
    };
    TS.prototype._packet=function(packet){
        this.stats.packets++;
        const pid=((packet[1]&31)<<8)|packet[2],start=!!(packet[1]&64),cc=packet[3]&15;
        const control=(packet[3]>>4)&3;
        let state=this.states.get(pid),pos=4,discontinuity=false;
        if((packet[1]&128) || (packet[3]&192) || control===0){
            this.stats.transportErrors++;this._drop(state);return;
        }
        if(control&2){
            const size=packet[pos++];
            if(pos+size>188){this.stats.transportErrors++;this._drop(state);return;}
            discontinuity=size>0 && !!(packet[pos]&128);pos+=size;
        }
        if(discontinuity && state){this._drop(state);state.cc=null;}
        if(!(control&1) || pos===188)return;
        if(state?.cc!==undefined && state.cc!==null){
            if(cc===state.cc){this.stats.duplicates++;return;}
            if(cc!==((state.cc+1)&15)){this.stats.continuityErrors++;this._drop(state);}
        }
        if(!state){
            if(!start)return;
            if(this.states.size>=this.maxPidStates){this.stats.pidStateLimit++;return;}
            state={cc:null,buffers:[],length:0,active:false};this.states.set(pid,state);
        }
        state.cc=cc;
        if(start){
            if(state.active){
                if(state.total===0)this._complete(state);
                else {this.stats.malformedPes++;this._drop(state);}
            }
            state.header=new Uint8Array(0);state.active=false;
        }
        if(state.header){
            const joined=new Uint8Array(state.header.length+188-pos);
            joined.set(state.header);joined.set(packet.subarray(pos),state.header.length);
            state.header=joined;
            if(joined.length<3)return;
            if(joined[0]!==0 || joined[1]!==0 || joined[2]!==1){this.states.delete(pid);return;}
            if(joined.length<9)return;
            const id=joined[3],connection=this.connections.get(id);
            if(!connection){this.states.delete(pid);return;}
            if(connection.pid!==null && connection.pid!==pid){this.stats.ignoredPids++;this.states.delete(pid);return;}
            const headerLength=joined[8],headerEnd=9+headerLength,declared=(joined[4]<<8)|joined[5];
            if((joined[6]&192)!==128 || (declared && declared<3+headerLength)){
                this.stats.malformedPes++;this._drop(state);return;
            }
            if(joined.length<headerEnd)return;
            const flags=joined[7]>>6;
            if(flags===1 || (flags===2 && headerLength<5) || (flags===3 && headerLength<10)){
                this.stats.malformedPes++;this._drop(state);return;
            }
            let pts=null;
            if(flags&2){
                const b=joined.subarray(9,14);
                if((b[0]>>4)!==flags || !(b[0]&1) || !(b[2]&1) || !(b[4]&1)){
                    this.stats.malformedPes++;this._drop(state);return;
                }
                pts=((b[0]&14)*536870912+b[1]*4194304+(b[2]&254)*16384+b[3]*128+(b[4]>>1))/90000;
                this.currentTime=pts;if(!this.hasTime){this.startTime=pts;this.hasTime=true;}
            }
            connection.pid=pid;state.destination=connection.destination;state.id=id;
            state.pts=pts;state.total=declared ? declared-3-headerLength:0;
            state.length=0;state.buffers=[];state.active=true;state.header=null;
            this._append(state,joined.subarray(headerEnd));
        } else if(state.active)this._append(state,packet.subarray(pos));
        if(state.active && (state.total && state.length===state.total ||
            !start && !state.total && this.guessVideoFrameEnd && state.id===0xe0 && (control&2)))this._complete(state);
    };
    TS.prototype._append=function(state,bytes){
        const count=state.total ? Math.min(bytes.length,state.total-state.length):bytes.length;
        if(state.length+count>this.maxPesSize){this.stats.pesSizeLimit++;this._drop(state);return;}
        if(count){state.buffers.push(new Uint8Array(bytes.subarray(0,count)));state.length+=count;}
    };
    TS.prototype._complete=function(state){
        const buffers=state.buffers,pts=state.pts;
        state.buffers=[];state.length=0;state.active=false;
        state.destination.write(pts,buffers);
    };
    TS.prototype.end=function(){
        this.stats.truncatedBytes+=this.leftoverBytes?.length || 0;this.leftoverBytes=null;
        for(const state of this.states.values()){
            if(state.active && state.total===0)this._complete(state);
            else if(state.active || state.header){this.stats.malformedPes++;this._drop(state);}
        }
        return {...this.stats};
    };
    TS.STREAM={PACK_HEADER:0xba,SYSTEM_HEADER:0xbb,PROGRAM_MAP:0xbc,PRIVATE_1:0xbd,
        PADDING:0xbe,PRIVATE_2:0xbf,AUDIO_1:0xc0,VIDEO_1:0xe0,DIRECTORY:0xff};
    return TS;
})();
