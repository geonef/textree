/**
 ** Transform Textree SAX-like events to XML/HTML syntax
 **
 ** Input usually comes from Trees2proc's output.
 **/

var stream = require('stream');
var util = require("util");


function PrintXml(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  stream.Transform.call(this, options);

  this.buffer = "";
  this.elementNames = [];

  /**
   * Nested level are unshifted. For each item:
   * - false if any text
   * - true if any element not following text
   * - null if no text or element has been met
   */
  this.hadChildren = [null];

  // this.on("finish", function() {
  //   console.log("serialize finish **********");
  // });
  // this.on("end", function() {
  //   console.log("serialize end **********");
  // });
}
util.inherits(PrintXml, stream.Transform);

// PrintXml.prototype.inputPipeEnd = true;
PrintXml.prototype.flushLength = 128;

PrintXml.prototype.indentSpaces = 4;

/**
 * HTMLtags which can be self-closed when it has no child
 * (like: <br/> instead of <br></br>)
 */
PrintXml.prototype.autoCloseTags = [
  "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen",
  "link", "menuitem", "meta", "param", "source", "track", "wbr"
];

PrintXml.prototype.printText = function (text) {
  this.ensureCloseTag(true);

  this.hadChildren[0] = false;

  if (text.indexOf("\n") >= 0) {
    // this.printLN("");
    text.split("\n").forEach(function(line) {
      // this.printIndent(this.elementNames.length);
      this.printLN(line);
    }, this);
    // this.print(
    //   text.split("\n")
    //     .map(function(line) { return this.printIndent(this.elementNames.length) + line; }, this)
    //     .join("\n"));
  // if (this.lastEvent && this.lastEvent.type == "text") {
  //   this.print("\n");
  // }
  } else {
    this.print(text);
  }
};

PrintXml.prototype._transform = function (event, encoding, done) {

  // console.log("PrintXml: _transform", event);

  if (Buffer.isBuffer(event)) {
    this.printText(event.toString());
  } else if (typeof event == "string") {
    this.printText(event);
  } else {
    var level;
    var name;

    switch (event.type) {
    case "start":

      this.ensureCloseTag();
      level = this.elementNames.length;
      name = event.name || "div";
      this.elementNames.push(name);
      if (this.hadChildren[0] === null) {
        this.hadChildren[0] = true;
      }
      if (this.hadChildren[0]) {
        this.printIndent(level);
      }
      this.hadChildren.unshift(null);
      this.print("<"+name);
      if (event.attributes) {
        for (var attr in event.attributes) {
          var text = event.attributes[attr];
          if (text instanceof Array) {
            text = text.join(" ");
          }
          this.print(" "+attr+"=\"" + text.replace(/"/g, "&quot;")+"\"");
        }
      }
      this.stillOpen = true;

      break;

    case "domain":
      // ignored
      break;

    case "text":
      this.printText(event.text);
      break;

    case "end":
      name = this.elementNames.pop();
      var autoClose = this.autoCloseTags.indexOf(name) != -1;
      // this.ensureCloseTag(!this.hadChildren);

      // this.print(inline ? ">" : ">\n");
      // this.stillOpen = false;

      if (this.hadChildren.shift()) {
        if (this.stillOpen)  {
          this.printLN(">");
        }

        level = this.elementNames.length;
        this.printIndent(level);
      } else {
        // this.print(">");
        if (this.stillOpen)  {
          if (autoClose) {
            this.printLN("/>");
          } else {
            this.print(">");
          }
        }
      }
      if (!autoClose || !this.stillOpen) {
        this.printLN("</"+name+">");
      }
      this.stillOpen = false;
      // this.hadChildren[0] = true;

      // this.ensureCloseTag(!this.hadChildren);
      // name = this.elementNames.pop();
      // if (this.hadChildren) {
      //   level = this.elementNames.length;
      //   this.printIndent(level);
      // }
      // this.hadChildren = true;
      // this.print("</"+name+">\n");
      break;

    case "comment":
      this.printComment(event.value);
      // console.log("comment!!", event);
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
PrintXml.prototype.printComment = function(comment) {
  this.ensureCloseTag();
  this.printLN("<!-- "+comment.replace(/->/g, "- >")+" -->");
};

PrintXml.prototype._flush = function (done) {
  this.ensureCloseTag();
  this.flushBuffer();
  done();
};

PrintXml.prototype.flushBuffer = function (force) {
  // console.log("flush");
  if (this.buffer.length > 0) {
    this.push(this.buffer);
    this.buffer = "";
  }
};

PrintXml.prototype.ensureCloseTag = function(inline) {
  if (this.stillOpen) {
    if (inline) {
      this.print(">");
    } else {
      this.printLN(">");
    }
    this.stillOpen = false;
  }
};

PrintXml.prototype.print = function (text) {
  this.buffer += text;

  if (this.buffer.length > this.flushLength) {
    this.flushBuffer();
  }
};

PrintXml.prototype.printLN = function(text) {
  // this.print(text);
  this.print(text+"\n");
};
PrintXml.prototype.printIndent = function(level) {
  var s = "";
  for (var i = 0 ; i < level * this.indentSpaces; i++) {
    s += " ";
  }

  this.print(s);
};

module.exports = PrintXml;
