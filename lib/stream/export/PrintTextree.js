/**
 ** Transform Textree SAX-like events to Textree (Jade-like) syntax
 **
 ** Input usually comes from ProcessNodes output.
 **/

var stream = require('stream');
var util = require("util");


function PrintTextree(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  stream.Transform.call(this, options);

  this.buffer = "";
  this.elementNames = [];

}
util.inherits(PrintTextree, stream.Transform);

PrintTextree.prototype.indentSpaces = 2;

PrintTextree.prototype.flushLength = 128;

PrintTextree.prototype.printText = function (text) {

  if (text.indexOf("\n") >= 0) {
    this.printLN(".");
    text.split("\n").forEach(function(line) {
      this.printIndent(this.elementNames.length+1);
      this.printLN(line);
    }, this);

  } else {

    if (this.stillOpen) {
      this.printLN(" "+text);
      this.stillOpen = false;
    } else {
      this.printIndent(this.elementNames.length+1);
      this.printLN("| "+text);
    }
  }
};

PrintTextree.prototype._transform = function (event, encoding, done) {

  // console.log("PrintTextree: _transform stillOpen="+this.stillOpen, event);

  if (Buffer.isBuffer(event)) {
    this.printText(event.toString());
  } else if (typeof event == "string") {
    this.printText(event);
  } else {
    var level;
    var name;

    switch (event.type) {
    case "start":

      this.ensureNotStillOpen();
      level = this.elementNames.length;
      name = event.name || "div";
      this.elementNames.push(name);
      this.printIndent(level);
      this.print(name);
      this.stillOpen = true;

      if (event.attributes) {
        var id, _class, inlineAttrs = {}, wholeAttrs = {};
        for (var attr in event.attributes) {
          var text = event.attributes[attr];
          if (text instanceof Array) {
            text = text.join(" ");
          }
          if (attr == 'id') {
            id = text;
          } else if (attr == 'class') {
            _class = text;
          } else if (/\./.test(text) || /:/.test(attr)) {
            wholeAttrs[attr] = text;
          } else {
            inlineAttrs[attr] = text;
          }
        }
        if (id) {
          this.print('#'+id);
        }
        if (_class) {
          this.print('.'+_class);
        }
        for (attr in inlineAttrs) {
          this.print("."+attr+"="+inlineAttrs[attr]);
        }
        if (Object.keys(wholeAttrs).length > 0) {
          this.ensureNotStillOpen();
          for (attr in wholeAttrs) {
            this.printIndent(level+1);
            this.printLN("."+attr+" = " + wholeAttrs[attr]);
          }
          this.printLN();
        }
      }

      break;

    case "domain":
      // ignored
      break;

    case "text":
      this.printText(event.text);
      break;

    case "end":
      name = this.elementNames.pop();

      this.ensureNotStillOpen();
      break;

    case "comment":
      this.printComment(event.value);
      break;

    case "message":
      this.printComment("Textree "+(event.level || "")+" message: "+(event.message || ""));
      break;
    default:
      this.printComment("Textree unknown event: "+JSON.stringify(event));
    }
  }
  this.lastEvent = event;
  done();
};
PrintTextree.prototype.printComment = function(comment) {
  this.ensureNotStillOpen();
  this.printIndent(this.elementNames.length);
  this.printLN("// "+comment.replace(/->/g, "- >"));
};

PrintTextree.prototype._flush = function (done) {
  this.ensureNotStillOpen();
  this.flushBuffer();
  done();
};

PrintTextree.prototype.flushBuffer = function (force) {
  // console.log("flush");
  if (this.buffer.length > 0) {
    this.push(this.buffer);
    this.buffer = "";
  }
};

PrintTextree.prototype.ensureNotStillOpen = function(inline) {
  if (this.stillOpen) {
    this.printLN();
    this.stillOpen = false;
  }
};

PrintTextree.prototype.print = function (text) {
  this.buffer += text;

  if (this.buffer.length > this.flushLength) {
    this.flushBuffer();
  }
};

PrintTextree.prototype.printLN = function(text) {
  this.print((text||"")+"\n");
};
PrintTextree.prototype.printIndent = function(level) {
  var s = "";
  for (var i = 0 ; i < level * this.indentSpaces; i++) {
    s += " ";
  }

  this.print(s);
};

module.exports = PrintTextree;
