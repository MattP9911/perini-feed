var http = require('../utils/http');
var log  = require('../utils/logger');

var SOURCE  = 'PlutoTV';
var CATALOG = 'https://service-vod.clusters.pluto.tv/v4/vod/categories';
var CHANNELS = 'https://api.pluto.tv/v2/channels';
var PARAMS  = 'appName=web&appVersion=na&clientID=na&clientModelNumber=na&serverSideAds=true&deviceMake=web&deviceModel=web&deviceType=web&deviceVersion=na';

function getPath(obj) {
  if (!obj) return '';
  return obj.path || '';
}

function toItem(raw, type) {
  type = type || 'movie';
  if (!raw) return null;
  var id = raw._id || raw.id || raw.slug || '';
  var posterPath = getPath(raw.coverImage) || getPath(raw.poster) || getPath(raw.thumbnail) || getPath(raw.featuredImage);
  var streamUrl = '';
  if (raw.stitched && raw.stitched.urls && raw.stitched.urls.length > 0) {
    streamUrl = raw.stitched.urls[0].url || '';
  }
  if (!streamUrl && raw.liveBroadcast) {
    streamUrl = raw.liveBroadcast.url || '';
  }
  if (!streamUrl || !id) return null;
  var posterFull = posterPath.indexOf('http') === 0 ? posterPath : 'https://images.pluto.tv' + posterPath;
  var year = '';
  if (raw.firstAired) {
    year = new Date(raw.firstAired).getFullYear();
  } else if (raw.year) {
    year = raw.year;
  }
  var genre = '';
  if (Array.isArray(raw.genre) && raw.genre.length > 0) {
    genre = raw.genre[0];
  } else if (raw.genre) {
    genre = raw.genre;
  } else if (raw.subGenre) {
    genre = raw.subGenre;
  }
  return {
    id:          'pluto_' + id,
    source:      SOURCE,
    title:       raw.name || raw.title || 'Untitled',
    description: String(raw.description || raw.summary || '').substring(0, 300),
    posterUrl:   posterFull,
    artworkUrl:  posterFull,
    streamUrl:   streamUrl,
    releaseDate: year ? year + '-01-01' : '',
    rating:      raw.rating || 'NR',
    length:      raw.duration ? Math.floor(raw.duration / 1000) : 0,
    genre:       genre,
    type:        type
  };
}

function dedupe(items) {
  var seen = {};
  return items.filter(function(i) {
    if (seen[i.id]) return false;
    seen[i.id] = true;
    return true;
  });
}

async function fetchAll() {
  log.section('Pluto TV');
  var results = { featured: [], trending: [], newReleases: [], liveChannels: [] };

  log.info(SOURCE, 'Fetching VOD categories...');
  var catUrl  = CATALOG + '?' + PARAMS + '&offset=0&limit=50';
  var catData = await http.fetchJSON(catUrl);
  var cats = (catData && catData.categories) ? catData.categories : [];
  log.info(SOURCE, 'Found ' + cats.length + ' categories');

  var limit = Math.min(cats.length, 8);
  for (var i = 0; i < limit; i++) {
    var cat   = cats[i];
    var catId = cat._id || cat.id;
    await http.sleep(250);
    var itemUrl  = CATALOG + '/' + catId + '/items?' + PARAMS + '&offset=0&limit=15';
    var itemData = await http.fetchJSON(itemUrl);
    var items    = (itemData && itemData.items) ? itemData.items : [];
    var mapped   = [];
    for (var j = 0; j < items.length; j++) {
      var item = toItem(items[j], 'movie');
      if (item) mapped.push(item);
    }
    var name = (cat.name || '').toLowerCase();
    if (name.indexOf('featured') !== -1 || name.indexOf('popular') !== -1) {
      results.featured = results.featured.concat(mapped);
    } else if (name.indexOf('new') !== -1 || name.indexOf('recent') !== -1) {
      results.newReleases = results.newReleases.concat(mapped);
    } else {
      results.trending = results.trending.concat(mapped);
    }
    log.success(SOURCE, 'Category "' + cat.name + '": ' + mapped.length + ' items');
  }

  log.info(SOURCE, 'Fetching live channels...');
  var chUrl  = CHANNELS + '?' + PARAMS;
  var chData = await http.fetchJSON(chUrl);
  if (Array.isArray(chData)) {
    for (var i = 0; i < chData.length; i++) {
      var ch = chData[i];
      if (!ch.isStitched || !ch.stitched || !ch.stitched.urls || ch.stitched.urls.length === 0) continue;
      var thumbPath = (ch.thumbnail && ch.thumbnail.path) ? 'https://images.pluto.tv' + ch.thumbnail.path : '';
      var featPath  = (ch.featuredImage && ch.featuredImage.path) ? 'https://images.pluto.tv' + ch.featuredImage.path : '';
      results.liveChannels.push({
        id:          'pluto_ch_' + ch._id,
        source:      SOURCE,
        title:       ch.name || 'Unnamed Channel',
        description: ch.summary || ch.description || '',
        posterUrl:   thumbPath,
        artworkUrl:  featPath,
        streamUrl:   ch.stitched.urls[0].url,
        releaseDate: '',
        rating:      'NR',
        length:      0,
        genre:       ch.category || '',
        type:        'live'
      });
      if (results.liveChannels.length >= 30) break;
    }
    log.success(SOURCE, 'Live channels: ' + results.liveChannels.length);
  }

  results.featured    = dedupe(results.featured).slice(0, 12);
  results.trending    = dedupe(results.trending).slice(0, 12);
  results.newReleases = dedupe(results.newReleases).slice(0, 12);
  return results;
}

module.exports = { fetchAll: fetchAll };
