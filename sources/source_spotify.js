/**
 * PeriniCinema – sources/spotify.js
 * ✅ LIVE — Spotify Web API (official developer API)
 * Provides: Podcast episodes with audio previews for a "Podcasts" section
 * Requires: SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET in .env
 * Get credentials: https://developer.spotify.com/dashboard
 *
 * NOTE: Spotify is audio-only. This populates a "Podcasts" row in your
 * Roku channel where users can listen to 30-second previews or full episodes
 * via the Spotify-provided preview_url (MP3). Full episode playback requires
 * the user to have a Spotify account — handled via deep link.
 */

const { postForm, fetchJSON } = require('../utils/http');
const log = require('../utils/logger');

const SOURCE     = 'Spotify';
const TOKEN_URL  = 'https://accounts.spotify.com/api/token';
const API_BASE   = 'https://api.spotify.com/v1';

// Podcast show IDs to pull episodes from — curated cinema / film topics
// Replace or extend these with any Spotify show IDs you prefer
const PODCAST_SHOWS = [
  '4gHaGsBaRFQ72fNNQa6gSm', // The Big Picture (The Ringer — film podcast)
  '1OLcQdw2PFDPG1jo3zZHit', // Filmspotting
  '7dQNMuFJFvPyUxbF8XMdlj', // Kermode and Mayo's Take
  '2mTUnDkuKUkhiueKcVWoP0', // Empire Film Podcast
  '6E1lMQUuHnYD5wLaLnPBDe', // The Rewatchables (The Ringer)
  '5c26B28vZMq38qbBHiLsMm', // Slash Film Daily
];

// Search queries for podcast episodes
const EPISODE_SEARCHES = [
  { q: 'film review cinema 2024', market: 'US', limit: 10 },
  { q: 'movie documentary behind the scenes', market: 'US', limit: 10 },
  { q: 'director interview Hollywood', market: 'US', limit: 8 },
];

// ── Auth ─────────────────────────────────────────────────────────────────────

let _tokenCache = null;

async function getAccessToken() {
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env');
  }

  // Return cached token if still valid
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const data = await postForm(TOKEN_URL, { grant_type: 'client_credentials' }, {
    Authorization: `Basic ${credentials}`
  });

  if (!data?.access_token) throw new Error('Failed to obtain Spotify access token');

  _tokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000
  };
  log.success(SOURCE, 'Access token obtained');
  return _tokenCache.token;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function spotifyGet(path) {
  const token = await getAccessToken();
  return fetchJSON(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function episodeToItem(ep, showName = '') {
  if (!ep?.id) return null;

  // Use preview_url (30-sec MP3) as streamUrl — free, no auth needed
  // Full episode URL is provided as deepLinkUrl for deep linking to Spotify
  const streamUrl = ep.audio_preview_url || '';

  return {
    id:          `spotify_ep_${ep.id}`,
    source:      SOURCE,
    title:       ep.name || 'Untitled Episode',
    description: (ep.description || ep.html_description || '').replace(/<[^>]+>/g, '').substring(0, 300),
    posterUrl:   ep.images?.[0]?.url || '',
    artworkUrl:  ep.images?.[0]?.url || '',
    streamUrl,                                // 30-sec MP3 preview — free
    deepLinkUrl: ep.external_urls?.spotify || '', // Full episode on Spotify
    releaseDate: ep.release_date || '',
    rating:      'NR',
    length:      ep.duration_ms ? Math.floor(ep.duration_ms / 1000) : 0,
    genre:       'Podcast',
    show:        showName,
    type:        'podcast',
    isPreview:   true   // flag so Roku UI can show "Full episode on Spotify"
  };
}

// ── Fetch by show IDs ─────────────────────────────────────────────────────────

async function fetchShowEpisodes(showId, limit = 5) {
  const data = await spotifyGet(`/shows/${showId}/episodes?limit=${limit}&market=US`);
  if (!data?.items) return [];
  const show = await spotifyGet(`/shows/${showId}?market=US`);
  const showName = show?.name || '';
  return data.items.map(ep => episodeToItem(ep, showName)).filter(Boolean);
}

// ── Fetch by search ───────────────────────────────────────────────────────────

async function fetchBySearch(q, limit = 10) {
  const encoded = encodeURIComponent(q);
  const data    = await spotifyGet(`/search?q=${encoded}&type=episode&market=US&limit=${limit}`);
  if (!data?.episodes?.items) return [];
  return data.episodes.items.map(ep => episodeToItem(ep)).filter(Boolean);
}

// ── Public exports ────────────────────────────────────────────────────────────

async function fetchAll() {
  log.section('Spotify Podcasts');

  if (!process.env.SPOTIFY_CLIENT_ID) {
    log.warn(SOURCE, 'Skipped — SPOTIFY_CLIENT_ID not set. Add to .env to enable.');
    return { podcasts: [] };
  }

  try {
    await getAccessToken();
  } catch (e) {
    log.error(SOURCE, e.message);
    return { podcasts: [] };
  }

  const results = [];

  // Pull curated show episodes
  log.info(SOURCE, `Fetching episodes from ${PODCAST_SHOWS.length} curated shows...`);
  for (const showId of PODCAST_SHOWS) {
    try {
      const eps = await fetchShowEpisodes(showId, 3);
      results.push(...eps);
      log.success(SOURCE, `Show ${showId}: ${eps.length} episodes`);
    } catch (e) {
      log.warn(SOURCE, `Show ${showId} failed: ${e.message}`);
    }
  }

  // Search-based episodes
  log.info(SOURCE, 'Fetching search-based podcast episodes...');
  for (const { q, limit } of EPISODE_SEARCHES) {
    try {
      const eps = await fetchBySearch(q, limit);
      results.push(...eps);
    } catch (e) {
      log.warn(SOURCE, `Search "${q}" failed: ${e.message}`);
    }
  }

  // Deduplicate by id
  const seen  = new Set();
  const deduped = results.filter(i => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });

  log.success(SOURCE, `Total podcast episodes: ${deduped.length}`);
  return { podcasts: deduped.slice(0, 30) };
}

module.exports = { fetchAll };
