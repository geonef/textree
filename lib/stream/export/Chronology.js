
var stream = require('stream');
var util = require("util");
var NodeProcessor = require("../NodeProcessor");

function Chronology(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  NodeProcessor.call(this, options);

  this.inventory = {};
  this.events = [];

  this.type = "start";
  this.name = this.tagCommandPrefix + "object";
}

util.inherits(Chronology, NodeProcessor);

Chronology.prototype.tagCommandPrefix = "chrono:";
Chronology.prototype.waitAccount = "/__ATTENTE__";


////////////////////////////////////////////////////////////////////////////////
// NODE COMMANDS


/**
 * Declaring an inventory item
 */
Chronology.prototype.command_inventory = function(nodeEvent) {
  console.log("command_inventory");
  this.captureLevelEvents(true).then(function() {
    var item = Object.assign({}, nodeEvent.attributes);

    if (!item["class"]) {
      this.warn("missing attribute 'class' for "+this.tagCommandPrefix+"inventory");
      return;
    }

    if (!this.inventory[item["class"]]) {
      this.inventory[item["class"]] = [];
    }
    this.inventory[item["class"]].push(item);
  }.bind(this)).done();
};

/**
 * Declaring an event
 */
Chronology.prototype.command_event = function(nodeEvent) {
  console.log("command_event");
  this.captureLevelEvents(true).then(function() {
    var event = Object.assign({}, nodeEvent.attributes);
    if (!event.date) {
      this.warn("missing attribute 'date' for "+this.tagCommandPrefix+"event");
      return;
    }
    event.date = new Date(event.date);
    if (typeof event.tags == "string") {
      event.tags = event.tags.split(",");
    }

    this.events.push(event);

  }.bind(this)).done();
};


////////////////////////////////////////////////////////////////////////////////
// QUERY functions

////////////// _Day class BEGIN
function _Day(date, events) {
  this.date = new Date(date);
  this.events = events;
}
_Day.prototype.getEvent = function(tag, match) {
  return this.getEvents(tag, match)[0] || null;
};

/**
 * Return a list of events
 *
 * @param {string} tag         tag to filter (optional)
 * @param {Object} match       if given, the events are filtered according to
 *                             these property values
 */
_Day.prototype.getEvents = function(tag, match) {
  return this.events.filter(function(event) {
    if (tag && (!event.tags || event.tags.indexOf(tag) < 0)) {
      return false;
    }
    if (match) {
      return Object.keys(match).every(function(matchKey) {
        return event[matchKey] == match[matchKey];
      });
    }
    return true;
  });
};
////////////// _Day class END
Chronology.prototype.getEvent = _Day.prototype.getEvent;
Chronology.prototype.getEvents = _Day.prototype.getEvents;

Chronology.prototype.getDays = function(start, end) {
  this.sealEvents();

  // Fix params
  start = new Date(start || this.events[0].date);
  end = new Date(end || this.events[this.events.length - 1].date);

  // make days array
  var days = [];
  for (var date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    var dateStr = this.formatDate(date);
    var day = new _Day(date, this.eventByDate[dateStr] || []);
    days.push(day);
  }

  return days;
};

Chronology.prototype.formatDate = function(date) {
  return (new Date(date)).toISOString().substr(0,10);
};

Chronology.prototype.numberOfDays = function(date1, date2) {
  date1 = new Date(date1);
  date2 = new Date(date2);
  var timeDiff = Math.abs(date2.getTime() - date1.getTime());

  return Math.ceil(timeDiff / (1000 * 3600 * 24));
};
Chronology.prototype.daysAfter = function(date, days) {
  var dayafter = new Date(date);
  dayafter.setDate(dayafter.getDate() + days);
  return dayafter.toISOString().substr(0,10);
};
Chronology.prototype.isWeekEnd = function(date) {
  return [0,6].indexOf((new Date(date)).getDay()) >= 0;
};

////////////////////////////////////////////////////////////////////////////////
// Implementation functions


Chronology.prototype.sealEvents = function() {
  if (!this.sealedEvents) {
    // sort events
    this.events.sort(
      function(a, b) {
        if (!a.date || !a.date.toGMTString) {
          this.warn("chronology: not a date ("+a.date+")");
        }
        if (!b.date || !b.date.toGMTString) {
          this.warn("chronology: not a date ("+b.date+")");
        }
        return a.date == b.date ? 0 :
          a.date < b.date ? -1 : 1; });

    // build eventByDate
    this.eventByDate = {};
    for (var i = 0; i < this.events.length; i++) {
      var event = this.events[i];

      // classify by date
      var dateStr = this.formatDate(event.date);
      if (!this.eventByDate[dateStr]) {
        this.eventByDate[dateStr] = [];
      }
      this.eventByDate[dateStr].push(event);
    }

    // sort inventories
    Object.keys(this.inventory).forEach(function(name) {
      this.inventory[name].sort(function(a, b) {
        return a.index == b.index ? 0 : a.index < b.index ? -1 : 1;
      });
    }, this);

    this.sealedEvents = true;
  }
};

////////////////////////////////////////////////////////////////////////////////

module.exports = Chronology;
