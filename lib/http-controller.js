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
  var postParams;

  if (parts[1]) {
    promise = promise.then(function() {
      return processQuery(parts[1], request, response);
    });
  }

  if (request.method == 'POST') {
    promise = promise.then(function() {
      var promise2 = Q.defer();
      var body = '';

      request.on('data', function (data) {
        body += data;

        // Too much POST data, kill the connection!
        // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
        if (body.length > 1e6)
          request.connection.destroy();
      });

      request.on('end', function () {
        postParams = querystring.parse(body);
        promise2.resolve();
      });

      return promise2;
    });
  }

  promise
    .then(function() {

      path = decodeURI(parts[0].slice(1));
      var query = parts.length >= 2 ? querystring.parse(parts[1]) : {};
      console.log("REQUEST "+request.method+" url=\""+request.url+"\" path=\""+path+"\" qs="+JSON.stringify(query)+"");

      var routePath = new RoutePath(path);
      var requestParams = {
        path: routePath,
        query: query,
        headers: request.headers
      };
      if (postParams) {
        requestParams.post = postParams;
      }

      proc = new ProcessNodes({globalContext: {
        REQUEST: requestParams
      }});
      return routePath.stream();
    })
    .then(function(routeStream) {


      var extBasePath = request.headers["ext-base-path"] || "/";
      var writeHttpResponse = new WriteHttpResponse(response, {
        contentCacheKey: extBasePath + path + "?" + (parts[1] || "")
      });

      routeStream
        .pipe(proc)
        .pipe(writeHttpResponse);

    })
    .done();

}

exports.process = processRequest;
