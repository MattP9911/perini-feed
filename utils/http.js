const https = require('https');
const http  = require('http');

function fetchRaw(url, options, timeout) {
  options = options || {};
  timeout = timeout || 15000;
  return new Promise(function(resolve, reject) {
    var parsed  = new URL(url);
    var client  = parsed.protocol === 'https:' ? https : http;
    var reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  Object.assign({
        'User-Agent': 'PeriniCinema-FeedBot/2.0',
        'Accept':     'application/json'
      }, options.headers || {})
    };
    var req = client.request(reqOpts, function(res) {
      if ([301,302,303,307,308].indexOf(res.statusCode) !== -1 && res.headers.location) {
        var redirects = options._redirects || 0;
        if (redirects >= 5) return reject(new Error('Too many redirects'));
        var newOpts = Object.assign({}, options, { _redirects: redirects + 1 });
        return fetchRaw(res.headers.location, newOpts, timeout).then(resolve).catch(reject);
      }
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end',  function()  { resolve({ status: res.statusCode, body: data, headers: res.headers }); });
    });
    req.setTimeout(timeout, function() { req.destroy(); reject(new Error('Timeout: ' + url)); });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fetchJSON(url, options) {
  try {
    var result = await fetchRaw(url, options || {});
    if (result.status < 200 || result.status >= 300) throw new Error('HTTP ' + result.status);
    return JSON.parse(result.body);
  } catch(e) {
    return null;
  }
}

async function postForm(url, params, headers) {
  var body = new URLSearchParams(params).toString();
  return fetchJSON(url, {
    method: 'POST',
    headers: Object.assign({
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }, headers || {}),
    body: body
  });
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

module.exports = { fetchRaw: fetchRaw, fetchJSON: fetchJSON, postForm: postForm, sleep: sleep };
