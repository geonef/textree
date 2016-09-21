
// var http = require("http");
var request = require("request");
var Q = require("kew");
var GenerateChars = require("./stream/export/GenerateChars");
var RoutePath = require("./stream/RoutePath");

function GlobalEnvironment(properties)
{
  Object.keys(properties).forEach(function(prop) {
    this[prop] = properties[prop];
  }, this);
}

module.exports = GlobalEnvironment;

GlobalEnvironment.prototype = {

  testValue: "the value",

  testStream: function() {
    // new RoutePath()
    // return new GenerateChars();
    var def = Q.defer();
    setTimeout(function() {
      // console.log("???????");
      def.resolve(new GenerateChars());
    }, 1000);
    return def;
  },

  asyncStr: function(str) {
    // new RoutePath()
    // return new GenerateChars();
    var def = Q.defer();
    setTimeout(function() {
      def.resolve(str);
    }, 1000);
    return def;
  },

  url: function(path, root, extension) {
    if (!/^[a-z0-9]+:/.test(path)) {
      if (!(new RegExp(extension.replace(/\./, "\.")+"$")).test(path)) {
        path += extension;
      }
      if (path[0] != "/") {
        path = root + "/" + path;
      }
    }
    return path;
  },

  requestHttpText: function(url) {
    var def = Q.defer();

    request({url: url,  headers: {
      "User-Agent": "Textree"
    }}, function(error, response) {
      // console.log("!!!!!!!!!! resp", error, response.body);
      if (error) {
        def.reject(error);
      } else {
        def.resolve(response.body);
      }
    });
    // // options = { hostname: "www.geonef.fr", path: "/", method: "GET", port: 80 };
    // var client = http.request(options, function(response) {
    //   var text = "";

    //   function addChunk(chunk) {
    //     // console.log("http data", chunk);
    //     text += chunk.toString();
    //   }

    //   response.on("data", addChunk);

    //   response.on("end", function(chunk) {
    //     if (chunk) { addChunk(chunk); }
    //     // console.log("http end", text);
    //     def.resolve(text);
    //   });

    //   response.on("error", function(error) {
    //     console.log("http error", error);
    //     def.reject(error);
    //   });

    // });

    // client.end();
    // console.log("returning", def);

    return def;
  },

  requestHttpJson: function(url) {
    return GlobalEnvironment.prototype.requestHttpText(url)
      .then(function(text) {
        // try {
        return JSON.parse(text);
        // }
        // catch (error) {
        //   // console.log("json error", error);
        //   def.reject(error);
        // }
      });
  }
};
