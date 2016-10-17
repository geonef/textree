/**
 ** Parse Textree formatted content to SAX-like events
 ** for further processing or serialization
 **/

// http://codewinds.com/blog/2013-08-20-nodejs-transform-streams.html#creating_custom_transform_streams

var stream = require('stream');
var util = require("util");
var events = require("events");
var Q = require("kew");
Q.longStackSupport = true;


/**
 * ParseTextree: textree source parser to event objects
 *
 * Parsing of textree code will yield event nodes such as
 * START, ATTR, TEXT, END which can be piped into a processor
 * or serializer.
 */
function ParseTextree(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  stream.Transform.call(this, options);

  this.finished = false; // update by _flush()
  this.leadingSpaces = 0;
  this.buffer = "";
  // this.process = this.processData_leading;

  this.buffer = "";
  this.pos = 0;
  this.absPos = 0;

  this.currentLine = -1;
  this.goForNewLine();
  this.indentStack = [];
}

util.inherits(ParseTextree, stream.Transform);

/**
 * Defined by class stream.Transform, our parent
 *
 * @override
 */
ParseTextree.prototype._transform = function (chunk, encoding, done, arg) {

  // console.log("ParseTextree: _transform", chunk, encoding, done);

  if (chunk && chunk.type == "text") {
    chunk = chunk.text;
    encoding = "utf8";
  }
  if (chunk && chunk.type) {
    this.push(chunk);
    done();
    // this.sendEvent(chunk);
    return;
  }
  var _this = this;

  // console.log("ParseText::_transform", arg, "size=", chunk.length, _s(chunk.toString()), chunk);
  // var inc = 0;

  // if (inc > 0 && chunk.length > inc) {
  //   var i = 0;
  //   function rec() {
  //     var b = chunk.slice(i, i + inc);
  //     i += inc;
  //     _this._transform(b, encoding, i < chunk.length ? rec : done, "FROM");
  //   }
  //   rec();
  // } else {

  // this.gc();
  this.buffer += chunk.toString();
  if (!this.processor) {
    throw new Error("_transform(): no processor set");
  }

  // this.transformDone = done;
  var wasDone = false;
  this.transformDone = function() {
    wasDone = true;
    done();
  };

  _this._processorReset = true;
  while (!wasDone && _this._processorReset) {
    _this._processorReset = false;
    _this.processor();
  }
  // }
};

/**
 * Commodity for debug logging
 */
function _s(str) {
  var limit = 30;
  var s = str;
  s = s.substr(0, limit);
  s = s.replace(/\n/g, "\\n");
  s = "\"" + s + "\"";
  if (str.length > limit) {
    s += " + "+(str.length - limit)+" chars";
  }
  return s;
}

/**
 * Defined by class stream.Writable (parent of stream.Transform, our parent)
 *
 * @override
 */
ParseTextree.prototype._flush = function (done) {
  // log("**********flush", this.indentStack);
  this.finished = true;
  if (this.processor) {
    this.processor();
  }
  if (this.indentStack.length > 0) {
    this.returnToIndent(this.indentStack[0]);
  }
  done();
};

/**
 * Wrapper to this.push() for sending an event to output
 *
 * {type:"start"} events are not sent immediately but kept for possible calls
 * to this.getLastStartEvent().
 */
ParseTextree.prototype.sendEvent = function (event) {
  // console.log("???");
  if (this.lastStartEvent) {
    this.push(this.lastStartEvent);
    this.lastStartEvent = null;
  } else if (this.lastTextEvent) {
    if (event && event.type == "text") {
      this.lastTextEvent.text += "\n" + event.text;
      return;
    } else {
      this.push(this.lastTextEvent);
      this.lastTextEvent = null;
    }
  }
  if (event) {
    if (event.type == "start") {
      this.lastStartEvent = event;
    } else if (event.type == "text") {
      this.lastTextEvent = event;
    } else {
      this.push(event);
    }
  }
};

ParseTextree.prototype.getLastStartEvent = function (showError) {
  if (!this.lastStartEvent && showError !== false) {
    this.warn("ParseTextree#getLastStartEvent: no last start event!");
  }
  return this.lastStartEvent;
};

ParseTextree.prototype.gc = function() {
  if (this.pos > 0) {
    this.buffer = this.buffer.slice(this.pos);
    this.pos = 0;
  }
};

ParseTextree.prototype.goFor = function(processor) {
  this.processor = processor;
  // will be called in _transform
  this._processorReset = true;
};

ParseTextree.prototype.askMore = function() {
  // log("askMore");
  this.goFor(this.processor);

  if (this.transformDone) {
    this.transformDone();
    // this.transformDone = null;
  }
};

ParseTextree.prototype.readChars = function(count) {
  var deferred = Q.defer();
  this.goFor(function() {
    if (this.finished || this.pos >= (count || 1)) {
      deferred.resolve();
    } else {
      this.askMore();
    }
  });

  return deferred.promise;
};

ParseTextree.prototype.readCharCount = function(chars, until) {
  var re = new RegExp("["+(until?"":"^")+chars+"]", "g");
  var count = 0;
  var deferred = Q.defer();

  this.goFor(function() {
    if (this.finished) {
      count += this.buffer.length - this.pos;
      this.pos = this.buffer.length;
      deferred.resolve(count);

    } else {
      re.lastIndex = this.pos;

      var result = re.exec(this.buffer);
      if (result) {
        count += result.index - this.pos;
        this.pos = result.index;
        deferred.resolve(count);
      } else {
        count += this.buffer.length - this.pos;
        this.pos = this.buffer.length;
        this.askMore();
      }
    }
  });

  return deferred.promise;
};

ParseTextree.prototype.readTokenUntil = function(chars) {
  // log("readTokenUntil", chars);
  var re = new RegExp("["+chars+"]", "g");
  var token = "";
  var deferred = Q.defer();

  this.goFor(function() {
    if (this.finished) {
      token += this.buffer.slice(this.pos);
      this.pos = this.buffer.length;
      deferred.resolve(token);
    } else {
      re.lastIndex = this.pos;
      // log("readTokenUntil from", this.pos, _s(this.buffer));

      var result = re.exec(this.buffer);
      // if (result && result.index > 0 && this.buffer[result.index - 1] == "\\") {
      //   console.log("***********", result.index, this.buffer[result.index - 1],
      //               "\""+this.buffer.substr(result.index-1, 3)+"\"");
      // }
      // if (result && result.index > 0 && this.buffer[result.index - 1] == "\\") {
      if (result) {
        if (result.index > 0 && this.buffer[result.index - 1] == "\\") {
          // handle antislash escaping
          // console.log("antislash", this.pos, result.index + 1,
          //             "\""+this.buffer.substr(result.index - 3, 6)+"\"");
          token += this.buffer.substring(this.pos, result.index - 1) + this.buffer[result.index];
          this.pos = result.index + 1;
          // console.log("token", token, "| next =", this.buffer.substr(this.pos, 3));
          if (this.pos === this.buffer.length) {
            this.askMore();
          } else {
            this.goFor(this.processor);
          }
        } else {
          // console.log("until re idx", result);
          token += this.buffer.substring(this.pos, result.index);
          this.pos = result.index;
          deferred.resolve(token);
        }
      } else {
        // log("until else", result);
        token += this.buffer.slice(this.pos);
        this.pos = this.buffer.length;
        this.askMore();
      }
    }
  });

  return deferred.promise;
};


//////////////////////////////////////////////////////////////////////

ParseTextree.prototype.elementBreakCharsNormal = "|.#@( \n";
ParseTextree.prototype.elementBreakCharsInline = "|.#@( \n{}";
ParseTextree.prototype.elementBreakChars = ParseTextree.prototype.elementBreakCharsNormal;

ParseTextree.prototype.goForNewLine = function() {
  var _this = this;
  while (this.inlineMode > 0) {
    this.warn("unclosed inline tag");
    this.sendEvent({ type: "end" });
    this.inlineMode--;
  }
  this.nextTextEscapeBrackets = false;
  this.currentLine++;

  this.readCharCount(" ")
    .then(function(count) {
      var c = _this.buffer[_this.pos];
      if (c == ">") {
        count--;
        _this.pos++;
      }
      _this.lineIndent = count;
      return _this.readTokenUntil(_this.elementBreakChars);
    })
    .then(this.goAfterToken.bind(this))
    .done();
};

/**
 * Take action upon 'token' then read what follows
 */
ParseTextree.prototype.goAfterToken = function (token) {
  // log("indent="+this.lineIndent, "token", _s(token), "from", _s(this.buffer));
  var _this = this;
  var c = _this.buffer[_this.pos];
  if (!token && !this.inlineMode) {
    switch (c) {

      // case ">":
      //  _this.readTokenUntil(_this.elementBreakChars)
      //    .then(this.goAfterToken.bind(this)).done();
      //  return;

    case " ":
      _this.pos++;
      _this.readTokenUntil(_this.elementBreakChars)
        .then(this.goAfterToken.bind(this)).done();
      return;

    case "\n":
      _this.pos++;
      _this.goForNewLine();
      return;

    case "|":
      _this.returnToIndent(_this.lineIndent);
      _this.pos++;
      _this.goForText();
      return;

    case ".":
      _this.pos++;
      _this.goForAttributeLine();
      return;
      // case "{":
      // case "}":
      //  if (_this.inlineMode) {
      //    _this.goWithInlineChar();
      //    return;
      //  }
      //  break;
    }
  }
  // if (_this.inlineMode && !token &&
  if (token === "{" && c == "\n") {
    _this.returnToIndent(_this.lineIndent);
    _this.indentStack.push(-1);

    _this.goForNewLine();

  } else if (token === "}" && c == "\n") {

    if (_this.indentStack.length === 0) {
      this.warn("unmatched '}'");
    } else {
      _this.returnToIndent(0); // return to last "{" (
      _this.indentStack.pop();
      _this.goForNewLine();
    }

  } else if (/^-#|^\/\/-/.test(token + _this.buffer[_this.pos])) {
    _this.goForCommentLine(token);

  } else if (/^\/\//.test(token + _this.buffer[_this.pos])) {
    _this.goForCommentLine(token, true);

  } else {
    if (!this.inlineMode) {
      _this.returnToIndent(_this.lineIndent);
      _this.indentStack.push(_this.lineIndent);
    }
    _this.sendEvent({ type: "start", name: token, attributes: {} });

    if (this.inlineMode && (c == "{" || c == "}")) {
      _this.goWithInlineChar();
    } else {
      _this.goForAnyAttr();
    }
  }
};

/**
 * Called by goAfterToken() and _flush() to manage changes in line indentation
 *
 * "end" nodes are emitted to match the value of 'position'
 */
ParseTextree.prototype.returnToIndent = function (position) {

  var _indentStack = this.indentStack;
  for (var i = _indentStack.length - 1; i >= 0; --i) {
    if (position > _indentStack[i]) {
      break;
    }

    this.sendEvent({type: "end"});
    _indentStack.pop();
    this.inMultiLineTextMode = false;
  }
};

/**
 * Called by goAfterToken() when it encounters a comment
 *
 * Currently there are 2 forms: line begining with a hash ("#")
 * and lines beginning with two slashes ("//")
 *
 * The comment chars are read already. Next char is comment's 1st char.
 */
ParseTextree.prototype.goForCommentLine = function(commentToken, keep) {
  var _this = this;

  this.readTokenUntil("\n")
    .then(function(comment) {
      // console.log("lalala", arguments);
      if (keep) {
        _this.sendEvent({type: "comment", value: comment });
      }
      _this.idx++;
      _this.goForNewLine();
    }).done();
};

/**
 * Called by goAfterToken() or goForAttribute() to process a next attr or not
 *
 * Manages the multiple forms of attributes:
 *   - between parenthesis :            some-element(attr1=value1,attr2=value2)
 *   - ID as a hashbang :               some-element#some-id
 *   - dot-separated CSS classes:       some-element.class1.class2
 *   - domain with "@":                 some-element@tag1
 */
ParseTextree.prototype.goForAnyAttr = function() {
  var _this = this;

  // log("any attr", this.pos, _s(this.buffer));
  // this.goFor(function() {
  var c = this.buffer[this.pos];
  this.pos++;

  if (c == "." || c == "#") {

    this.readTokenUntil(".#@( }\n"/*=*/).then(function(token) {
      if (c == "." && !token && _this.buffer[_this.pos] == "\n") {
        // like "div." with the dot at end of line
        return _this.goForMultiLineText();
      }
      if (c == "#") {
        _this.getLastStartEvent().attributes.id = token;
      } else if (c == "}") {
        this.goWithInlineChar(c);
      } else { // c == "."
        if ("" == token) {
          this.nextTextEscapeBrackets = true;
        } else {
          this.processAttribute(token);
        }
      }
      return _this.goForAnyAttr();
    }.bind(this)).done();
    return;
  }
  if (c == "@") {
    this.readTokenUntil("( \n").then(function(token) {
      _this.getLastStartEvent().domain = token;

      return _this.goForAnyAttr();
    }).done();
    return;
  }
  if (c == "(") {
    this.goForAttribute();
    return;
  }
  // if (c == "=") {
  //   this.goForText();
  //   return;
  // }
  if (c == " ") {
    this.goForText();
    return;
  }
  if (this.inlineMode) {
    if (c == "{" || c == "}") {
      this.goWithInlineChar(c);
    }
  } else {
    if (c == "\n") {
      // log("any attr!!", this.pos, _s(this.buffer));
      this.goForNewLine();
    }
  }
};

/**
 * Called by goForAnyAttr after it encounters a start of attribute list
 *
 * Attributes start with a parenthesis ("("), like:
 *   some-element(attr1=value1,attr2=value2)
 */
ParseTextree.prototype.goForAttribute = function() {
  var attr;
  var _this = this;
  this.readTokenUntil("=")
    .then(function(token) {
      attr = token.trim();
      _this.pos++;
      return _this.readTokenUntil(",)\n");
    })
    .then(function(token) {
      _this.getLastStartEvent().attributes[attr] = token.trim();

      var c = _this.buffer[_this.pos];
      _this.pos++;
      if (c == ")") {
        // return _this.goForNewLine();
        // return _this.readChars(1).then(_this.goForAnyAttr.bind(_this));
        return _this.goForAnyAttr();
      } else {
        return _this.goForAttribute();
      }
    }).done();
};

ParseTextree.prototype.goForAttributeLine = function() {
  this.readTokenUntil("\n")
    .then(function(line) {
      this.pos++;
      line = line.trim();
      if (line) {
        this.processAttribute(line);
      } else {
        return this.goForMultiLineText();
      }

      return this.goForNewLine();
    }.bind(this))
    .done();
};

ParseTextree.prototype.processAttribute = function(token) {
  var lastStart = this.getLastStartEvent(false);
  if (lastStart) {
    var attrs = lastStart.attributes;

    if (/=/.test(token)) {

      var idx = token.indexOf("=");
      var attr = token.substring(0, idx).trim();
      var value = token.substring(idx+1).trim();

      var match = /^(.*)\[\]$/.exec(attr);
      if (match) {
        attr = match[1];
        if (!attrs[attr]) {
          attrs[attr] = [];
        }
        attrs[attr].push(value);
        // console.log("match", match[1]);
      } else {
        attrs[attr] = value;
      }
    } else {
      attrs["class"] = ("class" in attrs ? (attrs["class"]+" ") : "") + token.trim();
    }
  } else {
    this.warn("attribute must be right after a START element: "+token);
  }
};

/**
 * Called goAfterToken(), goForAnyAttr() or goForText() to manage inline elements "{...}"
 *
 * Inline elements are elements defined _in_ in a text token instead of separate,
 * properly-indented line. For example:
 *
 * root-element
 *   some-child This is a text with {b bold} content!
 *   some-child This is a text with {span.bright {b bold} content}!
 *   some-child
 *     | This is a text with {b bold} content!
 *     | In multi-line {i dot-style text}.
 *
 * Please note that inline element won't be interpreted in dot-style text. Example:
 * root-element
 *   some-child.
 *     This is text. No interpretation is done here, so you can paste code as content:
 *     function my_demo_function() {  // this "{" won't break the parsing
 *       if (true) { ... }
 *     }
 */
ParseTextree.prototype.goWithInlineChar = function() {
  var c = this.buffer[this.pos];
  this.pos++;
  // console.log("goWithInlineChar", c);
  switch (c) {
  case "{":

    if (!this.inlineMode) {
      this.inlineMode = 0;
      this.elementBreakChars = this.elementBreakCharsInline;
    }
    this.inlineMode++;

    this.readTokenUntil(this.elementBreakChars)
      .then(this.goAfterToken.bind(this)).done();
    return;

  case "}":
    this.inlineMode--;

    if (this.inlineMode < 0) {
      this.warn("unmatched '}'");
      this.inlineMode = 0;
    } else {
      this.sendEvent({type: "end"});
    }
    if (this.inlineMode === 0) {
      this.elementBreakChars = this.elementBreakCharsNormal;
    }
    this.goForText();
    return;
  }
};

/**
 * Called by goAfterToken(), goForAnyAttr() or goWithInlineChar()
 * to read text node content, until next/stop inline element ("{...}")
 * or end-of-line.
 *
 * This function is called regardless of the syntaxic style: after
 * an element name+attributes, or single on the line starting with a pipe, like:
 *
 * root-element
 *   child-element
 *     | Here is the text.
 *     | The pipe char indicates a text node
 */
ParseTextree.prototype.goForText = function() {
  var attr;
  var _this = this;

  this.readTokenUntil(this.nextTextEscapeBrackets ? "\n" : "{}\n")
    .then(function(text) {
      // text = text.trim();
      // if (text) {
        if (text[0] == " ") {
          text = text.slice(1);
        }
        _this.sendEvent({type: "text", text: text });
      // }
      var c = _this.buffer[_this.pos];
      if (c == "\n") {
        _this.pos++;
        return _this.goForNewLine();
      }

      return this.goWithInlineChar(c);

    }.bind(this)).done();
};

/**
 * Called by goForAnyAttr() when it encounters a dot (".") after element name
 *
 * Like this:
 * root-element
 *   child-element.
 *     Here is the text.
 *     The pipe char is not needed because of the dot.
 *     Inline elements cannot happen here:
 *     { text is raw, which is practical for code :) }
 */
ParseTextree.prototype.goForMultiLineText = function() {
  // console.log("goForMultiLineText");
  var _this = this;
  var textIndent = null;
  var readNextLine = function() {

    return this.readCharCount(" ")
      .then(function(count) {
        // var isBlank = false;
        var isBlank = this.buffer[this.pos] == "\n";
        if (isBlank) {
          count = textIndent;
        } else if (textIndent === null) {
          textIndent = count;
          // console.log("text indent = ", textIndent);
        }
        if (count < textIndent && !isBlank) {
          // text back to last current indent: pass the hand to goAfterToken()
          // console.log("back to!", count);

          this.lineIndent = count;
          return _this.readTokenUntil(_this.elementBreakChars)
            .then(this.goAfterToken.bind(this));

        } else {

          // text to interpret
          return this.readTokenUntil("\n")
            .then(function(text) {
              // console.log("inetrpreting", count, textIndent, text);
              if (textIndent !== null) {
                text = Array(count - textIndent).join(" ") + text;
              }
              this.sendEvent({type: "text", text: text, multiline: true });
              this.pos++;
              readNextLine();
            }.bind(this));
        }
      }.bind(this))
      .done();
  }.bind(this);

  this.pos++;
  readNextLine();
};

ParseTextree.prototype.warn = function () {
  var message = Array.prototype.join.call(arguments, " ");
  this.sendEvent({ type: "message", level: "warn", message: message,
                   "class": this.constructor.name });
};

//////////////////////////////////////////////////////////////////////


module.exports = ParseTextree;
