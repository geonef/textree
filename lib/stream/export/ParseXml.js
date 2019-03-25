/**
 * Parse XML to SAX-like events for further processing or serialization
 *
 * Parsing of textree code will yield event nodes such as
 * START, ATTR, TEXT, END which can be piped into a processor
 * or serializer.
 **/

var stream = require('stream');
var util = require("util");
var events = require("events");
var Q = require("kew");
var expat = require('node-expat');

/**
 * Constructor
 *
 */
function ParseXml(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  stream.Transform.call(this, options);

  this.parser = new expat.Parser('UTF-8');

  this.parser.on('startElement', this.onStartElement.bind(this));
  this.parser.on('endElement', this.onEndElement.bind(this));
  this.parser.on('text', this.onText.bind(this));
  this.parser.on('processingInstruction', this.onProcessingInstruction.bind(this));
  this.parser.on('comment', this.onComment.bind(this));
  this.parser.on('xmlDecl', this.onXmlDecl.bind(this));
  this.parser.on('startCdata', this.onStartCdata.bind(this));
  this.parser.on('endCdata', this.onEndCdata.bind(this));
  this.parser.on('entityDecl', this.onEntityDecl.bind(this));
  this.parser.on('error', this.onError.bind(this));
}

util.inherits(ParseXml, stream.Transform);

/**
 * Defined by class stream.Transform, our parent
 *
 * @override
 */
ParseXml.prototype._transform = function (chunk, encoding, done, arg) {
  if (chunk && chunk.type == "text") {
    chunk = chunk.text;
    encoding = "utf8";
  }
  if (chunk && chunk.type) {
    this.push(chunk);
    done();
    return;
  }
  this.parser.write(chunk);
};

ParseXml.prototype._flush = function (done) {
  console.log("flush");
  this.finished = true;
  done();
};

ParseXml.prototype.onStartElement = function(name, attrs) {
  // console.log("onStartElement", arguments);
  this.push({ type: "start", name: name, attributes: attrs });
};

ParseXml.prototype.onEndElement = function(name) {
  // console.log("onEndElement", arguments);
  this.push({ type: "end" });
};

ParseXml.prototype.onText = function(text) {
  // console.log("onText", arguments);
  if (text.trim()) {
    this.push({ type: "text", text: text });
  }
};

ParseXml.prototype.onProcessingInstruction = function(target, data) {
  console.log("onProcessingInstruction [IGNORED]", arguments);
};

ParseXml.prototype.onComment = function(comment) {
  // console.log("onComment", arguments);
  this.push({ type: "comment", value:comment });
};

ParseXml.prototype.onXmlDecl = function(version, encoding, standalone) {
  // console.log("onXmlDecl [IGNORED]", arguments);
};

ParseXml.prototype.onStartCdata = function() {
  console.log("onStartCdata [IGNORED]", arguments);
};

ParseXml.prototype.onEndCdata = function() {
  console.log("onEndCdata [IGNORED]", arguments);
};

ParseXml.prototype.onEntityDecl = function(entityName, isParameterEntity, value, base,
                                               systemId, publicId, notationName) {
  console.log("onEntityDecl  [IGNORED]", arguments);
};

ParseXml.prototype.onError = function(error) {
  console.log("onError", arguments);
};


//////////////////////////////////////////////////////////////////////


module.exports = ParseXml;
