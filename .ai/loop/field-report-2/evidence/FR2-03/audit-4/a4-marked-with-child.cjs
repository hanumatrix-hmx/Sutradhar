// audit-4 positive control: a marked fake "browser" with one genuine child -- the child MUST be planned/killed
const { spawn } = require('node:child_process'); const path = require('node:path');
const c = spawn(process.execPath, [path.join(__dirname, 'idle.cjs'), 'fr2-03-a4-genuine-child'], { stdio: 'ignore' });
process.stdout.write(JSON.stringify({ fake: process.pid, child: c.pid }) + '\n');
setInterval(() => {}, 1e9);
