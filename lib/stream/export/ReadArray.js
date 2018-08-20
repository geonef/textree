
var stream = require('stream');
var util = require("util");

function ReadArray(array, options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  stream.Readable.call(this, options);

  this.array = array;
  this.index = 0;
}

util.inherits(ReadArray, stream.Readable);
module.exports = ReadArray;

ReadArray.prototype._read = function(size) {
  // console.log("ReadArray::_read", size);

  for (var i = 0; i < size; i++) {

    if (this.index >= this.array.length) {
      this.push(null);
    } else {

      if (!this.pushEvent(this.array[this.index++])) {
        break;
      }
    }

  }
};

function deepCopy(value) {
  var copy;

  if (value instanceof Array) {
    copy = value.slice(0);
  } else if (typeof value == "object" && value != null) {
    copy = {};

    Object.keys(value).forEach(function(prop) {
      copy[prop] = deepCopy(value[prop]);
    });
  } else {
    copy = value;
  }

  return copy;
}

ReadArray.prototype.pushEvent = function(event) {
  return this.push(deepCopy(event));
};
