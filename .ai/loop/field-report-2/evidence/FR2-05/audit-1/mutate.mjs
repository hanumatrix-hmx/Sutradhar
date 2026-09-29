import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const F = WT + '/packages/browser/src/actions/path-containment.ts';
const orig = fs.readFileSync(F, 'utf8');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const muts = [
  ['M1 naive startsWith (no separator boundary)', "const rel = p.relative(fold(root), fold(candidate));", "if (fold(candidate).startsWith(fold(root))) return true; const rel = p.relative(fold(root), fold(candidate));"],
  ['M2 no win32 case-fold', "(platform === 'win32' ? s.toLowerCase() : s)", "(s)"],
  ['M3 dangling-link check disabled', "isLink = true;", "isLink = false;"],
  ['M4 fall back to literal on any error (old B2 bug)', "        if (isLink) {", "        return abs;\n        if (isLink) {"],
  ['M5 drop isAbsolute(rel) check (other drive / device path)', "if (p.isAbsolute(rel)) return false;", ""],
  ['M6 drop dotdot check', "if (rel === '..' || rel.startsWith('..' + p.sep)) return false;", ""],
  ['M7 skip root canonicalization (compare literal root)', "r = await canonicalizePath(root);", "r = root;"],
];
const log = [`orig sha256 ${sha(orig)}`];
try {
  for (const [name, from, to] of muts) {
    if (!orig.includes(from)) { log.push(`${name}: ANCHOR NOT FOUND`); continue; }
    fs.writeFileSync(F, orig.replace(from, to));
    const r = spawnSync(WT + '/node_modules/.bin/vitest.CMD', ['run', 'tests/unit/path-containment.spec.ts', 'tests/unit/browser-action-engine.spec.ts'], { cwd: WT + '/packages/browser', encoding: 'utf8', shell: true });
    const txt = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    const tests = (txt.match(/Tests\s+.*$/m) || ['?'])[0].trim();
    log.push(`${name}: ${r.status === 0 ? 'SURVIVED' : 'KILLED'} | ${tests}`);
  }
} finally {
  fs.writeFileSync(F, orig);
  log.push(`restored sha256 ${sha(fs.readFileSync(F, 'utf8'))} match=${sha(fs.readFileSync(F, 'utf8')) === sha(orig)}`);
  console.log(log.join('\n'));
  fs.writeFileSync(process.argv[2], log.join('\n') + '\n');
}
