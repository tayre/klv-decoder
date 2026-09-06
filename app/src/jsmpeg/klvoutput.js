/* Metadata events are lossless; DOM formatting is limited to one update per frame. */
JSMpeg.DataOutput.KLV = (function() {
    'use strict';
    var KLV = function(options={}) {
        this.element=options.klvelement;this.callback=options.onMetadata;
        this.frame=null;this.pending=null;
    };
    KLV.prototype.render = function(data) {
        if(this.callback)this.callback(data);
        if(!this.element)return;
        this.element.dispatchEvent(new CustomEvent('klv',{detail:data}));
        if(this.element.hidden)return;
        this.pending=data;
        const flush=()=>{
            this.frame=null;
            const current=this.pending;this.pending=null;
            this.element.textContent=Object.keys(current.payload).map(tag=>{
                const item=current.payload[tag];
                return item.key+': '+tag+' ('+item.length+' bytes) → '+
                    (item.unsupported_length ? 'unsupported width; raw: '+item.raw:item.value);
            }).join('\n');
        };
        if(typeof requestAnimationFrame==='undefined')flush();
        else if(this.frame===null)this.frame=requestAnimationFrame(flush);
    };
    KLV.prototype.destroy=function(){if(this.frame!==null)cancelAnimationFrame(this.frame);this.pending=null;};
    return KLV;
})();
