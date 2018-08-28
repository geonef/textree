var stream = require('stream');
var util = require("util");
var Transform = require("./Transform");
var ReadArray = require("./export/ReadArray");
var Q = require("kew");

var id = 0;

function NodeProcessor(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  Transform.call(this, options);

  this.id = id++;
  // queue of events to process (starting with [0])
  // this.eventQueue = [];

  // execution stack (current is [index - 1])
  this.contextStack = [this.executeDefault];

  // input-level (start/stop) state stack (current is [0])
  // initialized with root level
  if (options.levelState) {
    this.levelState = options.levelState.slice(0);
  } else {
    this.levelState = [{selectors: {}}];
  }
  this.errors = [];
  // this.on("end", function() { console.log(this.constructor.name+"#end", this.eventQueue.length); }.bind(this));
}

util.inherits(NodeProcessor, Transform);
module.exports = NodeProcessor;

NodeProcessor.prototype.tagCommandPrefix = ":";

NodeProcessor.prototype._flush = function (done) {
  // this.log("FLUSH");

  this._transform({ type: "eof" }, null, done);
};

var _transforming = false;

NodeProcessor.prototype._transform = function (event, encoding, done) {

  // if (_transforming) {
  //   this.log("_transform() re-called before previous callback was called: ", event, this.lastReturn);
  // }
  _transforming = true;
  var _orig_done = done;
  done = function() { _transforming = false; _orig_done(); };

  if (event) {
    if (this.lastReturn && this.lastReturn.then) {
      this.lastReturn = this.lastReturn.then(this.processEvent.bind(this, event));
    } else {
      this.lastReturn = this.processEvent(event);
    }
  } else {
    // this.log("ending");
  }
  if (this.lastReturn && this.lastReturn.then) {
    this.lastReturn = this.lastReturn.then(done);
  } else {
    done();
  }

};

NodeProcessor.prototype.processEvent = function (event) {
  // this.log("processing event", event);

  if (Buffer.isBuffer(event)) {
    this.sendEvent(event); // or directly this.push(event) ?
    return;
  }
  if (typeof event == "string") {
    event = { type: "text", text: event };
  }
  switch (event.type) {
  case "message":
    this.sendEvent(event);
    return null;
  case "_callback":
    // this.debugInfo("CALLBACK");
    event.callback.call(this);
    return null;
  }
  var func = this.contextStack[this.contextStack.length - 1];
  return func.call(this, event);
};

/**
 * Wrapper to this.push() for sending an event to output
 *
 * {type:"start"} events are not sent immediately but kept for possible calls
 * to this.getLastStartEvent().
 */
NodeProcessor.prototype.sendEvent = function (event) {
  if (this.lastStartEvent) {
    this.push(this.lastStartEvent);
    this.lastStartEvent = null;
  }
  if (event) {
    if (event.type == "start") {
      this.lastStartEvent = event;
    } else {
      this.push(event);
    }
  }
};

/**
 * Return the last start event sent through sendEvent() (to add attributes, for example)
 */
NodeProcessor.prototype.getLastStartEvent = function () {
  if (!this.lastStartEvent) {
    this.warn("Text2trees#getLastStartEvent: no last start event!");
  }
  return this.lastStartEvent;
};

/**
 * Process events buffer, not sending to output but feeding input (and process)
 *
 */
NodeProcessor.prototype.sourceEvents = function (buffer, isolateLevel) {
  var readable = new ReadArray(buffer);
  return this.sourceReadable(readable, isolateLevel);

  // var def = Q.defer();

  // this.eventQueue = buffer.concat(
  //   [{type:"_callback", callback: def.resolve.bind(def)}],
  //   this.eventQueue);

  // return def.promise;
};

/**
 * Like sourceEvents, but act on Readable stream instead of an array of events
 */
NodeProcessor.prototype.sourceReadable = function (readable, isolateLevel) {
  var def = Q.defer();
  var count = 0;
  var ret;

  // console.log("sourcing", readable.constructor.name);

  if (isolateLevel) {
      this.unshiftLevel({ name: null });
  }
  var finish = function() {
    if (isolateLevel) {
      this.shiftLevel();
    }
    def.resolve();
  }.bind(this);

  readable.on("data", function(event) {
    // this.log("DATA "+readable.constructor.name, event);
    count++;
    if (ret && ret.then) {
      ret = ret.then(this.processEvent.bind(this, event));
    } else {
      ret = this.processEvent(event);
    }
    if (ret && ret.then) {
      readable.pause();
      ret = ret.then(function() {
        readable.resume();
      });
    }
  }.bind(this));

  readable.on("end", function() {
    // this.log("END "+readable.constructor.name, count);
    if (ret && ret.then) {
      ret = ret.then(finish);
    } else {
      finish();
    }
  }.bind(this));

  return def.promise;
};

////////////////////////////////////////////////////////////////////////////////
// shift/unshift level function: to move within the context stack

NodeProcessor.prototype.unshiftLevel = function (event) {
  // this.warn("+1", event.name);
  this.levelState.unshift({ tag: event.name, selectors: {} });

  // function _F() {}
  // _F.prototype = this.levelState[0].selectors;
  // this.levelState.unshift({ tag: event.name, selectors: new _F() });

  // var selectors = this.levelState[0].selectors;
  // var newSelectors = {};
  // for (var key in selectors) {
  //   selectors[key].shiftLevelMatch(newSelectors, event.name);
  // }
  // this.levelState.unshift({ tag: event.name, selectors: newSelectors });
};

NodeProcessor.prototype.shiftLevel = function () {
  // this.warn("-1");
  var level = this.levelState.shift();
  if (!this.levelState[0]) {
    this.warn("unmatched END event!");
  } else if (level && level.onEnd) {
    if (!level.onEnd.call(this)) {
      return false; // hook can return false to get the event ignored
    }
  }
  return true;
};

////////////////////////////////////////////////////////////////////////////////
// CAPTURE functions - return a promise about what has been captured
//   (used by COMMAND functions)

/**
 * Capture first-child-text
 *
 * @return {promise} will be resolved with the concatenated text
 */
NodeProcessor.prototype.captureFirstText = function (processPromise) {
  var def = Q.defer();
  var text = "";

  this.contextStack.push(function(event) {
    switch (event.type) {
    case "text":
      if (event.multiline) {
        text += "\n";
      }
      text += event.text;
      return null;
    case "start": // a child
    case "end": // with or without text
    case "eof":
      this.contextStack.pop(); // means a return
      def.resolve(text);
      // this._transform(event, null, function() {});
      if (processPromise) {
        return processPromise.then(this.processEvent.bind(this, event));
      } else {
        return this.processEvent(event);
      }
      // this.eventQueue.unshift(event); // will be processed normally
      // this.process(event);
      break;
    default:
    }
    return null;
  });

  return def.promise;
};

/**
 * Capture all next events until end of level (next stop event for current level)
 *
 * @param {boolean} dontBuffer  true to avoid buffering events (just ignore them until level end)
 * @param {Promise?} processPromise  promise to wait for for acknowledging last end event
 * @return {promise} will be resolved with an array of the events
 */
NodeProcessor.prototype.captureLevelEvents = function (dontBuffer, processPromise) {
  var buffer = [];
  var def = Q.defer();
  var depth = 0;

  this.contextStack.push(function(event) {
    switch (event.type) {
    case "start": depth++; break;
    case "end": depth--; break;
    }
    if (depth >= 0 && event.type != "eof") {
      if (dontBuffer) {
        // console.log("throwing event", event);
      } else {
        buffer.push(event);
      }
    } else {
      this.contextStack.pop();
      this.shiftLevel();

      // var shiftLevel = function(value) {
      //   this.shiftLevel();
      //   return value;
      // }.bind(this);
      def.resolve(dontBuffer ? null : buffer);

      return processPromise || null;
      // return processPromise ? processPromise.then(shiftLevel) : shiftLevel();;
    }
  }.bind(this));

  return def.promise;
};

////////////////////////////////////////////////////////////////////////////////

NodeProcessor.prototype.sanatizeCommandName = function(name) {
  return name;
};

NodeProcessor.prototype.fallbackDefault = function (event) {
  this.sendEvent(event);
  return null;
};

NodeProcessor.prototype.executeDefault = function (event) {
  switch (event.type) {

  case "start":
    this.unshiftLevel(event);

    if (event.name.startsWith(this.tagCommandPrefix)) {
      var name = event.name.slice(this.tagCommandPrefix.length);
      name = this.sanatizeCommandName(name);
      var fname = "command_"+name.replace(/-/g, "_");
      if (this[fname]) {

        return this[fname].call(this, event);
      } else {
        this.warn("command not found: "+event.name);
        // this.captureLevelEvents(true).done();
        // return null;
      }

    }
    break;

  case "end":
    if (this.shiftLevel(event) === false) {
      return null;
    }
    break;

  case "eof":
    return null; // only useful for capture handlers, ignored by default
  }

  return this.fallbackDefault(event);
};

////////////////////////////////////////////////////////////////////////////////

// NodeProcessor.prototype.debugInfo = function () {
//   console.log("DEBUG ", arguments[0]);
//   console.log("*** queue #", this.eventQueue.length, this.eventQueue);
//   console.log("*** levelState #", this.levelState.length,
//               this.levelState.map(function(level) {return level.tag;}).join(" < "));
// };
// NodeProcessor.prototype.debugQueue = function (msg) {
//   console.log("DEBUG", this.constructor.name, msg, "queue#", this.eventQueue.length, this.eventQueue);
// };

/**
 * Log message by sending message node to output
 *
 * (should appear in resulting as an HTML comment, as transformed by PrintXml)
 */
NodeProcessor.prototype.log = function (msg) {
  var args = ["LOG", this.constructor.name+"#"+this.id];
  for (var i = 0; i < arguments.length; i++) {
    args.push(arguments[i]);
  }
  console.log.apply(console, args);
};
NodeProcessor.prototype.warn = function () {
  var message = Array.prototype.join.call(arguments, " ");
  console.log("WARN ", message);
  this.sendEvent({ type: "message", level: "warn", message: this.constructor.name+": "+message });
  this.errors.push(message);
};
NodeProcessor.prototype.warnError = function (error, message) {
  this.warn("caught " + error.name + (message ? " for "+message : "") + ": " + error);
};
NodeProcessor.prototype.getErrors = function () {
  return this.errors;
};
