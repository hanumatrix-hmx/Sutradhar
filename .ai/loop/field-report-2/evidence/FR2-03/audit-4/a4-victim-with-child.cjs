// audit-4 victim: an unrelated process that has its OWN child (so a reused-PID squatter heads a 2-hop chain:
// grandchild -> victim -> squatter). Prints {victim, grandchild} then idles.
const { spawn } = require('node:child_process'); const path = require('node:path');
const c = spawn(process.execPath, [path.join(__dirname, 'idle.cjs'), 'fr2-03-a4-grandchild'], { stdio: 'ignore' });
process.stdout.write(JSON.stringify({ victim: process.pid, grandchild: c.pid }) + '\n');
setInterval(() => {}, 1e9);
