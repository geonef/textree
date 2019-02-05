
var stream = require('stream');
var util = require("util");
var events = require("events");
var Q = require("kew");
var vm = require("vm");
var pathUtils = require("path");

var env = require("../../env");
var GlobalEnvironment = require("../../GlobalEnvironment");
var NodeProcessor = require("../NodeProcessor");
var ReadArray = require("./ReadArray");


function ProcessNodes(options) {
  if (!options) { options = {}; }
  NodeProcessor.call(this, options);

  // NodeJS VM context of JS expr evaluations
  this.vmContext = vm.createContext(new GlobalEnvironment(options.globalContext || {}), {});
  this.vmContext.warn = this.warn.bind(this);
}

util.inherits(ProcessNodes, NodeProcessor);
module.exports = ProcessNodes;

ProcessNodes.prototype.tagCommandPrefix = ":";

ProcessNodes.prototype.cloneStream = function () {
  var clone = new (this.constructor)({
    levelState: this.levelState, // will be sliced by constructor
    globalContext: this.vmContext,  // will be used as source for new context in constructor
  });

  return clone;
};

////////////////////////////////////////////////////////////////////////////////
// COMMAND FUNCTIONS

/**
 * @override
 */
ProcessNodes.prototype.sanatizeCommandName = function(name) {

  switch (name) {
  case "": name = "attr"; break;
  case ":": name = "on"; break;
  }

  return name;
};

/**
 * @override
 */
ProcessNodes.prototype.fallbackDefault = function (event) {
  var selectors = [];

  switch (event.type) {

  case "start":
    selectors.push(event.name, "*");
    break;

  case "end":
    selectors.push("END");
    break;

  case "text": selectors.push("TEXT"); break;

  case "eof": return null;
  }

  // check selectors
  // console.log("checking", selectors);
  var handler, levelStates = this.levelState;
  for (var level = 0; level < levelStates.length; level++) {
    for (var idx = 0; idx < selectors.length; idx++) {
      if ((handler = levelStates[level].selectors[selectors[idx]])) {
        // console.log("found selector at level="+level, "selector="+idx, levelStates[level]);
        return handler.call(this, event);
      }
    }
  }

  this.sendEvent(event);
  return null;
};

ProcessNodes.prototype.command_attr = function (event) {
  var lastEvent = this.getLastStartEvent();
  if (!lastEvent) {
    this.warn("no last event for dynamic attribute");
    this.captureLevelEvents(true).done();
    return;
  }
  var attr, expression;

  this.captureFirstText()
    .then(function(text) {
      var str = (event.attributes["class"] || "").trim()+text;
      attr = str.split("=", 1)[0];
      expression = str.replace(/^[^=]*=/, "");

      return this.evalExpression(expression);

    }.bind(this))
    .then(function(value) {

      if (attr == "+") {
        if (typeof value == "object") {
          Object.keys(value).forEach(function(name) {
            if (name == "class" && lastEvent.attributes[name]) {
              lastEvent.attributes[name] += " " + value[name];
            } else {
              lastEvent.attributes[name] = value[name];
            }
          });
        } else {
          this.warn("not an object: "+expression);
        }
      } else {
        if (attr.endsWith("+")) {
          attr = attr.substring(0, attr.length -1);
          lastEvent.attributes[attr] = (lastEvent.attributes[attr] ? lastEvent.attributes[attr]+" ":"")+""+value;
        } else {
          lastEvent.attributes[attr] = ""+value;
        }
      }

      return this.captureLevelEvents(true);
    }.bind(this)).done();
};

/**
 * Example:
 *   :eval array.push(expression)
 */
ProcessNodes.prototype.command_eval = function (event) {
  this.captureFirstText()
    .then(this.evalExpression.bind(this))
    .then(this.captureLevelEvents.bind(this, true))
    .done();
};

/**
 * Example:
 *   :var variable = expression
 *   :var variable
 */
ProcessNodes.prototype.command_var = function (event) {
  var textContinuation = Q.defer();
  var variable;

  this.captureFirstText(textContinuation)
    .then(function(text) {
      var _idx = text.indexOf('=');
      variable = (_idx == -1 ? text : text.substr(0, _idx)).trim();
      var expr = _idx != -1 ? text.substr(_idx + 1) : "null";

      if (/\?$/.test(variable)) {
        variable = variable.substr(0, variable.length - 1).trim();

        return this.evalExpression(variable)
          .then(function(eval) {
            if (eval && !(eval instanceof Error)) {
              // console.log("set already (", eval, ") not updating", variable);
              return undefined;
            }
            return this.evalExpression(expr);
          }.bind(this));
      }
      return this.evalExpression(expr);
    }.bind(this))
    .then(function(value) {
      if (value !== undefined) {
        // console.log("VAR:", variable, "=", value);
        variable
          .split(".")
          .reduce(function(prev, name, idx, arr) {
            // We need to handle subscript notation, eg: some.nested.properties = value
            // console.log("===", idx, arr, name, typeof prev);

            if (idx == arr.length - 1) {
              // console.log("["+name+"] = "+JSON.stringify(value));
              prev[name] = value;
            } else if (!prev[name]) {
              // console.log("["+name+"] = {}");
              prev[name] = {};
            }
            return prev[name];

          }, this.vmContext);
      }
      // variable+"="+expr
      this.captureLevelEvents(true);
      textContinuation.resolve();
    }.bind(this))
    .done();
};

ProcessNodes.prototype.command_if = function (event) {
  this.captureTextAndEval()
    .then(function(value) {
      // console.log("if:value:", value, !!value);
      if (value instanceof Error) {
        this.sendEvent(event);
        this.sendEvent({ type: "text", text: "[JS expression error: "+value+"]" });
        return null;
      }
      if (!!value) {
        this.levelState[0].onEnd = function(event) { return false; };
        return null;
      } else {
        return this.captureLevelEvents(true);
      }
    }.bind(this)).done();
};

/**
 * Syntax:  :each item, key in array_expression
 */
ProcessNodes.prototype.command_each = function (event) {

  var bindName;
  var bindKey;
  var arrayExpr;
  // var arrayLength;

  // TODO: eval expression once only

  var array;
  var textContinuation = Q.defer();
  var levelContinuation = Q.defer();

  this.captureFirstText(textContinuation)

    .then(function(text) {

      var parts = text.split(" in ");
      if (parts.length < 2) {
        // console.log(":each bad syntax argument:", text);
        this.sendEvent(event);
        this.sendEvent({ type: "text", text: text });
        return null;
      }

      var bindParts = parts[0].trim().split(",", 2);
      bindName = bindParts[0].trim();
      if (bindParts[1]) {
        bindKey = bindParts[1].trim();
      }

      arrayExpr = parts[1].trim();
      return this.evalExpression(arrayExpr);

    }.bind(this))
    .then(function(_array) {
      array = _array;
      var noCapture = false;

      if (!array || typeof array.length !== "number") {
        // Arrays constructed inside the VM context are not instances
        // of the same Array as ours: we cannot check with the 'instanceof' operator.
        if (typeof array == "object") {
          this.warn("object properties: "+Object.keys(array).join(", "));
        }
        this.warn(":each: argument is not an array ("+(typeof array)+"): "+arrayExpr);
        noCapture = true;
      }
      // console.log("ARRAY", array);

      var p = this.captureLevelEvents(noCapture, levelContinuation);
      textContinuation.resolve();

      return p;

    }.bind(this))

    .then(function(buffer) {
      if (buffer) {
        // console.log("BUFFER", buffer);
        var idx = 0;

        var _iterate = function () {
          var obj = {};
          obj[bindName] = array[idx];

          if (bindKey) {
            obj[bindKey] = idx;
          }
          var releaseContext = _maskProperties(obj, this.vmContext);

          return this.sourceEvents(buffer)
            .then(function() {
              // after "play" completes...
              // console.log("finished iteration", idx, "out of", array.length);

              releaseContext();
              idx++;
              if (idx < array.length) {
                return _iterate();
              } else {
                // the task is finished
                // console.log("finish");
                levelContinuation.resolve();
                return null;
              }
            });
        }.bind(this);

        if (array.length > 0) {
          _iterate();
          // return _iterate();
        } else {
          levelContinuation.resolve();
        }
      } else { // if (buffer)
        levelContinuation.resolve();
      }

    }.bind(this))
    .done();
};

/**
 * Alternative syntax: "::" instead of ":on" **** OUTDATED!
 *
 * *** (the command only matches START event at the moment)
 *
 * Syntax:  :: <selector> [as <binding>]
 *
 * <selector> can take different forms:
 *   "some-element"   : matches any START event named "some-element"
 *   "/some-element"  : same, but only direct children (not all descendants)
 *   "some-element/"  : captures the whole tree under the element,
 *                       including some-element itself (outer capture)
 *   "some-element/~" : captures the whole tree under the element,
 *                       excluding some-element itself (inner capture)
 *   "*"              : capture any event (compatible with "/*" but not "* /")
 *   "/#"             : captures any text which is a direct child
 *
 * <binding> specifies where the event or event array is saved. It can be:
 *   - a variable name;                 example: myElement
 *   - an object name with propery;     exemple: myElement.title
 *   - a variable name / obj property to concatenate the value to;
 *                                      example: myElement[] or myElement.caption[]
 *
 *
 * // Binding expression (valid argument to ":on" and "::"):
 * //   "title := /TEXT"  : matches only once within the current scope,
 * //                       affects variable "title"
 * //   "blocs += /bloc/" : append
 */
ProcessNodes.prototype.command_on = function (event) {
  var bindName = "_";
  var selector, affect = "=";
  var directChild = false, wholeTree = false, outerTree = false;

  // this.transformChain.debugPrintChain("..before :on");
  var def = Q.defer();

  this.captureFirstText()

    .then(function(text) {

      text = text.trim();
      if (text[text.length - 1] == ')') {
        var parse = /^(.*)\(([_a-zA-Z0-9]+)\)$/i.exec(text);
        // console.log("parse", parse);
        if (parse) {
          selector = (""+parse[1]).trim();
          bindName = (""+(parse[2] || selector)).trim();
        }
      } else {
        selector = bindName = text;
      }
      // var parse = /^([^ ]+)( +as +(.*))?$/i.exec(text);
      if (selector) {
        // console.log("selector", selector, "//", bindName);

        if (selector) {
          parse = /^(\/)?([^/]+)(\/)?$/.exec(selector);
          if (parse) {
            selector = parse[2];
            if (parse[1]) { // leading slash
              directChild = true;
            }
            if (parse[3]) { // trailing slash
              wholeTree = true;
            }

            return this.captureLevelEvents(false, def);
          }
        }
      }
      throw new Error("invalid template selector: "+text);
      // this.warn("invalid template selector: "+text);
      // return null;
    }.bind(this))

    .then(function(templateBuffer /* of events to apply when selector is met */) {

      // console.log("..on() matching selector:", selector);
      // console.log("..on() templateBuffer", templateBuffer);

      // Function to be called when selector is matched.
      // It is responsable for processing the event, capture following events, etc.
      this.addMatch(selector, function(event, selectors) {

        var def = Q.defer();

        // console.log("selector", selector, bindName);
        event = Object.assign({}, event);

        //   .then(function() {

        //     return this.captureLevelEvents(false, def);
        //   })
        this.captureLevelEvents(false, def)
          .then(function(events) {
            this.vmContext[bindName] = event;
            event.children = events;

            //   // Evaluate attributes whose value are prefixed by '^'
            //   return Q.all(Object.keys(event.attributes || {})
            //         .filter(function(name) { return event.attributes[name][0] == '^'; })
            //         .map(function(name) {
            //           console.log("attr", name, event.attributes[name]);
            //           return this.evalExpression(event.attributes[name].substr(1))
            //             .then(function(value) {
            //               event.attributes[name] = value;
            //             });
            //         }.bind(this)));

            // }.bind(this))
            // .then(function(values) {
            // console.log(":on:("+selector+") captured events", events);
            // console.log(":on:("+selector+") sourcing:", templateBuffer);
            return this.sourceEvents(templateBuffer, true);
          }.bind(this))
          .then(function() {
            // console.log("sourced events");
            def.resolve();
          })
          .done();


      }); // 'this' will be the caller proc
      def.resolve();

      // handler.shiftLevelMatch = function(selectors, name) {
      //   if (!directChild) {
      //     selectors[selector] = handler;
      //   }
      // };
    }.bind(this), function(e) {
      this.warnError(e);
      def.resolve();
      return;
    }.bind(this)).done();

};

ProcessNodes.prototype.command_process_next_route = function (event) {
  var def = Q.defer();

  this.captureLevelEvents(true, def)
    .then(function() {
      var routePath = this.vmContext.REQUEST.path;
      return routePath.streamNext();
    }.bind(this))
    .then(function(stream) {
      return stream ? this.sourceReadable(stream) : null;
    }.bind(this))
    .then(function(stream) {
      def.resolve();
    }.bind(this))
    .done();
};

/**
 * The :process commands either evaluate a text expression or instanciate a transform class
 */
ProcessNodes.prototype.command_process = function (event) {
  var textEventP = Q.defer();
  var levelEventsP = Q.defer();
  var value;

  if (event.attributes["class"]) {
    this.captureLevelAndTransform(event.attributes["class"],
                                  event.attributes.id,
                                  event.attributes.cache);

  } else {
    this.captureTextAndEval(textEventP)
      .then(function(_value) {
        value = _value;
        // console.log("got value", value);
        // value = _value;
        if (value instanceof Error) {
          value = "[JS expression error: "+value+"]";
        }
        //   return value; // might be a Promise

        var d = this.captureLevelEvents(false, levelEventsP); // PROBLEM: this is never resolved!
        textEventP.resolve();
        return d;
      }.bind(this))
      .then(function(events) {

        // console.log(":process value: ", value && value.constructor ? value.constructor.name : value,
        //             ".read =", value && typeof value.read);

        if (value && value.readable) {
          // expression evaluated as a Readable stream
          return this.sourceTransform(value, events);

        } else {

          if (!(value instanceof Array)) {
            if (typeof value == "object") {
              // expression evaluated as a single event
              value = [value];
            } else {
              // not an object nor array: we make a text event out of it
              value = [{ type: "text", text: ""+value }];
            }
          }
          // return this.sourceTransform(value);
          return this.sourceEvents(value);
        }
      }.bind(this))
      .then(function() { levelEventsP.resolve(); })
      .done();
  }
};


////////////////////////////////////////////////////////////////////////////////
// INTERNAL FUNCTIONALITY

/**
 * Used by command_process().
 */
ProcessNodes.prototype.sourceTransform = function (_ClassOrObject, events) {
  // this.log("sourceStream");
  if (typeof _ClassOrObject == "string") {
    _ClassOrObject = this.loadModule(_ClassOrObject);
  }
  if (_ClassOrObject) {

    if (typeof _ClassOrObject == "function") {
      var stream = new _ClassOrObject();
    } else {
      stream = _ClassOrObject;
    }
    // console.log(":process: instanciated stream", stream.constructor.name, stream._readableState.objectMode);
    // console.log("events", events);
    // this.debugQueue(":process before");

    if (stream.write) {
      if (events && events.length) {
        // console.log("Establishing input to Writable stream: "+stream.constructor.name);
        var clone = this.cloneStream();
        clone.pipe(stream);
        (new ReadArray(events)).pipe(clone);
      } else {
        stream.end();
      }
    } else {
      // console.log("Ignoring "+events.length+" events as stream is not Writable!");
    }
    return this.sourceReadable(stream);
  }
};

var js_cache = {};

/**
 * Used by command_process().
 */
ProcessNodes.prototype.captureLevelAndTransform = function (_ClassOrObject, bindName, cache) {
  var def = Q.defer();

  var fromCache = bindName && cache && js_cache[cache];
  // if (bindName = cache) {
  //   if (js_cache[cache]) {

  //   }
  // }

  // this.log("captureLevelAndTransform");
  this.captureLevelEvents(/*false*/ fromCache, def) // PROBLEM: this is never resolved!
    .then(function(events) {
      if (fromCache) {
        this.vmContext[bindName] = js_cache[cache];
        def.resolve();
        return;
      }
      if (typeof _ClassOrObject == "string") {
        _ClassOrObject = this.loadModule(_ClassOrObject);
      }
      if (_ClassOrObject) {

        if (typeof _ClassOrObject == "function") {
          var stream = new _ClassOrObject();
        } else {
          stream = _ClassOrObject;
        }
        // console.log(":process: instanciated stream", stream.constructor.name, stream._readableState.objectMode);
        // console.log("events", events);
        // this.debugQueue(":process before");

        if (stream.write && events.length) {
          // console.log("Establishing input to Writable stream: "+stream.constructor.name, "events =", events);
          var clone = this.cloneStream();
          if (bindName) {
            clone.vmContext[bindName] = stream;
            this.vmContext[bindName] = stream;
            if (cache) {
              stream.cached = true;
              js_cache[cache] = stream;
            }
          }
          // clone.pipe(stream);
          (new ReadArray(events)).pipe(clone).pipe(stream);
        } else {
          // console.log("Ignoring "+events.length+" events as stream is not Writable!");
        }
        this.sourceReadable(stream)
          .then(function() {
            // console.log("resolving captureLevelEvents()");
            // if (bindName && cache) {
            //   js_cache[cache] = stream.stringify();
            // }
            def.resolve();
          }.bind(this))
          .done();

      } else {
        def.resolve();
      }
    }.bind(this))
    .done();
};

ProcessNodes.prototype.loadModule = function (className) {
  try {
    var _Class = require("./"+className+".js");
  }
  catch (e) {
    this.warn("could not load module ("+e.message+"): "+className);
    _Class = null;
  }
  return  _Class;
};

/**
 * Capture first-child-text and evaluate it as a JS expression
 *
 * @return {promise} will be resolved with the value of the evaluation
 */
ProcessNodes.prototype.captureTextAndEval = function (processPromise) {
  var def = Q.defer();

  return this.captureFirstText(def)
    .then(function(expression) {
      return this.evalExpression(expression);

    }.bind(this))
    .then(function(value) {
      // console.log("final value", value);
      if (processPromise) {
        processPromise.then(function() { def.resolve(); });
      } else {
        def.resolve();
      }
      return value;
    });
  // .then(function(value) {
  //   if (value instanceof Error) {
  //     this.warn("evaluation error: "+value+" // for expression: "+holder.expression);
  //   }
  //   return value;
  // }.bind(this));
};


/**
 * Evaluate an expression (in the context VM) with asynchronous (promise) capture
 *
 * @param {Object} options      Can have 'silent' (boolean)
 */
ProcessNodes.prototype.evalExpression = function (expr, options) {
  // console.log("evaluating expression:", expr);
  var def = Q.defer();
  this.vmContext._finish = function(value) {
    // console.log("resolving value", value);
    def.resolve(value);
  };
  this.vmContext._error = function(error) {
    // console.log("resolving value", value);
    this.sendEvent({ type: "message", level: "warn", message: "evaluation promise rejected: "+error.message });
    def.resolve(undefined);
  }.bind(this);
  var _expr = "_="+expr;
  _expr += "; if (_ && _.then) { _.then(_finish, _error); } else { _finish(_); }";
  try {
    var value = vm.runInContext(_expr, this.vmContext, {
      timeout: 5000
    });
  }
  catch (e) {
    // console.error(":eval expression failed: <<", expr, ">> error is:", e);
    if (!options || !options.silent) {
      this.warnError(e, "evaluation of expression: "+expr);
    }
    // def.resolve(e);
    // value = e;
    def.resolve(undefined);
  }
  // // value = eval(expr);
  // console.log("raw value", typeof value, value && value.then);
  // return value;

  return def;
};

/**
 * Attach a handler for a selector, will be applied on matched 'start' events
 *
 * The handler will be called with the 'this' scope.
 * Selector's recursivity is managed here (ie. "my/sub/element"),
 * BUT not any trailing slash, which means "caputure the whole thing"
 * which is managed by command_on().
 */
ProcessNodes.prototype.addMatch = function (selector, handler, parentLevel) {
  // console.log("addMatch", selector, parentLevel || 0, this.levelState);
  var selectors = this.levelState[parentLevel || 0].selectors;
  // var wrapper = function(event) {
  //   this.sendEvent(event);
  //   return handler.apply(this, arguments);
  // }.bind(this);
  // var parts = selector.split("/", 2);
  // wrapper.onLevelEnter = function(name) {
  //   if (parts[1]) {
  //   this.addMatch(parts[1],
  // }.bind(this);
  // selectors[parts[0]] = handler;
  selectors[selector] = handler;
};


////////////////////////////////////////////////////////////////////////////////
// UTIL FUNCTIONS

/**
 * Copy properties of newObj into maskedObj but keep a backup to restore later
 *
 * @return {Function} Release function: the caller should call il to restore the backed-up value
 */
function _maskProperties(newObj, maskedObj) {
  var values = {};
  var present = {};

  // console.log("MASK", newObj);
  for (var key in newObj) {
    if ((present[key] = maskedObj.hasOwnProperty(key))) {
      values[key] = maskedObj[key];
    }
    maskedObj[key] = newObj[key];
  }

  return function() {
    // console.log("FREE", newObj, present);
    for (var key in present) {
      if (present[key]) {
        maskedObj[key] = values[key];
      } else {
        delete maskedObj[key];
      }
    }
  };
}
