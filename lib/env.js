
var Q = require("kew");
var mc = require("mc");

function makeChecks() {
  if (!process.env.TEXTREE_GIT_DIR) {
    throw new Error("Variable TEXTREE_GIT_DIR is not set");
  }
}


// exports.repository = null;
// exports.tree = null;
var gitRepository;
var gitCommit, gitTree;
var gitDirPrefix = (process.env.TEXTREE_ROOT_DIR ? process.env.TEXTREE_ROOT_DIR + "/" : "") + "root/";
// var gitDirPrefix = process.env.TEXTREE_ROOT_DIR ? process.env.TEXTREE_ROOT_DIR + "/" : "";
var options;
var DEFAULT_OPTIONS = {
  enableGit: true
};

function loadGitTree() {

  var gitDir = process.env.TEXTREE_GIT_DIR || "/local.repository.git";
  var gitRef = process.env.TEXTREE_GIT_REF || "master";
  var headFile = process.env.TEXTREE_HEAD_FILE || "/var/lib/textree/HEAD";

  if (!gitDir) {
    throw new Error("environment variable TEXTREE_GIT_DIR is not defined");
  }
  var nodegit = require("nodegit");

  return Q.nfcall(require("fs").readFile, headFile, { encoding: "utf-8" })
    .then(
      function(data) {
        gitRef = (""+data).trim();
        return nodegit.Repository.open(gitDir);
      },
      function(err) {
        console.error("no data tree is defined as head files does not exist: "+headFile);
        return err;
      })
    .then(function(repos) {
      // console.error("Loaded GIT repository:", gitDir);
      gitRepository = repos;
      return gitRef.length == 40 ?
        repos.getCommit(gitRef) :
        repos.getBranch(gitRef);
    })
    .then(function(commit) {
      // console.error("Loaded GIT commit", gitRef, ":", commit.sha());
      gitCommit = commit;
      return commit.getTree();
    })
    .then(function(tree) {
      gitTree = tree;
    });

};

// must not begin with a slash '/'
exports.getPath = function(path) {
  return gitCommit.getEntry(gitDirPrefix + path);
  // return Q.nfcall(gitCommit.getEntry.bind(gitCommit), gitDirPrefix + path);
};

// // must not begin with a slash '/'
// exports.getPath = function(path) {
//   return exports.getGitPath(gitDirPrefix + path);
// };

// // must not begin with a slash '/'
// exports.getGitPath = function(path) {
//   console.log("-- getPath", path, gitTree);

//   function processRest(entry, relPath) {
//   console.log("---- processRest", relPath, entry);
//     if (!relPath) {
//       return entry;
//     } else {
//       var parts = relPath.split("/", 1);
//       parts.push(relPath.substr(parts[0].length + 1));
//       console.log(":::parts", parts, relPath, entry);

//       // console.log("get...", parts[0], "from", entry.path(),
//       // "--", entry.entryByName(parts[0]));
//       // return Q.nfcall(entry.entryByName.bind(entry), parts[0])
//       return Q.resolve(entry.entryByName(parts[0]))
//         .then(function(entry) {
//           console.log("ENTRY", entry.path(), entry.filemode(), parts[0]);

//           if (entry.isTree()) {
//             console.log("through::", entry.path(), parts[1]);
//             return processRest(entry, parts[1]);

//           } else if (entry.filemode() == 40960) {

//             return Q.nfcall(entry.getBlob.bind(entry))
//               .then(function(blob) {
//                 var target = blob.content().toString();
//                 console.log("symlink target:", target);
//                 var targetParts = target.split("/");
//                 if (targetParts[0] == "") {
//                   targetParts.shift();
//                 } else {
//                   var oPath = entry.path.split("/");
//                   oPath.pop();
//                   while (targetParts[0] == "..") {
//                     targetParts.shift();
//                     oPath.pop();
//                   }
//                   targetParts = oPath.concat(targetParts);
//                 }
//                 return processRest(gitTree, targetParts.join("/"));
//               });

//           } else {
//             if (parts[1]) {
//               console.error("getGitPath(\""+path+"\"): not a directory:", entry.path());
//             }
//             return entry;
//           }
//         });

//     }
//   }

//   return processRest(gitTree, path);

//   // return Q.nfcall(gitCommit.getEntry.bind(gitCommit), path)
//   //   .then(function(entry) {
//   //     console.log("ENTRY", entry.filemode(), entry);

//   //     if (entry.filemode() == 40960) {
//   //       return Q.nfcall(entry.getBlob.bind(entry))
//   //         .then(function(blob) {
//     //           var target = blob.content().toString();
//   //           console.log("symlink target:", target);
//   //           var targetParts = target.split("/");
//   //           if (targetParts[0] == "") {
//   //             targetParts.shift();
//   //           } else {
//   //             var oPath = path.split("/");
//   //             oPath.pop();
//   //             while (targetParts[0] == "..") {
//   //               targetParts.shift();
//   //               oPath.pop();
//   //             }
//   //             targetParts = oPath.concat(targetParts);
//   //           }
//   //           return exports.getGitPath(targetParts.join("/"));
//   //         });

//   //     } else {
//   //       return entry;
//   //     }
//   //   });
// };

exports.init = function(_options) {
  options = Object.assign({}, DEFAULT_OPTIONS, _options || {});

  return exports.refresh();
};

exports.refresh = function() {
  gitRepository = null;
  gitCommit = null;

  return options.enableGit ? loadGitTree() : Q.resolve();
};

exports.httpPort = process.env.TEXTREE_HTTP_PORT || 8080;

// // https://github.com/3rd-Eden/node-memcached
// // PROBLEMS WITH BLOBS
// var memcached = new Memcached('localhost:11211', {
//   // the time after which Memcached sends a connection timeout (in milliseconds).
//   timeout: 1000,
//   //  the number of socket allocation retries per request.
//   retries: 2,
//   // the idle timeout for the connections.
//   idle: 30000,
//   // whether to use md5 as hashing scheme when keys exceed maxKeySize
//   keyCompression: false,
// });

var memcached = new mc.Client('127.0.0.1:11211');

// function logMemCacheDetails(name, details){
//   console.log("memcached:", name, ":", JSON.stringify(details, null, 4));
// };
// memcached.on('issue', logMemCacheDetails.bind(null, "issue"));
// memcached.on('failure', logMemCacheDetails.bind(null, "failure"));
// memcached.on('reconnecting', logMemCacheDetails.bind(null, "reconnecting"));
// memcached.on('reconnected', logMemCacheDetails.bind(null, "reconnected"));
// memcached.on('remove', logMemCacheDetails.bind(null, "remove"));

exports.setCachedContent = function(key, buffer) {
  // console.log("ENV setCachedContent", key, buffer.length);
  var count = 0;
  function doSet() {
    count++;
    memcached.set(key, buffer, {flags:0,exptime:0}, function(err, status) {
      if (err) {
        if (count <= 5 && err && err.type == "CONNECTION_ERROR") {
          console.error("memcached: client not connected. Connecting...");
          memcached.connect(function() {
            console.log("memcached: connected to server");
            doSet();
          });
        } else {
          console.error("ENV setCachedContent error saving", buffer.length, "bytes into memcached under key: "+key, ":", JSON.stringify(err));
        }
      } else {
        console.log("ENV setCachedContent saved", buffer.length, "bytes into memcached under key: "+key);
      }
    });
  }

  doSet();
};
