var http = require('../utils/http');
var log  = require('../utils/logger');

var SOURCE    = 'Spotify';
var TOKEN_URL = 'https://accounts.spotify.com/api/token';
var API_BASE  = 'https://api.spotify.com/v1';

var PODCAST_SHOWS = [
  '4gHaGsBaRFQ72fNNQa6gSm',
  '1OLcQdw2PFDPG1jo3zZHit',
  '6E1lMQUuHnYD5wLaLnPBDe',
  '5c26B28vZMq38qbBHiLsMm'
];

var tokenCache = null;

async function getToken() {
  var id  = process.env.SPOTIFY_CLIENT_ID;
  var sec = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !sec) throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET required in .env');
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token;
  var creds = Buffer.from(id + ':' + sec).toString('base64');
  var data  = await http.postForm(TOKEN_URL, { grant_type: 'client_credentials' }, { Authorization: 'Basic ' + creds });
  if (!data || !data.access_token) throw new Error('Failed to get Spotify token');
  tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  log.success(SOURCE, 'Token obtained');
  return tokenCache.token;
}

async function spotifyGet(path) {
  var token = await getToken();
  return http.fetchJSON(API_BASE + path, { headers: { Authorization: 'Bearer ' + token } });
}

function epToItem(ep, showName) {
  showName = showName || '';
  if (!ep || !ep.id) return null;
  var desc = (ep.description || '').replace(/<[^>]+>/g, '').substring(0, 300);
  var poster = (ep.images && ep.images[0]) ? ep.images[0].url : '';
  return {
    id:          'spotify_ep_' + ep.id,
    source:      SOURCE,
    title:       ep.name || 'Untitled',
    description: desc,
    posterUrl:   poster,
    artworkUrl:  poster,
    streamUrl:   ep.audio_preview_url || '',
    deepLinkUrl: (ep.external_urls && ep.external_urls.spotify) ? ep.external_urls.spotify : '',
    releaseDate: ep.release_date || '',
    rating:      'NR',
    length:      ep.duration_ms ? Math.floor(ep.duration_ms / 1000) : 0,
    genre:       'Podcast',
    show:        showName,
    type:        'podcast',
    isPreview:   true
  };
}

async function fetchAll() {
  log.section('Spotify Podcasts');
  if (!process.env.SPOTIFY_CLIENT_ID) {
    log.warn(SOURCE, 'Skipped -- add SPOTIFY_CLIENT_ID to .env to enable');
    return { podcasts: [] };
  }
  try { await getToken(); } catch(e) { log.error(SOURCE, e.message); return { podcasts: [] }; }

  var results = [];
  for (var i = 0; i < PODCAST_SHOWS.length; i++) {
    var showId = PODCAST_SHOWS[i];
    try {
      var data = await spotifyGet('/shows/' + showId + '/episodes?limit=3&market=US');
      var show = await spotifyGet('/shows/' + showId + '?market=US');
      var showName = (show && show.name) ? show.name : '';
      var items = (data && data.items) ? data.items : [];
      for (var j = 0; j < items.length; j++) {
        var item = epToItem(items[j], showName);
        if (item) results.push(item);
      }
      log.success(SOURCE, 'Show ' + showId + ': ' + items.length + ' episodes');
    } catch(e) {
      log.warn(SOURCE, 'Show ' + showId + ' failed: ' + e.message);
    }
  }

  var seen = {};
  var out  = results.filter(function(i) {
    if (seen[i.id]) return false;
    seen[i.id] = true;
    return true;
  });
  log.success(SOURCE, 'Total podcasts: ' + out.length);
  return { podcasts: out.slice(0, 30) };
}

module.exports = { fetchAll: fetchAll };
