// spawns a detached victim then exits, so the victim's PPID dangles
const { spawn } = require('node:child_process');
const c = spawn(process.execPath, [require('node:path').join(__dirname, 'idle.cjs'), 'fr2-03-a2-victim'], { detached: true, stdio: 'ignore' });
c.unref(); console.log(JSON.stringify({ launcher: process.pid, victim: c.pid })); process.exit(0);
