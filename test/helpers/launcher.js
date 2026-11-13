'use strict';
// Tests run the fake yt-dlp through a launcher whose shebang is this machine's own node binary.
// A shebang such as "#!/usr/bin/env node" fails on Termux (Android), where /usr/bin/env does not exist.
const fs = require('node:fs');
const path = require('node:path');

function makeLauncher(dir, target) {
  const file = path.join(dir, 'ytdlp-launcher');
  fs.writeFileSync(file, `#!${process.execPath}\nrequire(${JSON.stringify(target)});\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

module.exports = { makeLauncher };
