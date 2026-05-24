/**
 * PeriniCinema – sources/archive.js
 * ✅ LIVE — Internet Archive public API (no auth required)
 * Docs: https://archive.org/advancedsearch.php
 */

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

// ── Helpers ──────────────────────────────────────────────────────────────────

async function searchArchive(query, rows = 12) {
  const fields = 'identifier,title,description,year,runtime,subject,downloads';
  const url    = `${BASE}/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=${fields}&sort[]=downloads+desc&rows=${rows}&output=json`;
  const data   = await fetchJSON(url);
  return data?.response?.docs || [];
}

async function resolveStreamUrl(identifier) {
  const meta = await fetchJSON(`${BASE}/metadata/${identifier}/files`);
  if (!meta?.result) return null;
  const files = meta.result;
  const mp4   = files.find(f => f.name?.endsWith('_512kb.mp4'))
             || files.find(f => f.name?.endsWith('.mp4'))
             || files.find(f => f.name?.endsWith('.ogv'));
  if (!mp4) return null;
  return `${BASE}/download/${identifier}/${encodeURIComponent(mp4.name)}`;
}

function parseRuntime(raw) {
  if (!raw) return 0;
  const s = String(raw);
  const parts = s.split(':');
  if (parts.length === 3) return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
  if (parts.length === 2) return (+parts[0]) * 60 + (+parts[1]);
  return parseInt(s) * 60 || 0;
}

async function docToItem(doc) {
  const id        = doc.identifier;
  const streamUrl = await resolveStreamUrl(id);
  if (!streamUrl) return null;

  const desc = Array.isArray(doc.description) ? doc.description[0] : (doc.description || '');

  return {
    id,
    source:      SOURCE,
    title:       doc.title || 'Untitled',
    description: desc.substring(0, 300),
    posterUrl:   `${BASE}/services/img/${id}`,
    artworkUrl:  `${BASE}/services/img/${id}`,
    streamUrl,
    releaseDate: doc.year ? `${doc.year}-01-01` : '',
    rating:      'NR',
    length:      parseRuntime(doc.runtime),
    genre:       Array.isArray(doc.subject) ? doc.subject[0] : (doc.subject || ''),
    type:        'movie'
  };
}

async function processDocs(docs, concurrency = 4) {
  const results = [];
  for (let i = 0; i < docs.length; i += concurrency) {
    const batch = docs.slice(i, i + concurrency);
    const items = await Promise.all(batch.map(docToItem));
    results.push(...items.filter(Boolean));
    if (i + concurrency < docs.length) await sleep(300);
  }
  return results;
}

// ── Public exports ────────────────────────────────────────────────────────────

async function fetchAll() {
  log.section('Internet Archive');
  log.info(SOURCE, 'Searching all categories...');

  const rawResults = await Promise.all(
    Object.entries(QUERIES).map(([key, q]) =>
      searchArchive(q).then(docs => ({ key, docs }))
    )
  );

  log.info(SOURCE, 'Resolving stream URLs...');
  const resolved = {};
  for (const { key, docs } of rawResults) {
    resolved[key] = await processDocs(docs);
    log.success(SOURCE, `${key}: ${resolved[key].length} items`);
  }

  return resolved;
}

module.exports = { fetchAll };
