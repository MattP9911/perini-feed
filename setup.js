/**
 * PeriniCinema – setup.js
 * Run this ONCE from inside your media-multifeed folder:
 *   node setup.js
 * It creates every subfolder and file automatically.
 */

const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;

function write(relPath, content) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trimStart());
  console.log('  ✅ created: ' + relPath);
}

console.log('\nPeriniCinema – Setup\n' + '─'.repeat(40));

// ── utils/http.js ─────────────────────────────────────────────────────────────
write('utils/http.js', `
const https = require('https');
const http  = require('http');

function fetchRaw(url, options = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const client  = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  { 'User-Agent': 'PeriniCinema-FeedBot/2.0', 'Accept': 'application/json', ...(options.headers || {}) }
    };
    const req = client.request(reqOpts, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        if ((options._redirects||0) >= 5) return reject(new Error('Too many redirects'));
        return fetchRaw(res.headers.location, {...options, _redirects:(options._redirects||0)+1}, timeout).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end',  () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fetchJSON(url, options = {}) {
  try {
    const { status, body } = await fetchRaw(url, options);
    if (status < 200 || status >= 300) throw new Error('HTTP ' + status);
    return JSON.parse(body);
  } catch { return null; }
}

async function postForm(url, params, headers = {}) {
  const body = new URLSearchParams(params).toString();
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers },
    body
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { fetchRaw, fetchJSON, postForm, sleep };
`);

// ── utils/logger.js ───────────────────────────────────────────────────────────
write('utils/logger.js', `
const R='\x1b[0m',B='\x1b[1m',G='\x1b[32m',Y='\x1b[33m',Re='\x1b[31m',C='\x1b[36m',D='\x1b[2m';
function ts(){ return new Date().toISOString().replace('T',' ').substring(0,19); }
const log = {
  info:    (t,m) => console.log(D+ts()+R+' '+C+'['+t+']'+R+' '+m),
  success: (t,m) => console.log(D+ts()+R+' '+G+'✅ ['+t+']'+R+' '+m),
  warn:    (t,m) => console.warn(D+ts()+R+' '+Y+'⚠  ['+t+']'+R+' '+m),
  error:   (t,m) => console.error(D+ts()+R+' '+Re+'❌ ['+t+']'+R+' '+m),
  section: (t)   => console.log('\n'+B+'─'.repeat(50)+'\n  '+t+'\n'+'─'.repeat(50)+R),
};
module.exports = log;
`);

// ── sources/archive.js ────────────────────────────────────────────────────────
write('sources/archive.js', `
const { fetchJSON, sleep } = require('../utils/http');
const log = require('../utils/logger');
const SOURCE = 'InternetArchive';
const BASE   = 'https://archive.org';

const QUERIES = {
  featured:    'mediatype:movies subject:"film noir" NOT subject:adult',
  trending:    'mediatype:movies subject:"classic films" NOT subject:adult',
  newReleases: 'mediatype:movies subject:"documentary" year:[2010 TO 2024] NOT subject:adult',
  action:      'mediatype:movies subject:"action" subject:"public domain" NOT subject:adult',
  comedy:      'mediatype:movies subject:"comedy" subject:"public domain" NOT subject:adult',
  scifi:       'mediatype:movies subject:"science fiction" subject:"public domain" NOT subject:adult',
  horror:      'mediatype:movies subject:"horror" subject:"public domain" NOT subject:adult',
  drama:       'mediatype:movies subject:"drama" subject:"public domain" NOT subject:adult',
};

async function searchArchive(query, rows = 12) {
  const fields = 'identifier,title,description,year,runtime,subject,downloads';
  const url = BASE+'/advancedsearch.php?q='+encodeURIComponent(query)+'&fl[]='+fields+'&sort[]=downloads+desc&rows='+rows+'&output=json';
  const data = await fetchJSON(url);
  return data?.response?.docs || [];
}

async function resolveStreamUrl(id) {
  const meta = await fetchJSON(BASE+'/metadata/'+id+'/files');
  if (!meta?.result) return null;
  const files = meta.result;
  const mp4 = files.find(f=>f.name?.endsWith('_512kb.mp4'))
            || files.find(f=>f.name?.endsWith('.mp4'))
            || files.find(f=>f.name?.endsWith('.ogv'));
  if (!mp4) return null;
  return BASE+'/download/'+id+'/'+encodeURIComponent(mp4.name);
}

function parseRuntime(raw) {
  if (!raw) return 0;
  const p = String(raw).split(':');
  if (p.length===3) return (+p[0])*3600+(+p[1])*60+(+p[2]);
  if (p.length===2) return (+p[0])*60+(+p[1]);
  return parseInt(raw)*60||0;
}

async function docToItem(doc) {
  const id = doc.identifier;
  const streamUrl = await resolveStreamUrl(id);
  if (!streamUrl) return null;
  const desc = Array.isArray(doc.description) ? doc.description[0] : (doc.description||'');
  return {
    id, source: SOURCE,
    title:       doc.title||'Untitled',
    description: desc.substring(0,300),
    posterUrl:   BASE+'/services/img/'+id,
    artworkUrl:  BASE+'/services/img/'+id,
    streamUrl,
    releaseDate: doc.year ? doc.year+'-01-01' : '',
    rating:      'NR',
    length:      parseRuntime(doc.runtime),
    genre:       Array.isArray(doc.subject) ? doc.subject[0] : (doc.subject||''),
    type:        'movie'
  };
}

async function processDocs(docs, n=4) {
  const out = [];
  for (let i=0;i<docs.length;i+=n) {
    const items = await Promise.all(docs.slice(i,i+n).map(docToItem));
    out.push(...items.filter(Boolean));
    if (i+n<docs.length) await sleep(300);
  }
  return out;
}

async function fetchAll() {
  log.section('Internet Archive');
  log.info(SOURCE,'Searching all categories...');
  const raw = await Promise.all(Object.entries(QUERIES).map(([k,q])=>searchArchive(q).then(d=>({k,d}))));
  const out = {};
  for (const {k,d} of raw) {
    out[k] = await processDocs(d);
    log.success(SOURCE, k+': '+out[k].length+' items');
  }
  return out;
}

module.exports = { fetchAll };
`);

// ── sources/pluto.js ──────────────────────────────────────────────────────────
write('sources/pluto.js', `
const { fetchJSON, sleep } = require('../utils/http');
const log = require('../utils/logger');
const SOURCE  = 'PlutoTV';
const CATALOG = 'https://service-vod.clusters.pluto.tv/v4/vod/categories';
const CHANNELS= 'https://api.pluto.tv/v2/channels';
const PARAMS  = 'appName=web&appVersion=na&clientID=na&clientModelNumber=na&serverSideAds=true&deviceMake=web&deviceModel=web&deviceType=web&deviceVersion=na';

function toItem(raw, type='movie') {
  if (!raw) return null;
  const id  = raw._id||raw.id||raw.slug||'';
  const poster = raw.coverImage?.path||raw.poster?.path||raw.thumbnail?.path||raw.featuredImage?.path||'';
  const streamUrl = raw.stitched?.urls?.[0]?.url||raw.liveBroadcast?.url||'';
  if (!streamUrl||!id) return null;
  const year = raw.firstAired ? new Date(raw.firstAired).getFullYear() : (raw.year||'');
  return {
    id: 'pluto_'+id, source: SOURCE,
    title:       raw.name||raw.title||'Untitled',
    description: String(raw.description||raw.summary||'').substring(0,300),
    posterUrl:   poster.startsWith('http') ? poster : 'https://images.pluto.tv'+poster,
    artworkUrl:  poster.startsWith('http') ? poster : 'https://images.pluto.tv'+poster,
    streamUrl,
    releaseDate: year ? year+'-01-01' : '',
    rating:      raw.rating||'NR',
    length:      raw.duration ? Math.floor(raw.duration/1000) : 0,
    genre:       Array.isArray(raw.genre) ? raw.genre[0] : (raw.genre||raw.subGenre||''),
    type
  };
}

function dedupe(items) {
  const seen=new Set();
  return items.filter(i=>{ if(seen.has(i.id)) return false; seen.add(i.id); return true; });
}

async function fetchAll() {
  log.section('Pluto TV');
  const results = { featured:[], trending:[], newReleases:[], liveChannels:[] };

  log.info(SOURCE,'Fetching VOD categories...');
  const catData = await fetchJSON(CATALOG+'?'+PARAMS+'&offset=0&limit=50');
  const cats = catData?.categories || [];
  log.info(SOURCE,'Found '+cats.length+' categories');

  for (const cat of cats.slice(0,8)) {
    await sleep(250);
    const url  = CATALOG+'/'+（cat._id||cat.id)+'/items?'+PARAMS+'&offset=0&limit=15';
    const data = await fetchJSON(url);
    const mapped = (data?.items||[]).map(i=>toItem(i,'movie')).filter(Boolean);
    const name = (cat.name||'').toLowerCase();
    if (name.includes('featured')||name.includes('popular')) results.featured.push(...mapped);
    else if (name.includes('new')||name.includes('recent')) results.newReleases.push(...mapped);
    else results.trending.push(...mapped);
    log.success(SOURCE,'Category "'+cat.name+'": '+mapped.length+' items');
  }

  log.info(SOURCE,'Fetching live channels...');
  const chData = await fetchJSON(CHANNELS+'?'+PARAMS);
  if (Array.isArray(chData)) {
    results.liveChannels = chData
      .filter(ch=>ch.isStitched&&ch.stitched?.urls?.length)
      .map(ch=>({
        id:          'pluto_ch_'+ch._id, source: SOURCE,
        title:       ch.name||'Unnamed Channel',
        description: ch.summary||ch.description||'',
        posterUrl:   ch.thumbnail?.path ? 'https://images.pluto.tv'+ch.thumbnail.path : '',
        artworkUrl:  ch.featuredImage?.path ? 'https://images.pluto.tv'+ch.featuredImage.path : '',
        streamUrl:   ch.stitched.urls[0].url,
        releaseDate: '', rating: 'NR', length: 0,
        genre:       ch.category||'', type: 'live'
      })).slice(0,30);
    log.success(SOURCE,'Live channels: '+results.liveChannels.length);
  }

  results.featured    = dedupe(results.featured).slice(0,12);
  results.trending    = dedupe(results.trending).slice(0,12);
  results.newReleases = dedupe(results.newReleases).slice(0,12);
  return results;
}

module.exports = { fetchAll };
`);

// ── sources/spotify.js ────────────────────────────────────────────────────────
write('sources/spotify.js', `
const { postForm, fetchJSON } = require('../utils/http');
const log = require('../utils/logger');
const SOURCE    = 'Spotify';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE  = 'https://api.spotify.com/v1';

const PODCAST_SHOWS = [
  '4gHaGsBaRFQ72fNNQa6gSm',
  '1OLcQdw2PFDPG1jo3zZHit',
  '6E1lMQUuHnYD5wLaLnPBDe',
  '5c26B28vZMq38qbBHiLsMm',
];

let _tokenCache = null;

async function getToken() {
  const id  = process.env.SPOTIFY_CLIENT_ID;
  const sec = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id||!sec) throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET required in .env');
  if (_tokenCache && Date.now() < _tokenCache.exp) return _tokenCache.token;
  const creds = Buffer.from(id+':'+sec).toString('base64');
  const data  = await postForm(TOKEN_URL, { grant_type:'client_credentials' }, { Authorization:'Basic '+creds });
  if (!data?.access_token) throw new Error('Failed to get Spotify token');
  _tokenCache = { token: data.access_token, exp: Date.now()+(data.expires_in-60)*1000 };
  log.success(SOURCE,'Token obtained');
  return _tokenCache.token;
}

async function spotifyGet(path) {
  const token = await getToken();
  return fetchJSON(API_BASE+path, { headers:{ Authorization:'Bearer '+token } });
}

function epToItem(ep, showName='') {
  if (!ep?.id) return null;
  return {
    id:          'spotify_ep_'+ep.id, source: SOURCE,
    title:       ep.name||'Untitled',
    description: (ep.description||'').replace(/<[^>]+>/g,'').substring(0,300),
    posterUrl:   ep.images?.[0]?.url||'',
    artworkUrl:  ep.images?.[0]?.url||'',
    streamUrl:   ep.audio_preview_url||'',
    deepLinkUrl: ep.external_urls?.spotify||'',
    releaseDate: ep.release_date||'',
    rating:      'NR',
    length:      ep.duration_ms ? Math.floor(ep.duration_ms/1000) : 0,
    genre:       'Podcast', show: showName, type: 'podcast', isPreview: true
  };
}

async function fetchAll() {
  log.section('Spotify Podcasts');
  if (!process.env.SPOTIFY_CLIENT_ID) {
    log.warn(SOURCE,'Skipped — add SPOTIFY_CLIENT_ID to .env');
    return { podcasts:[] };
  }
  try { await getToken(); } catch(e) { log.error(SOURCE,e.message); return { podcasts:[] }; }
  const results = [];
  for (const showId of PODCAST_SHOWS) {
    try {
      const data = await spotifyGet('/shows/'+showId+'/episodes?limit=3&market=US');
      const show = await spotifyGet('/shows/'+showId+'?market=US');
      const eps  = (data?.items||[]).map(ep=>epToItem(ep, show?.name||''));
      results.push(...eps.filter(Boolean));
      log.success(SOURCE,'Show '+showId+': '+eps.length+' episodes');
    } catch(e) { log.warn(SOURCE,'Show '+showId+' failed: '+e.message); }
  }
  const seen=new Set();
  const out=results.filter(i=>{ if(seen.has(i.id)) return false; seen.add(i.id); return true; });
  log.success(SOURCE,'Total podcasts: '+out.length);
  return { podcasts: out.slice(0,30) };
}

module.exports = { fetchAll };
`);

// ── sources/tubi.js ───────────────────────────────────────────────────────────
write('sources/tubi.js', `
const { fetchJSON } = require('../utils/http');
const log = require('../utils/logger');
const SOURCE = 'Tubi';

async function fetchAll() {
  log.section('Tubi');
  if (process.env.TUBI_ENABLED !== 'true') {
    log.warn(SOURCE,'Skipped — apply at https://partners.tubi.tv then set TUBI_ENABLED=true in .env');
    return { featured:[], trending:[], newReleases:[] };
  }
  // Full implementation activates once TUBI_API_KEY and TUBI_PARTNER_ID are set
  log.warn(SOURCE,'Credentials detected but full integration pending partner onboarding');
  return { featured:[], trending:[], newReleases:[] };
}

module.exports = { fetchAll };
`);

// ── sources/wurl.js ───────────────────────────────────────────────────────────
write('sources/wurl.js', `
const { fetchJSON } = require('../utils/http');
const log = require('../utils/logger');
const SOURCE = 'Wurl';

async function fetchAll() {
  log.section('Wurl');
  if (process.env.WURL_ENABLED !== 'true') {
    log.warn(SOURCE,'Skipped — apply at https://www.wurl.com/content-discovery then set WURL_ENABLED=true in .env');
    return { liveChannels:[], featured:[] };
  }
  log.warn(SOURCE,'Credentials detected but full integration pending partner onboarding');
  return { liveChannels:[], featured:[] };
}

module.exports = { fetchAll };
`);

// ── manual-picks.js ───────────────────────────────────────────────────────────
write('manual-picks.js', `
module.exports = [
  {
    id:'manual_night_living_dead', source:'Manual',
    title:'Night of the Living Dead',
    description:"George Romero's landmark 1968 horror film that defined the zombie genre.",
    posterUrl:'https://archive.org/services/img/night_of_the_living_dead',
    artworkUrl:'https://archive.org/services/img/night_of_the_living_dead',
    streamUrl:'https://archive.org/download/night_of_the_living_dead/night_of_the_living_dead_512kb.mp4',
    releaseDate:'1968-10-01', rating:'NR', length:5520, genre:'Horror', type:'movie'
  },
  {
    id:'manual_metropolis', source:'Manual',
    title:'Metropolis',
    description:"Fritz Lang's visionary 1927 science fiction epic set in a dystopian future city.",
    posterUrl:'https://archive.org/services/img/Metropolis_1927',
    artworkUrl:'https://archive.org/services/img/Metropolis_1927',
    streamUrl:'https://archive.org/download/Metropolis_1927/Metropolis_1927.mp4',
    releaseDate:'1927-01-10', rating:'NR', length:9360, genre:'Sci-Fi', type:'movie'
  },
  {
    id:'manual_city_lights', source:'Manual',
    title:'City Lights',
    description:"Charlie Chaplin's romantic comedy masterpiece.",
    posterUrl:'https://archive.org/services/img/city_lights',
    artworkUrl:'https://archive.org/services/img/city_lights',
    streamUrl:'https://archive.org/download/city_lights/city_lights.mp4',
    releaseDate:'1931-01-30', rating:'G', length:5100, genre:'Comedy', type:'movie'
  }
];
`);

// ── generate-feed.js ──────────────────────────────────────────────────────────
write('generate-feed.js', `
require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const log     = require('./utils/logger');
const archive = require('./sources/archive');
const pluto   = require('./sources/pluto');
const spotify = require('./sources/spotify');
const tubi    = require('./sources/tubi');
const wurl    = require('./sources/wurl');

const OUTPUT       = path.join(__dirname,'public','feed.json');
const MANUAL_PICKS = require('./manual-picks');

function parseCLI() {
  const args = process.argv.slice(2);
  const only = args.find(a=>a.startsWith('--only='))?.split('=')[1]?.split(',') || null;
  const skip = args.find(a=>a.startsWith('--skip='))?.split('=')[1]?.split(',') || [];
  return { only, skip };
}

function shouldRun(name, {only,skip}) {
  if (only) return only.includes(name);
  return !skip.includes(name);
}

function merge(a,b) {
  const seen=new Set(a.map(i=>i.id));
  return [...a,...b.filter(i=>!seen.has(i.id))];
}

function dedupe(arr) {
  const seen=new Set();
  return arr.filter(i=>{ if(seen.has(i.id)) return false; seen.add(i.id); return true; });
}

async function main() {
  const t0 = Date.now();
  const {only,skip} = parseCLI();
  log.section('PeriniCinema Multi-Source Feed Generator');

  fs.mkdirSync(path.dirname(OUTPUT), { recursive:true });

  const feed = {
    featured:MANUAL_PICKS.slice(), trending:[], newReleases:[],
    action:[], comedy:[], scifi:[], horror:[], drama:[],
    liveChannels:[], podcasts:[], myList:[]
  };
  const status = {};

  if (shouldRun('archive',{only,skip})) {
    try {
      const d = await archive.fetchAll();
      feed.featured     = merge(feed.featured,    d.featured    ||[]);
      feed.trending     = merge(feed.trending,    d.trending    ||[]);
      feed.newReleases  = merge(feed.newReleases, d.newReleases ||[]);
      feed.action       = merge(feed.action,      d.action      ||[]);
      feed.comedy       = merge(feed.comedy,      d.comedy      ||[]);
      feed.scifi        = merge(feed.scifi,       d.scifi       ||[]);
      feed.horror       = merge(feed.horror,      d.horror      ||[]);
      feed.drama        = merge(feed.drama,       d.drama       ||[]);
      status.archive = '✅ live';
    } catch(e) { log.error('MAIN','Archive: '+e.message); status.archive='❌ '+e.message; }
  } else { status.archive='⏭ skipped'; }

  if (shouldRun('pluto',{only,skip})) {
    try {
      const d = await pluto.fetchAll();
      feed.featured     = merge(feed.featured,     d.featured     ||[]);
      feed.trending     = merge(feed.trending,     d.trending     ||[]);
      feed.newReleases  = merge(feed.newReleases,  d.newReleases  ||[]);
      feed.liveChannels = merge(feed.liveChannels, d.liveChannels ||[]);
      status.pluto = '✅ live';
    } catch(e) { log.error('MAIN','Pluto: '+e.message); status.pluto='❌ '+e.message; }
  } else { status.pluto='⏭ skipped'; }

  if (shouldRun('spotify',{only,skip})) {
    try {
      const d = await spotify.fetchAll();
      feed.podcasts = merge(feed.podcasts, d.podcasts||[]);
      status.spotify = process.env.SPOTIFY_CLIENT_ID ? '✅ live' : '⏳ needs credentials';
    } catch(e) { log.error('MAIN','Spotify: '+e.message); status.spotify='❌ '+e.message; }
  } else { status.spotify='⏭ skipped'; }

  if (shouldRun('tubi',{only,skip})) {
    try { const d=await tubi.fetchAll(); feed.featured=merge(feed.featured,d.featured||[]); status.tubi='⏳ needs partnership'; }
    catch(e) { status.tubi='❌ '+e.message; }
  } else { status.tubi='⏭ skipped'; }

  if (shouldRun('wurl',{only,skip})) {
    try { const d=await wurl.fetchAll(); feed.liveChannels=merge(feed.liveChannels,d.liveChannels||[]); status.wurl='⏳ needs partnership'; }
    catch(e) { status.wurl='❌ '+e.message; }
  } else { status.wurl='⏭ skipped'; }

  const CAP = 20;
  for (const k of Object.keys(feed)) {
    if (Array.isArray(feed[k])) feed[k]=dedupe(feed[k]).slice(0,k==='liveChannels'?50:CAP);
  }

  const elapsed = ((Date.now()-t0)/1000).toFixed(1);
  feed._meta = {
    generatedAt: new Date().toISOString(),
    elapsedSec:  parseFloat(elapsed),
    totalItems:  Object.entries(feed).filter(([k])=>k!=='_meta').reduce((n,[,v])=>n+(Array.isArray(v)?v.length:0),0),
    sources:     status
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(feed,null,2));

  log.section('Summary');
  for (const [k,v] of Object.entries(feed)) {
    if (k!=='_meta' && Array.isArray(v)) console.log('  '+k.padEnd(14)+v.length);
  }
  console.log('');
  for (const [k,v] of Object.entries(status)) console.log('  '+k.padEnd(10)+v);
  log.success('MAIN','Done in '+elapsed+'s → '+OUTPUT);
}

main().catch(e=>{ console.error(e); process.exit(1); });
`);

// ── package.json ──────────────────────────────────────────────────────────────
write('package.json', JSON.stringify({
  name: 'perini-cinema-multifeed',
  version: '2.0.0',
  description: 'PeriniCinema – Multi-source feed generator',
  private: true,
  scripts: {
    generate:          'node generate-feed.js',
    'generate:archive':'node generate-feed.js --only=archive',
    'generate:pluto':  'node generate-feed.js --only=pluto',
    'generate:spotify':'node generate-feed.js --only=spotify',
    test:              'node test-feed.js',
    preview:           'npx serve public --listen 8080'
  },
  dependencies: { dotenv: '^16.4.5' },
  engines: { node: '>=18' }
}, null, 2));

// ── .env.example ──────────────────────────────────────────────────────────────
write('.env.example', `
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
TUBI_ENABLED=false
TUBI_API_KEY=
TUBI_PARTNER_ID=
WURL_ENABLED=false
WURL_API_KEY=
WURL_CHANNEL_IDS=
`);

// ── public/.gitkeep ───────────────────────────────────────────────────────────
write('public/.gitkeep', '');

// ── .gitignore ────────────────────────────────────────────────────────────────
write('.gitignore', `
node_modules/
public/feed.json
.env
.DS_Store
Thumbs.db
`);

console.log('\n' + '─'.repeat(40));
console.log('✅ Setup complete!\n');
console.log('Next steps:');
console.log('  1.  npm install');
console.log('  2.  Copy .env.example to .env and add your Spotify keys');
console.log('  3.  node generate-feed.js\n');
