var log = require('../utils/logger');
var SOURCE = 'Wurl';

async function fetchAll() {
  log.section('Wurl');
  if (process.env.WURL_ENABLED !== 'true') {
    log.warn(SOURCE, 'Skipped -- apply at https://www.wurl.com/content-discovery then set WURL_ENABLED=true in .env');
    return { liveChannels: [], featured: [] };
  }
  log.warn(SOURCE, 'Credentials detected but full integration pending partner onboarding');
  return { liveChannels: [], featured: [] };
}

module.exports = { fetchAll: fetchAll };
