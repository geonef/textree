
var stream = require('stream');
var util = require("util");
var NodeProcessor = require("../NodeProcessor");
var csvParse = require("csv-parse");

function ParseCsv(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  stream.Transform.call(this, options);

}

util.inherits(ParseCsv, stream.Transform);

/**
 * Defined by class stream.Transform, our parent
 *
 * @override
 */
ParseCsv.prototype._transform = function (chunk, encoding, done) {
  if (chunk && chunk.type == "text") {
    chunk = chunk.text + (chunk.multiline ? "\n" : "");
    encoding = "utf8";
  }

  if (!this.parser) {
    this.parser = csvParse({columns: true});

    this.parser.on('data', (row) => {
      // console.log("row", row);
      this.push({type:"start", name: "csv:row", attributes: row});
      this.push({type:"end"});
    });

    this.parser.on('error', (err) => {
      console.log("error", err.message);
    });

    this.parser.on('end', function(){
      // console.log("csv-parse finished");
    });
  }
  return this.parser.write(chunk, encoding, done);
};

/**
 * Defined by class stream.Writable (parent of stream.Transform, our parent)
 *
 * @override
 */
ParseCsv.prototype._flush = function (done) {
  // console.log("flush");
  if (this.parser) {
    this.parser.end(done);
  }
};


ParseCsv.prototype.warn = function () {
  var message = Array.prototype.join.call(arguments, " ");
  this.sendEvent({ type: "message", level: "warn", message: message,
                   "class": this.constructor.name });
};

module.exports = ParseCsv;
