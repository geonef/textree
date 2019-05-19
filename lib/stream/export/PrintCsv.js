
var util = require("util");
var NodeProcessor = require("../NodeProcessor");

function PrintCsv(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  NodeProcessor.call(this, options);

  this.headers = [];
  this.separator = ",";
  this.lineSeparator = "\n";
  this.quote = "\"";
  this.updateEscapeRegExp();
}

util.inherits(PrintCsv, NodeProcessor);
module.exports = PrintCsv;

PrintCsv.prototype.tagCommandPrefix = "csv:";

PrintCsv.prototype.command_options = function(event) {
  // console.log("options", event);
  Object.assign(this, event.attributes);
};
PrintCsv.prototype.command_header = function(event) {
  this.captureFirstText()
    .then(function(text) {
      // console.log("header", text);
      var header = Object.assign({name: text, label: text}, event.attributes);
      this.headers.push(header);
      return this.captureLevelEvents(true);
    }.bind(this))
    // .then(function() {
    // }.bind(this))
    .done();
};
PrintCsv.prototype.command_row = function(event) {
  return this.captureLevelEvents(true)
    .then(function() {
      if (!this.headersWritten) {
        this.writeHeaders();
      }
      var row = this.headers.map(function(header) {
        return this.escapeValue(event.attributes[header.name] || "");
      }, this).join(this.separator)+this.lineSeparator;
      this.sendEvent(row);
    }.bind(this))
    .done();
};


PrintCsv.prototype.writeHeaders = function(event) {
  this.sendEvent({ type: "meta", name: "type", value: "text/csv;charset=UTF-8" });
  var row = this.headers.map(function(header) {
    return this.escapeValue(header.label);
  }, this).join(this.separator)+this.lineSeparator;

  this.sendEvent(row);
  this.headersWritten = true;
};

PrintCsv.prototype.escapeValue = function(value) {
  if (this.escapeRE.test(value)) {
    value = this.quote + value.replace(this.quoteRE, this.quote+this.quote) + this.quote;
  }
  return value;
};

PrintCsv.prototype.updateEscapeRegExp = function(value) {
  var chars = this.separator + "\t\n" + this.quote;
  this.escapeRE = new RegExp("["+chars+"]", "g");
  this.quoteRE = new RegExp("["+this.quote+"]", "g");
};
