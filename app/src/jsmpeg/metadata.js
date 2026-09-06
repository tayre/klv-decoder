/* @author Tom Ayre. Adapter between JSMpeg and the reusable UAS decoder. */
JSMpeg.Decoder.Metadata = (function() {
    'use strict';
    function Metadata(options={}) {
        JSMpeg.Decoder.Base.call(this, options);
        this.parser = new KLVDecoder({maxPacketSize:options.metadataMaxPacketSize,
            strict:options.metadataStrict, onError:options.onMetadataError,
            onPacket:data=>{if(this.destination)this.destination.render(data);}});
    }
    Metadata.prototype=Object.create(JSMpeg.Decoder.Base.prototype);
    Metadata.prototype.constructor=Metadata;
    Metadata.prototype.write=function(pts,buffers){
        for(const buffer of buffers)this.parser.push(buffer,pts);
        this.canPlay=true;
    };
    Metadata.prototype.decode=function(){return false;}; // decoded as bytes arrive
    Metadata.prototype.reset=function(){this.parser.reset();};
    return Metadata;
})();
