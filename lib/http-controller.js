/**
 * Implement Textree as traditional NodeJS HTTP request/reponse middleware
 *
 * Usage example:
 * var controller = require("lib/http-controller");
 *
 * var server = http.createServer(controller.process);
 * server.listen(env.httpPort);
 */

var Q = require("kew");
const querystring = require('querystring');

var env = require("./env");

var WriteHttpResponse = require("./stream/WriteHttpResponse");
var RoutePath = require("./stream/RoutePath");
var ProcessNodes = require("./stream/export/ProcessNodes.js");

function processQuery(qs, request, response) {
  var ret;

  if (qs == "refresh") {
    ret = env.refresh();
  }

  return ret || Q.resolve();
}

function processRequest(request, response) {
  var parts = request.url.split("?", 2);
  var promise = Q.resolve();
  var proc;
  var path;

  if (parts[1]) {
    promise = promise.then(function() {
      return processQuery(parts[1], request, response);
    });
  }

  promise
    .then(function() {

      path = parts[0].slice(1);
      var query = parts.length >= 2 ? querystring.parse(parts[1]) : {};
      console.log("REQUEST url=\""+request.url+"\" path=\""+path+"\" qs="+JSON.stringify(query)+"");

      var routePath = new RoutePath(path);

      proc = new ProcessNodes({globalContext: {
        REQUEST: {
          path: routePath,
          query: query,
          headers: request.headers
        }
      }});
      return routePath.stream();
    })
    .then(function(routeStream) {


      var extBasePath = request.headers["ext-base-path"] || "/";
      var writeHttpResponse = new WriteHttpResponse(response, {
        contentCacheKey: extBasePath + path
      });

      routeStream
        .pipe(proc)
        .pipe(writeHttpResponse);

    })
    .done();

}

exports.process = processRequest;
