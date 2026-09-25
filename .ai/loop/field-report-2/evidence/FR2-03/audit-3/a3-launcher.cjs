// audit-3 launcher: spawns one detached idle "victim", prints both pids, exits at once so the victim's PPID dangles
const { spawn } = require('node:child_process'); const path = require('node:path');
const c = spawn(process.execPath, [path.join(__dirname, 'idle.cjs'), 'fr2-03-a3-victim'], { detached: true, stdio: 'ignore' });
c.unref(); process.stdout.write(JSON.stringify({ launcher: process.pid, victim: c.pid })); process.exit(0);
