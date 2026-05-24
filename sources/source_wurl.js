/**
 * PeriniCinema – sources/wurl.js
 * ⏳ PARTNERSHIP REQUIRED — Wurl FAST Content Distribution API
 *
 * Status: Ready to activate. Requires a signed distribution agreement with Wurl.
 *
 * HOW TO ACTIVATE:
 * 1. Apply at: https://www.wurl.com/content-discovery
 * 2. Sign a revenue-share distribution agreement
 * 3. Wurl provides: API endpoint, API key, and channel IDs
 * 4. Add to .env:
 *      WURL_API_KEY=your_key_here
 *      WURL_CHANNEL_IDS=ch_001,ch_002,ch_003
 * 5. Set WURL_ENABLED=true in .env
 *
 * What you get once approved:
 * - Pre-packaged FAST (Free Ad-Supported Streaming TV) channel content
 * - Linear channel schedules (EPG data)
 * - VOD content libraries from major content owners
 * - HLS stream URLs with SSAI (server-side ad insertion)
 * - Revenue share from ad impressions
 */

const { fetchJSON } = require('../utils/http');
const log = require('../utils/logger');

const SOURCE   = 'Wurl';
const API_BASE = 'https://api.wurl.com/v1'; // confirmed base — real endpoints provided at onboarding

// ── Item normaliser ───────────────────────────────────────────────────────────

function channelToItem(raw) {
  if (!raw?.id) return null;
  return {
    id:          `wurl_${raw.id}`,
    source:      SOURCE,
    title:       raw.title || raw.name || 'Unnamed Channel',
    description: (raw.description || raw.summary || '').substring(0, 300),
    posterUrl:   raw.thumbnail || raw.logo || '',
    artworkUrl:  raw.heroImage || raw.banner || raw.thumbnail || '',
    streamUrl:   raw.streamUrl || raw.playbackUrl || raw.hlsUrl || '',
    releaseDate: '',
    rating:      raw.rating || 'NR',
    length:      0,
    genre:       raw.genre || raw.category || '',
    type:        'live'
  };
}

function vodToItem(raw) {
  if (!raw?.id) return null;
  return {
    id:          `wurl_vod_${raw.id}`,
    source:      SOURCE,
    title:       raw.title || 'Untitled',
    description: (raw.description || '').substring(0, 300),
    posterUrl:   raw.artwork?.thumbnail || raw.thumbnail || '',
    artworkUrl:  raw.artwork?.hero || raw.artwork?.thumbnail || '',
    streamUrl:   raw.hlsUrl || raw.streamUrl || '',
    releaseDate: raw.releaseDate || '',
    rating:      raw.rating || 'NR',
    length:      raw.duration || 0,
    genre:       raw.genre || '',
    type:        raw.contentType === 'episode' ? 'series' : 'movie'
  };
}

// ── API calls ────────────────────────────────────────────────────────────────

async function fetchChannels() {
  const key      = process.env.WURL_API_KEY;
  const channels = (process.env.WURL_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!channels.length) return [];

  const results = [];
  for (const chId of channels) {
    const data = await fetchJSON(`${API_BASE}/channels/${chId}`, {
      headers: { 'X-API-Key': key }
    });
    if (data) results.push(data);
  }
  return results;
}

async function fetchVODLibrary(limit = 20) {
  const key  = process.env.WURL_API_KEY;
  const data = await fetchJSON(`${API_BASE}/content?limit=${limit}&type=vod`, {
    headers: { 'X-API-Key': key }
  });
  return data?.items || [];
}

// ── Public exports ────────────────────────────────────────────────────────────

async function fetchAll() {
  log.section('Wurl');

  if (!process.env.WURL_ENABLED || process.env.WURL_ENABLED !== 'true') {
    log.warn(SOURCE, 'Skipped — WURL_ENABLED not set to true.');
    log.warn(SOURCE, 'Apply at https://www.wurl.com/content-discovery then add credentials to .env');
    return { liveChannels: [], featured: [] };
  }

  if (!process.env.WURL_API_KEY) {
    log.error(SOURCE, 'WURL_API_KEY required in .env');
    return { liveChannels: [], featured: [] };
  }

  log.info(SOURCE, 'Fetching channels and VOD...');

  try {
    const [channelsRaw, vodRaw] = await Promise.all([
      fetchChannels(),
      fetchVODLibrary(20)
    ]);

    const liveChannels = channelsRaw.map(channelToItem).filter(Boolean);
    const featured     = vodRaw.map(vodToItem).filter(Boolean);

    log.success(SOURCE, `Live channels: ${liveChannels.length}, VOD: ${featured.length}`);
    return { liveChannels, featured };
  } catch (e) {
    log.error(SOURCE, `Failed: ${e.message}`);
    return { liveChannels: [], featured: [] };
  }
}

module.exports = { fetchAll };
