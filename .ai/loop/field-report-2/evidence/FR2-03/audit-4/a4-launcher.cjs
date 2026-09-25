// audit-4 launcher (v2): spawns a detached victim-with-child and exits IMMEDIATELY so the victim's PPID dangles.
// (v1 waited for the victim to report its grandchild pid first; run 1 got 0 hits in 40k tries -- the extra lifetime let
// later pool processes recycle the launcher PIDs before any squatter could, see a4-ppid-hunt-run1-nohit-*.)
const { spawn } = require('node:child_process'); const path = require('node:path');
const c = spawn(process.execPath, [path.join(__dirname, 'a4-victim-with-child.cjs')], { detached: true, stdio: 'ignore' });
c.unref(); process.stdout.write(JSON.stringify({ launcher: process.pid, victim: c.pid })); process.exit(0);
