/*
 * @author Tom Ayre <ayre.tom+github@gmail.com>
 */
JSMpeg.DataOutput.KLV = (function(){ "use strict";

var KLV = function(options) {
	this.element = options.klvelement
	this.enabled = true;
};

KLV.prototype.render = function(data) {
	var output = [];
	var payload = data.payload;
	
	for(var tag in payload) {
		var item = payload[tag];
		output.push("<strong>"+item.key+"</strong>: " + tag + " (" +  item.length +") bytes ---> <strong>" +  item.value + "</strong>");
		output.push("<br/>")
	}

	if(this.element) {
		this.element.innerHTML = output.join('');
		// client can now listen fo klv events  // element.addEventListener('klv', function (e) { console.log(e.detail) }, false);
		this.element.dispatchEvent(new CustomEvent('klv', { "detail": data}));
	}
};

return KLV;

})();

