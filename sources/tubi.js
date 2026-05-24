var log = require('../utils/logger');
var SOURCE = 'Tubi';

async function fetchAll() {
  log.section('Tubi');
  if (process.env.TUBI_ENABLED !== 'true') {
    log.warn(SOURCE, 'Skipped -- apply at https://partners.tubi.tv then set TUBI_ENABLED=true in .env');
    return { featured: [], trending: [], newReleases: [] };
  }
  log.warn(SOURCE, 'Credentials detected but full integration pending partner onboarding');
  return { featured: [], trending: [], newReleases: [] };
}

module.exports = { fetchAll: fetchAll };
