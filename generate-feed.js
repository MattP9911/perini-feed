require('dotenv').config();

var fs      = require('fs');
var path    = require('path');
var log     = require('./utils/logger');
var archive = require('./sources/archive');
var pluto   = require('./sources/pluto');
var spotify = require('./sources/spotify');
var tubi    = require('./sources/tubi');
var wurl    = require('./sources/wurl');

var OUTPUT       = path.join(__dirname, 'public', 'feed.json');
var MANUAL_PICKS = require('./manual-picks');

function parseCLI() {
  var args = process.argv.slice(2);
  var onlyArg = args.find(function(a) { return a.indexOf('--only=') === 0; });
  var skipArg = args.find(function(a) { return a.indexOf('--skip=') === 0; });
  var only = onlyArg ? onlyArg.split('=')[1].split(',') : null;
  var skip = skipArg ? skipArg.split('=')[1].split(',') : [];
  return { only: only, skip: skip };
}

function shouldRun(name, opts) {
  if (opts.only) return opts.only.indexOf(name) !== -1;
  return opts.skip.indexOf(name) === -1;
}

function merge(a, b) {
  var seen = {};
  a.forEach(function(i) { seen[i.id] = true; });
  return a.concat(b.filter(function(i) { return !seen[i.id]; }));
}

function dedupe(arr) {
  var seen = {};
  return arr.filter(function(i) {
    if (seen[i.id]) return false;
    seen[i.id] = true;
    return true;
  });
}

function cap(arr, n) {
  return dedupe(arr).slice(0, n);
}

async function main() {
  var t0   = Date.now();
  var opts = parseCLI();
  log.section('PeriniCinema Multi-Source Feed Generator');

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

  var feed = {
    featured:     MANUAL_PICKS.slice(),
    trending:     [],
    newReleases:  [],
    action:       [],
    comedy:       [],
    scifi:        [],
    horror:       [],
    drama:        [],
    liveChannels: [],
    podcasts:     [],
    myList:       []
  };
  var status = {};

  if (shouldRun('archive', opts)) {
    try {
      var d = await archive.fetchAll();
      feed.featured    = merge(feed.featured,    d.featured    || []);
      feed.trending    = merge(feed.trending,    d.trending    || []);
      feed.newReleases = merge(feed.newReleases, d.newReleases || []);
      feed.action      = merge(feed.action,      d.action      || []);
      feed.comedy      = merge(feed.comedy,      d.comedy      || []);
      feed.scifi       = merge(feed.scifi,       d.scifi       || []);
      feed.horror      = merge(feed.horror,      d.horror      || []);
      feed.drama       = merge(feed.drama,       d.drama       || []);
      status.archive   = 'live';
    } catch(e) { log.error('MAIN', 'Archive: ' + e.message); status.archive = 'ERROR: ' + e.message; }
  } else { status.archive = 'skipped'; }

  if (shouldRun('pluto', opts)) {
    try {
      var d = await pluto.fetchAll();
      feed.featured     = merge(feed.featured,     d.featured     || []);
      feed.trending     = merge(feed.trending,     d.trending     || []);
      feed.newReleases  = merge(feed.newReleases,  d.newReleases  || []);
      feed.liveChannels = merge(feed.liveChannels, d.liveChannels || []);
      status.pluto      = 'live';
    } catch(e) { log.error('MAIN', 'Pluto: ' + e.message); status.pluto = 'ERROR: ' + e.message; }
  } else { status.pluto = 'skipped'; }

  if (shouldRun('spotify', opts)) {
    try {
      var d = await spotify.fetchAll();
      feed.podcasts  = merge(feed.podcasts, d.podcasts || []);
      status.spotify = process.env.SPOTIFY_CLIENT_ID ? 'live' : 'needs credentials';
    } catch(e) { log.error('MAIN', 'Spotify: ' + e.message); status.spotify = 'ERROR: ' + e.message; }
  } else { status.spotify = 'skipped'; }

  if (shouldRun('tubi', opts)) {
    try {
      var d = await tubi.fetchAll();
      feed.featured = merge(feed.featured, d.featured || []);
      status.tubi   = 'needs partnership';
    } catch(e) { status.tubi = 'ERROR: ' + e.message; }
  } else { status.tubi = 'skipped'; }

  if (shouldRun('wurl', opts)) {
    try {
      var d = await wurl.fetchAll();
      feed.liveChannels = merge(feed.liveChannels, d.liveChannels || []);
      status.wurl       = 'needs partnership';
    } catch(e) { status.wurl = 'ERROR: ' + e.message; }
  } else { status.wurl = 'skipped'; }

  var CAP = 20;
  var keys = Object.keys(feed);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (Array.isArray(feed[k])) {
      feed[k] = cap(feed[k], k === 'liveChannels' ? 50 : CAP);
    }
  }

  var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  var totalItems = 0;
  var fkeys = Object.keys(feed);
  for (var i = 0; i < fkeys.length; i++) {
    if (Array.isArray(feed[fkeys[i]])) totalItems += feed[fkeys[i]].length;
  }

  feed._meta = {
    generatedAt: new Date().toISOString(),
    elapsedSec:  parseFloat(elapsed),
    totalItems:  totalItems,
    sources:     status
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(feed, null, 2));

  log.section('Summary');
  var skeys = Object.keys(feed);
  for (var i = 0; i < skeys.length; i++) {
    var k = skeys[i];
    if (k !== '_meta' && Array.isArray(feed[k])) {
      console.log('  ' + (k + '              ').substring(0, 14) + feed[k].length);
    }
  }
  console.log('');
  var stkeys = Object.keys(status);
  for (var i = 0; i < stkeys.length; i++) {
    console.log('  ' + (stkeys[i] + '          ').substring(0, 10) + status[stkeys[i]]);
  }
  log.success('MAIN', 'Done in ' + elapsed + 's -- ' + OUTPUT);
}

main().catch(function(e) { console.error(e); process.exit(1); });
