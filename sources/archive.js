var http = require('../utils/http');
var log  = require('../utils/logger');

var SOURCE = 'InternetArchive';
var BASE   = 'https://archive.org';

var QUERIES = {
  featured:    'mediatype:movies subject:"film noir" NOT subject:adult',
  trending:    'mediatype:movies subject:"classic films" NOT subject:adult',
  newReleases: 'mediatype:movies subject:"documentary" year:[2010 TO 2024] NOT subject:adult',
  action:      'mediatype:movies subject:"action" subject:"public domain" NOT subject:adult',
  comedy:      'mediatype:movies subject:"comedy" subject:"public domain" NOT subject:adult',
  scifi:       'mediatype:movies subject:"science fiction" subject:"public domain" NOT subject:adult',
  horror:      'mediatype:movies subject:"horror" subject:"public domain" NOT subject:adult',
  drama:       'mediatype:movies subject:"drama" subject:"public domain" NOT subject:adult'
};

async function searchArchive(query, rows) {
  rows = rows || 12;
  var fields = 'identifier,title,description,year,runtime,subject,downloads';
  var url = BASE + '/advancedsearch.php?q=' + encodeURIComponent(query) +
            '&fl[]=' + fields + '&sort[]=downloads+desc&rows=' + rows + '&output=json';
  var data = await http.fetchJSON(url);
  return (data && data.response && data.response.docs) ? data.response.docs : [];
}

async function resolveStreamUrl(id) {
  var meta = await http.fetchJSON(BASE + '/metadata/' + id + '/files');
  if (!meta || !meta.result) return null;
  var files = meta.result;
  var mp4 = null;
  for (var i = 0; i < files.length; i++) {
    if (files[i].name && files[i].name.indexOf('_512kb.mp4') !== -1) { mp4 = files[i]; break; }
  }
  if (!mp4) {
    for (var i = 0; i < files.length; i++) {
      if (files[i].name && files[i].name.indexOf('.mp4') !== -1) { mp4 = files[i]; break; }
    }
  }
  if (!mp4) {
    for (var i = 0; i < files.length; i++) {
      if (files[i].name && files[i].name.indexOf('.ogv') !== -1) { mp4 = files[i]; break; }
    }
  }
  if (!mp4) return null;
  return BASE + '/download/' + id + '/' + encodeURIComponent(mp4.name);
}

function parseRuntime(raw) {
  if (!raw) return 0;
  var s = String(raw);
  var p = s.split(':');
  if (p.length === 3) return Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2]);
  if (p.length === 2) return Number(p[0]) * 60 + Number(p[1]);
  return parseInt(s) * 60 || 0;
}

async function docToItem(doc) {
  var id = doc.identifier;
  var streamUrl = await resolveStreamUrl(id);
  if (!streamUrl) return null;
  var desc = Array.isArray(doc.description) ? doc.description[0] : (doc.description || '');
  return {
    id:          id,
    source:      SOURCE,
    title:       doc.title || 'Untitled',
    description: desc.substring(0, 300),
    posterUrl:   BASE + '/services/img/' + id,
    artworkUrl:  BASE + '/services/img/' + id,
    streamUrl:   streamUrl,
    releaseDate: doc.year ? doc.year + '-01-01' : '',
    rating:      'NR',
    length:      parseRuntime(doc.runtime),
    genre:       Array.isArray(doc.subject) ? doc.subject[0] : (doc.subject || ''),
    type:        'movie'
  };
}

async function processDocs(docs, n) {
  n = n || 4;
  var out = [];
  for (var i = 0; i < docs.length; i += n) {
    var batch = docs.slice(i, i + n);
    var items = await Promise.all(batch.map(docToItem));
    for (var j = 0; j < items.length; j++) {
      if (items[j]) out.push(items[j]);
    }
    if (i + n < docs.length) await http.sleep(300);
  }
  return out;
}

async function fetchAll() {
  log.section('Internet Archive');
  log.info(SOURCE, 'Searching all categories...');
  var keys = Object.keys(QUERIES);
  var searches = keys.map(function(k) {
    return searchArchive(QUERIES[k]).then(function(d) { return { k: k, d: d }; });
  });
  var raw = await Promise.all(searches);
  var out = {};
  for (var i = 0; i < raw.length; i++) {
    var k = raw[i].k;
    out[k] = await processDocs(raw[i].d);
    log.success(SOURCE, k + ': ' + out[k].length + ' items');
  }
  return out;
}

module.exports = { fetchAll: fetchAll };
