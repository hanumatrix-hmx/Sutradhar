// Applies M-b to temp-profile.ts, runs ONLY T5 and prints the assertion detail (the remaining-ms the module logged), always restores (sha256 checked).
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const f = WT + '/packages/cli/src/temp-profile.ts'; const orig = fs.readFileSync(f); const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const t = orig.toString('utf8'); const from = '    if (remaining < MIN_RM_START_MS) {'; if (t.split(from).length !== 2) throw new Error('anchor');
let out = '';
try { fs.writeFileSync(f, t.replace(from, '    if (remaining < 0) {'));
  const r = cp.spawnSync(process.execPath, [WT + '/node_modules/vitest/vitest.mjs', 'run', '--globals', 'tests/unit/temp-profile.spec.ts', '-t', 'T5'], { cwd: WT + '/packages/cli', encoding: 'utf8', timeout: 300000 });
  out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
} finally { fs.writeFileSync(f, orig); }
console.log(out.split('\n').filter((l) => /AssertionError|expected|Tests |T5 INFO|FAIL/.test(l)).map((l) => l.slice(0, 220)).join('\n'));
console.log('restored=' + (sha(fs.readFileSync(f)) === sha(orig)));
