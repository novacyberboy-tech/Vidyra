'use strict';
// One command for Vidyra:
//   npm start                      start in the background (keeps downloading when you leave the app)
//   npm start -- status            is it running?
//   npm start -- stop              stop (unfinished downloads resume next time)
//   npm start -- logs              the last lines of the log
//   npm start -- foreground        run in this terminal instead
//   npm start -- <command> ...     any Vidyra command, e.g. npm start -- add "https://…" --audio
//   npm start -- help              every command
const daemon = require('./src/daemon');
const { commandList } = require('./src/commands');

const DAEMON_USAGE = [
  'Vidyra — one command for everything:',
  '',
  '  npm start                      start in the background',
  '  npm start -- status            is it running?',
  '  npm start -- stop              stop it (unfinished downloads resume next time)',
  '  npm start -- logs              show the last lines of the log',
  '  npm start -- foreground        run in this terminal instead (Ctrl+C stops it)',
  '',
  'Vidyra commands (the app is running):',
].join('\n');

function printHelp() {
  console.log(DAEMON_USAGE);
  for (const c of commandList()) console.log(`  npm start -- ${c.usage}\n        ${c.summary}`);
  console.log('\nQuote links that contain spaces or &:  npm start -- add "https://…"');
}

async function main(argv) {
  const [first = 'start', ...rest] = argv;
  switch (first) {
    case 'start': return daemon.start();
    case 'stop': return daemon.stop();
    case 'status': return daemon.status();
    case 'logs': return daemon.logs(Number.parseInt(rest[0], 10) || 60);
    case 'foreground': case 'run': return daemon.foreground();
    case 'help': case '--help': case '-h': case '?':
      printHelp();
      return 0;
    default:
      return daemon.remote([first, ...rest]);
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code || 0; },
  (e) => { console.error(e.message || e); process.exitCode = 1; },
);
