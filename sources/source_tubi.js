/**
 * PeriniCinema – sources/tubi.js
 * ⏳ PARTNERSHIP REQUIRED — Tubi Content Partner API
 *
 * Status: Ready to activate. Requires approval from Tubi.
 *
 * HOW TO ACTIVATE:
 * 1. Apply at: https://partners.tubi.tv
 * 2. Select "Content Partner" — you'll receive API credentials
 * 3. Add to .env:
 *      TUBI_API_KEY=your_key_here
 *      TUBI_PARTNER_ID=your_partner_id
 * 4. Set TUBI_ENABLED=true in .env
 *
 * What you get once approved:
 * - Full VOD catalog (50,000+ licensed titles)
 * - Direct HLS stream URLs
 * - Poster/artwork assets
 * - Metadata: ratings, genres, cast, descriptions
 * - Ad-insertion markers (SSAI) — required by Tubi partner agreement
 */

const { fetchJSON } = require('../utils/http');
const log = require('../utils/logger');

const SOURCE   = 'Tubi';
const API_BASE = 'https://api.tubitv.com/oz/videos'; // placeholder — real endpoint provided at onboarding

// ── Item normaliser ───────────────────────────────────────────────────────────
// Shape matches Tubi partner API response (documented at onboarding)

function toItem(raw) {
  if (!raw?.id) return null;
  return {
    id:          `tubi_${raw.id}`,
    source:      SOURCE,
    title:       raw.title || 'Untitled',
    description: (raw.description || '').substring(0, 300),
    posterUrl:   raw.thumbnails?.['320x480'] || raw.poster_url || '',
    artworkUrl:  raw.thumbnails?.['1920x1080'] || raw.backdrop_url || '',
    streamUrl:   raw.video_resources?.[0]?.manifest?.url || raw.url || '',
    releaseDate: raw.year ? `${raw.year}-01-01` : '',
    rating:      raw.rating || 'NR',
    length:      raw.duration || 0,
    genre:       Array.isArray(raw.tags) ? raw.tags[0] : (raw.tags || ''),
    type:        raw.type === 'series' ? 'series' : 'movie'
  };
}

// ── API calls (active once credentials provided) ──────────────────────────────

async function fetchCategory(categoryId, limit = 15) {
  const key       = process.env.TUBI_API_KEY;
  const partnerId = process.env.TUBI_PARTNER_ID;
  const url       = `${API_BASE}/category/${categoryId}?limit=${limit}&partner_id=${partnerId}`;
  const data      = await fetchJSON(url, {
    headers: { Authorization: `Bearer ${key}` }
  });
  return data?.rows?.[0]?.contents || [];
}

async function fetchFeatured(limit = 15) {
  const key       = process.env.TUBI_API_KEY;
  const partnerId = process.env.TUBI_PARTNER_ID;
  const url       = `${API_BASE}/featured?limit=${limit}&partner_id=${partnerId}`;
  const data      = await fetchJSON(url, {
    headers: { Authorization: `Bearer ${key}` }
  });
  return data?.rows?.[0]?.contents || [];
}

// ── Public exports ────────────────────────────────────────────────────────────

async function fetchAll() {
  log.section('Tubi');

  if (!process.env.TUBI_ENABLED || process.env.TUBI_ENABLED !== 'true') {
    log.warn(SOURCE, 'Skipped — TUBI_ENABLED not set to true.');
    log.warn(SOURCE, 'Apply at https://partners.tubi.tv then add credentials to .env');
    return { featured: [], trending: [], newReleases: [] };
  }

  if (!process.env.TUBI_API_KEY || !process.env.TUBI_PARTNER_ID) {
    log.error(SOURCE, 'TUBI_API_KEY and TUBI_PARTNER_ID required in .env');
    return { featured: [], trending: [], newReleases: [] };
  }

  log.info(SOURCE, 'Fetching content...');

  try {
    const [featuredRaw, trendingRaw, newRaw] = await Promise.all([
      fetchFeatured(15),
      fetchCategory('trending',     15),
      fetchCategory('new_arrivals', 15),
    ]);

    const featured    = featuredRaw.map(toItem).filter(Boolean);
    const trending    = trendingRaw.map(toItem).filter(Boolean);
    const newReleases = newRaw.map(toItem).filter(Boolean);

    log.success(SOURCE, `Featured: ${featured.length}, Trending: ${trending.length}, New: ${newReleases.length}`);
    return { featured, trending, newReleases };
  } catch (e) {
    log.error(SOURCE, `Failed: ${e.message}`);
    return { featured: [], trending: [], newReleases: [] };
  }
}

module.exports = { fetchAll };
