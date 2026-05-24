/**
 * PeriniCinema – sources/pluto.js
 * ✅ LIVE — Pluto TV public catalog API (no auth required)
 * Endpoints discovered from api.pluto.tv public config
 */

const { fetchJSON, sleep } = require('../utils/http');
const log = require('../utils/logger');

const SOURCE     = 'PlutoTV';
const CATALOG    = 'https://service-vod.clusters.pluto.tv/v4/vod/categories';
const VOD_BASE   = 'https://service-vod.clusters.pluto.tv/v4/vod/slugs';
const CHANNELS   = 'https://api.pluto.tv/v2/channels';

const DEFAULT_PARAMS = 'appName=web&appVersion=na&clientID=na&clientModelNumber=na&serverSideAds=true&deviceMake=web&deviceModel=web&deviceType=web&deviceVersion=na';

// ── Helpers ──────────────────────────────────────────────────────────────────

function toItem(raw, overrideType = 'movie') {
  if (!raw) return null;

  const id    = raw._id || raw.id || raw.slug || '';
  const title = raw.name || raw.title || 'Untitled';

  // Pick best poster
  const poster = raw.coverImage?.path
    || raw.poster?.path
    || raw.thumbnail?.path
    || raw.featuredImage?.path
    || '';

  // Pick best stream — Pluto VOD uses a stitched HLS url
  const streamUrl = raw.stitched?.urls?.[0]?.url
    || raw.liveBroadcast?.url
    || '';

  if (!streamUrl || !id) return null;

  const desc = raw.description || raw.summary || '';
  const year = raw.firstAired ? new Date(raw.firstAired).getFullYear() : (raw.year || '');

  return {
    id:          `pluto_${id}`,
    source:      SOURCE,
    title,
    description: String(desc).substring(0, 300),
    posterUrl:   poster.startsWith('http') ? poster : `https://images.pluto.tv${poster}`,
    artworkUrl:  poster.startsWith('http') ? poster : `https://images.pluto.tv${poster}`,
    streamUrl,
    releaseDate: year ? `${year}-01-01` : '',
    rating:      raw.rating || 'NR',
    length:      raw.duration ? Math.floor(raw.duration / 1000) : 0,
    genre:       Array.isArray(raw.genre) ? raw.genre[0] : (raw.genre || raw.subGenre || ''),
    type:        overrideType
  };
}

// ── Fetch VOD categories ───────────────────────────────────────────────────

async function fetchVODCategories() {
  const url  = `${CATALOG}?${DEFAULT_PARAMS}&offset=0&limit=50`;
  const data = await fetchJSON(url);
  if (!data?.categories) { log.warn(SOURCE, 'No VOD categories returned'); return []; }
  return data.categories;
}

async function fetchCategoryItems(categoryID, limit = 15) {
  const url  = `${CATALOG}/${categoryID}/items?${DEFAULT_PARAMS}&offset=0&limit=${limit}`;
  const data = await fetchJSON(url);
  return data?.items || [];
}

// ── Fetch live channels (FAST) ────────────────────────────────────────────

async function fetchLiveChannels() {
  const url  = `${CHANNELS}?${DEFAULT_PARAMS}`;
  const data = await fetchJSON(url);
  return data || [];
}

// ── Public exports ────────────────────────────────────────────────────────────

async function fetchAll() {
  log.section('Pluto TV');

  const results = {
    featured:    [],
    trending:    [],
    newReleases: [],
    liveChannels: []
  };

  // Fetch VOD
  log.info(SOURCE, 'Fetching VOD categories...');
  const categories = await fetchVODCategories();
  log.info(SOURCE, `Found ${categories.length} categories`);

  for (const cat of categories.slice(0, 8)) {
    await sleep(250);
    const items   = await fetchCategoryItems(cat._id || cat.id, 15);
    const mapped  = items.map(i => toItem(i, 'movie')).filter(Boolean);

    const name = (cat.name || '').toLowerCase();
    if (name.includes('featured') || name.includes('popular')) {
      results.featured.push(...mapped);
    } else if (name.includes('new') || name.includes('recent')) {
      results.newReleases.push(...mapped);
    } else {
      results.trending.push(...mapped);
    }
    log.success(SOURCE, `Category "${cat.name}": ${mapped.length} items`);
  }

  // Fetch live channels
  log.info(SOURCE, 'Fetching live channels...');
  const channels = await fetchLiveChannels();
  if (Array.isArray(channels)) {
    results.liveChannels = channels
      .filter(ch => ch.isStitched && ch.stitched?.urls?.length)
      .map(ch => ({
        id:          `pluto_ch_${ch._id}`,
        source:      SOURCE,
        title:       ch.name || 'Unnamed Channel',
        description: ch.summary || ch.description || '',
        posterUrl:   ch.thumbnail?.path
                       ? `https://images.pluto.tv${ch.thumbnail.path}`
                       : '',
        artworkUrl:  ch.featuredImage?.path
                       ? `https://images.pluto.tv${ch.featuredImage.path}`
                       : '',
        streamUrl:   ch.stitched.urls[0].url,
        releaseDate: '',
        rating:      'NR',
        length:      0,
        genre:       ch.category || '',
        type:        'live'
      }))
      .slice(0, 30);
    log.success(SOURCE, `Live channels: ${results.liveChannels.length}`);
  }

  // Deduplicate
  results.featured    = dedupe(results.featured).slice(0, 12);
  results.trending    = dedupe(results.trending).slice(0, 12);
  results.newReleases = dedupe(results.newReleases).slice(0, 12);

  return results;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(i => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

module.exports = { fetchAll };
