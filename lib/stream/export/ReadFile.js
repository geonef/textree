/**
 ** Read a Git file specified by path and dump the content to stream output
 **/

// var stream = require('stream');
var util = require("util");
var Q = require("kew");
var minimatch = require("minimatch");
var request = require("request");

var env = require("../../env");
var NodeProcessor = require("../NodeProcessor");

/**
 */
function CatFile(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  NodeProcessor.call(this, options);

  this.fileStack = [];
}

util.inherits(CatFile, NodeProcessor);
module.exports = CatFile;

CatFile.prototype.tagCommandPrefix = "fs:";

CatFile.prototype.command_path = function(event) {
  var def = Q.defer();
  var path;

  // this.log("capturing text");
  this.captureFirstText()
    .then(function(_path) {
      path = _path;

      // this.log("capturing level");
      return this.captureLevelEvents(true, def);

    }.bind(this))
    .then(function() {
      // console.log("path", path);
      return this.dumpPath(path);

    }.bind(this))
    .then(
      function() {
        def.resolve();
      }.bind(this),
      function(error) {
        console.log("ERROR", error.message);
        this.sendEvent({type:"message", message: "error: "+error});
        this.sendEvent({type:"start", name: "fs:error", attributes: {message: ""+error}});
        this.sendEvent({type:"end"});
        def.resolve();
      }.bind(this)
    )

  // return this.captureLevelEvents(true, this.dumpPath(path));
  // .then(function() {
  // }.bind(this))
    .done();
};

CatFile.prototype.command_glob = function(event) {
  var def = Q.defer();
  var glob;

  // this.log("capturing text");
  this.captureFirstText()
    .then(function(_glob) {
      glob = _glob;

      return this.captureLevelEvents(true, def);

    }.bind(this))
    .then(function() {
      var _glob = glob;
      // console.log("glob", glob);
      if (_glob[0] != "/") {
        _glob = "/" + _glob;
      }
      var matches = /^((?:[^*?]*\/)*)(.*)$/.exec(_glob);
      var listPath = matches[1].replace(/^\/(.*)\//, "$1");
      // this.log("matches", matches);

      return this.listEntries(listPath);
    }.bind(this))
    .then(
      function(entries) {

        // console.log("entries glob:", glob, "raw:", entries, "filtered:",
        //             entries.filter(minimatch.filter(glob, {matchBase: false})));
        return entries
          .filter(minimatch.filter(glob, {matchBase: true}))
          .reduce(function(promise, entry) {
            // console.log("** entry", entry);
            return promise
              ? promise.then(this.dumpPath.bind(this, entry))
              : this.dumpPath(entry);
          }.bind(this), Q.resolve())
        ;
        // console.log("entries", entries);

        // entries.forEach(function(entry) {
        //   console.log("entry", entry);
        // });

        // if (entry.isTree()) {
        //   // entry.entries();
        //   this.warn("glob OK");
        // } else {
        //   this.warn("glob is not a directory: "+glob);
        // }

        // return this.dumpPath(glob);

      }.bind(this),
      function(error) {
        this.warn("glob not found: "+glob+" ("+error.message+")");
        // console.log("error", error);
      }.bind(this))
    .then(function() {
      def.resolve();

    }.bind(this))
    .done();
};

CatFile.prototype.listEntries = function(path) {
  // this.log("list path", path);
  if (path[0] == "/") {
    path = path.slice(1);
  }

  var paths = [];

  var processTree = function(path, tree) {
    var promises = [];
    tree.entries().forEach(function(entry) {
      var name = (path ? path + "/" : "") + entry.name();
      // console.log("pushing", name);
      if (entry.isTree()) {
        // throw new Error("not a directory: "+path);
        promises.push(
          entry.getTree()
            .then(processTree.bind(this, name)));
      } else {
        paths.push(name);
      }
    }, this);
    return Q.all(promises);
  };
  return env.getPath(path)
    .then(function(entry) {
      return entry.getTree();
    }).then(processTree.bind(this, path))
    .then(function() {
      return paths;
    });

  // return env.getPath(path).then(
  //   function(entry) {
  //     if (!entry.isTree()) {
  //       throw new Error("not a directory: "+path);
  //     }
  //     return entry.getTree().then(function(tree) {
  //       console.log("entry", path, "--", tree.entries());
  //     });
  //   }
  // );
  // path.split("/").reduce(function(entryP, part) {
  //   return entryP.then(function(entry) {
  //     return entry;
  //   });
  // }, env.getPath(""));
};

CatFile.prototype.dumpPath = function(path) {
  // console.log("dumping path", path);
  return env.getPath(path)
    .then(function(entry) {
      return entry.getBlob();
    }.bind(this))
    .then(
      function(blob) {
        // this.log("CatFile: entry", path);//entry.sha(), entry.path());
        // console.log("dumping", blob.content());
        // this.sendEvent({type: "comment", value: "dumping: "+path});
        this.sendEvent(blob.content());
        // this.log("CatFile: pushed content of: ", path, blob.content());
      }.bind(this),
      function(error) {
        // console.log("ERROR", error.message);
        this.sendEvent({type:"message", message: "error: "+error});
        this.sendEvent({type:"start", name: "fs:error", attributes: {message: ""+error+" (path: "+path+")"}});
        this.sendEvent({type:"end"});
      }.bind(this)
    );
};

CatFile.prototype.command_url = function(event) {
  var def = Q.defer();
  var options = Object.assign({
    headers: {
      "User-Agent": "Textree"
    }
  }, event.attributes.options);

  // this.log("capturing text");
  this.captureFirstText()
    .then(function(url) {
      options.url = url;

      return this.captureLevelEvents(true, def);

    }.bind(this))
    .then(function() {
      // console.log("url", options.url);
      request(options, function(error, content) {
        if (error) {
          // console.log("ERROR", JSON.stringify(error));
          this.sendEvent({type:"message", message: "error: "+error});
          this.sendEvent({type:"start", name: "url:error",
                          attributes: {message: ""+error+" (URL: "+options.url+")"} });
          this.sendEvent({type:"end"});
        } else {
          // console.log("content", content);
          this.sendEvent(content.body);
        }
        def.resolve();
      }.bind(this));

    }.bind(this))
    .done();
};
