// audit-3 positive control: a marked "browser" that spawns ONE genuine structural child (so the PPID walk must still
// kill that child -- proves the walk is live, not just dead code that happens to spare victims)
const { spawn } = require('node:child_process'); const path = require('node:path');
const c = spawn(process.execPath, [path.join(__dirname, 'idle.cjs'), 'fr2-03-a3-genuine-child'], { stdio: 'ignore' });
process.stdout.write(JSON.stringify({ fake: process.pid, child: c.pid }) + '\n');
setInterval(() => {}, 1e9);
