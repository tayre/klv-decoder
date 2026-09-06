/* KLV output stays separate from the decoder so other viewers can subscribe. */
JSMpeg.DataOutput.KLV = (function() {
    'use strict';
    var KLV = function(options) { this.element = (options || {}).klvelement; };
    KLV.prototype.render = function(data) {
        if (!this.element) { return; }
        this.element.textContent = Object.keys(data.payload).map(function(tag) {
            var item = data.payload[tag];
            return item.key + ': ' + tag + ' (' + item.length + ' bytes) → ' +
                (item.unsupported_length ? 'unsupported width; raw: ' + item.raw : item.value);
        }).join('\n');
        this.element.dispatchEvent(new CustomEvent('klv', {detail: data}));
    };
    return KLV;
})();
