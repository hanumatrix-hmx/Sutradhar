const fs = require('fs'), cp = require('child_process'), crypto = require('crypto'), path = require('path');
const f = path.join(process.argv[2], 'packages/capability-runtime/src/project-config.ts');
const orig = fs.readFileSync(f, 'utf8'); const h = crypto.createHash('sha256').update(orig).digest('hex');
const from = "ignored${s ? ` (did you mean \"${prefix}${s}\"?)` : ''}`);";
if (orig.split(from).length !== 2) throw new Error('anchor');
try {
  fs.writeFileSync(f, orig.replace(from, from.slice(0, -2) + " + ' (' + key + ')');"));
  const r = cp.spawnSync(process.execPath, [path.join(process.argv[2], 'node_modules/vitest/vitest.mjs'), 'run', '--globals', '--reporter=verbose', 'tests/unit/echo-choke-point.spec.ts'], { cwd: path.join(process.argv[2], 'packages/capability-runtime'), encoding: 'utf8' });
  const s = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  console.log(s.split('\n').filter((l) => /[✓×✗]|FAIL|Tests /.test(l)).slice(0, 40).join('\n'));
} finally { fs.writeFileSync(f, orig); console.log('restored', crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') === h); }
