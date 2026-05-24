const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function ts() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

const log = {
  info: function(tag, msg) {
    console.log(DIM + ts() + RESET + ' ' + CYAN + '[' + tag + ']' + RESET + ' ' + msg);
  },
  success: function(tag, msg) {
    console.log(DIM + ts() + RESET + ' ' + GREEN + '[OK] [' + tag + ']' + RESET + ' ' + msg);
  },
  warn: function(tag, msg) {
    console.warn(DIM + ts() + RESET + ' ' + YELLOW + '[!!] [' + tag + ']' + RESET + ' ' + msg);
  },
  error: function(tag, msg) {
    console.error(DIM + ts() + RESET + ' ' + RED + '[ERR] [' + tag + ']' + RESET + ' ' + msg);
  },
  section: function(title) {
    console.log('\n' + BOLD + '--------------------------------------------------' + RESET);
    console.log(BOLD + '  ' + title + RESET);
    console.log(BOLD + '--------------------------------------------------' + RESET);
  }
};

module.exports = log;
