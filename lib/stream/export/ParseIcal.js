
var stream = require('stream');
var util = require("util");
var NodeProcessor = require("../NodeProcessor");
var ical = require('ical');

function ParseIcal(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  stream.Transform.call(this, options);

  this.buffer = "";
}

util.inherits(ParseIcal, stream.Transform);

/**
 * Defined by class stream.Transform, our parent
 *
 * @override
 */
ParseIcal.prototype._transform = function (chunk, encoding, done) {
  if (chunk && chunk.type == "text") {
    chunk = chunk.text + (chunk.multiline ? "\n" : "");
    encoding = "utf8";
  }

  this.buffer += chunk;
  done();
};

/**
 * Defined by class stream.Writable (parent of stream.Transform, our parent)
 *
 * @override
 */
ParseIcal.prototype._flush = function (done) {
  // console.log("ParseIcal#flush");

  var data = ical.parseICS(this.buffer);
  // console.log("** Ical DATA: "+JSON.stringify(data).substr(0,200));
  for (var key in data) {
    if (data.hasOwnProperty(key)) {
      this.push({type:"start", name: "ical:event", attributes: data[key]});
      this.push({type:"end"});
    }
  }
  this.buffer = null;
  done();
};


ParseIcal.prototype.warn = function () {
  var message = Array.prototype.join.call(arguments, " ");
  this.sendEvent({ type: "message", level: "warn", message: message,
                   "class": this.constructor.name });
};

module.exports = ParseIcal;
