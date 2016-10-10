/**
 * Writable stream writing to the HTTP response with cache handling
 *
  (used by ../http-controller)
 *
 * Content must be written as Buffer chunks and meta-data as event objects
 * (HTTP status code, headers, etc.)
 *
 * In addition, output is cached until MAX_CACHABLE_SIZE bytes
 * for saving into the memcached server.
 */

var stream = require('stream');
var util = require("util");
var Q = require("kew");
var env = require("../env");

// Content above 1 MB won't be cached
var MAX_CACHABLE_SIZE = 1024 * 1024;

function WriteHttpResponse(response, options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  stream.Transform.call(this, options);
  if (options.contentCacheKey) {
    if (options.contentCacheKey.length < 250) {
      // console.log("HttpResponse: enabling cache with contentCacheKey=\""+options.contentCacheKey+"\"");
      this.contentCacheKey = options.contentCacheKey;
      this.ouputCacheBuffer = new Buffer(MAX_CACHABLE_SIZE);
      this.ouputCacheBufferUsed = 0;
    } else {
      console.log("WriteHttpResponse: disabled cache as key exceeds the 250 bytes limit:",
                  options.contentCacheKey);
    }
  }
  this.response = response;
  this.pipe(response);

  this.on("finish", function() {
    // console.log("WriteHttpResponse#finish");
    if (this.ouputCacheBuffer) {
      var slicedBuffer = this.ouputCacheBuffer.slice(0, this.ouputCacheBufferUsed);
      // console.log("CACHE this.contentCacheKey="+this.contentCacheKey,
      //             // "this.ouputCacheBuffer =", typeof this.ouputCacheBuffer,
      //             "length="+this.ouputCacheBuffer.length,
      //             "bytes="+this.ouputCacheBufferUsed,
      //             "sliced="+slicedBuffer.length);
      env.setCachedContent(this.contentCacheKey, slicedBuffer);
    }

  });
  // this.on("finish", this.onEnd.bind(this));
}

util.inherits(WriteHttpResponse, stream.Transform);
module.exports = WriteHttpResponse;

WriteHttpResponse.prototype._transform = function(chunk, encoding, done) {
  // console.log("WriteHttpResponse: _write", chunk);

  if (chunk && chunk.type == "text") {
    chunk = chunk.text;
  }
  if (typeof chunk == "string" || Buffer.isBuffer(chunk)) {
    // Case: CONTENT Flow

    // console.log("HttpResponse CONTENT FLOW content:",
    //             Buffer.isBuffer(chunk) ? "(buffer)" : "(string)", "size="+chunk.length/*, chunk*/);

    if (this.ouputCacheBuffer) {
      var chunkSize = typeof chunk == "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (this.ouputCacheBufferUsed + chunkSize < MAX_CACHABLE_SIZE) {
        if (typeof chunk == "string") {
          this.ouputCacheBuffer.write(chunk, this.ouputCacheBufferUsed); // string version
        } else {
          chunk.copy(this.ouputCacheBuffer, this.ouputCacheBufferUsed); // Buffer version
        }
        this.ouputCacheBufferUsed += chunkSize;
      } else {
        console.log("Content exceeds MAX_CACHABLE_SIZE (=", MAX_CACHABLE_SIZE, "), not cached");
        this.ouputCacheBuffer = null;
      }
    }
    this.push(chunk);
    done();

  } else if (typeof chunk == "object") {
    // Case: CONTROL Flow

    this.processEvent(chunk, done);
  }
};

// WriteHttpResponse.prototype.onEnd = function() {
//   console.log("HttpResponse END", arguments);
//   this.response.end();
// };

WriteHttpResponse.prototype.processEvent = function(event, done) {
  console.log("HttpResponse CONTROL FLOW event:", event);
  if (event.type == "meta") {
    switch (event.name) {
    case "status":
      this.response.statusCode = event.value;
      break;
    case "type":
      this.response.setHeader("Content-Type", event.value);
      break;
    case "header":
      this.response.setHeader(event.header, event.value);
      break;
    case "cache":
      if (event.value === false) {
        this.ouputCacheBuffer = null; // disabling caching for the current page
      }
      break;
    default:
      console.log("WriteHttpResponse: invalid 'http' control event name: "+event.name);
    }
  }
  done();
};


// /**
//  */
// function WriteHttpResponse(response, options) {
//   if (!options) { options = {}; }
//   options.objectMode = true;
//   stream.Writable.call(this, options);

//   this.response = response;

//   this.on("finish", function() {
//     console.log("on finish http");
//   });
//   // this.on("finish", this.onEnd.bind(this));
// }

// util.inherits(WriteHttpResponse, stream.Writable);
// module.exports = WriteHttpResponse;

// WriteHttpResponse.prototype._write = function(chunk, encoding, done) {
//   // console.log("WriteHttpResponse: _write", chunk);
//   if (typeof chunk == "string" || Buffer.isBuffer(chunk)) {
//     console.log("HttpResponse: writing:", chunk);
//     this.response.write(chunk, encoding, done);
//   } else {
//     this.processEvent(chunk, done);
//   }
// };

// WriteHttpResponse.prototype.onEnd = function() {
//   console.log("HttpResponse END", arguments);
//   this.response.end();
// };

// WriteHttpResponse.prototype.processEvent = function(event, done) {
//   console.log("HttpResponse: event", event);
//   done();
// };
