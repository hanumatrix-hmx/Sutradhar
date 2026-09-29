// FR2-05 audit-2 mutation test of the fix-1 containment logic + GAP-296 lock. Mutates SOURCE only
// (vitest imports src; the live scripts use dist, so they're unaffected), restores with sha check.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const PC = WT + '/packages/browser/src/actions/path-containment.ts';
const EN = WT + '/packages/browser/src/actions/browser-action-engine.ts';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const origs = { [PC]: fs.readFileSync(PC, 'utf8'), [EN]: fs.readFileSync(EN, 'utf8') };
const muts = [
  ['P1 trailing-dot rejection removed entirely', PC, 'rejectWindowsTrimmedComponents(abs, platform);\n', ''],
  ['P2 rejection only checks the LAST component', PC, 'for (const part of parts) {', 'for (const part of parts.slice(-1)) {'],
  ['P3 rejection only checks trailing dot (not space)', PC, "part.endsWith('.') || part.endsWith(' ')", "part.endsWith('.')"],
  ['P4 rejection only checks trailing space (not dot)', PC, "part.endsWith('.') || part.endsWith(' ')", "part.endsWith(' ')"],
  ['P5 rejection moved AFTER the existence walk (only when full path resolves)', PC, "      const real = await realpath(cur);\n      return tail.length ? path.join(real, ...tail) : real;", "      const real = await realpath(cur);\n      if (!tail.length) rejectWindowsTrimmedComponents(abs, platform);\n      return tail.length ? path.join(real, ...tail) : real;"],
  ['P5b (paired with P5) remove the up-front call', PC, 'rejectWindowsTrimmedComponents(abs, platform);\n  let cur', 'let cur'],
  ['P6 roots NOT rejected (candidate-only): root canonicalization skipped', PC, 'r = await canonicalizePath(root, platform);', 'r = path.resolve(root);'],
  ['P7 back to full-Unicode toLowerCase fold', PC, "(platform === 'win32' ? foldAsciiCase(s) : s)", "(platform === 'win32' ? s.toLowerCase() : s)"],
  ['P8 no case fold at all (exact compare)', PC, "(platform === 'win32' ? foldAsciiCase(s) : s)", '(s)'],
  ['P9 drop root-spelling (drive/UNC) comparison', PC, 'if (fold(rootParsed.root) !== fold(candidateParsed.root)) return false;', ''],
  ['P10 drop segment-count guard', PC, 'if (candidateSegs.length < rootSegs.length) return false;', ''],
  ['P11 rejection applied on win32 AND posix (over-reject)', PC, "if (platform !== 'win32') return;", ''],
  ['P12 dangling link treated as plain dir', PC, 'isLink = true;', 'isLink = false;'],
  ['E1 GAP-296 lock removed (run directly)', EN, 'const thisDownload = previousDownload.catch(() => {}).then(() => this.runDownloadFileLocked(page!, params, downloadDir));', 'const thisDownload = this.runDownloadFileLocked(page!, params, downloadDir);'],
  ['E2 reset back to default instead of deny', EN, "await client.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});", "await client.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {});"],
  ['E3 reset removed entirely', EN, "await client.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});", ''],
];
const log = [`orig sha PC ${sha(origs[PC])} EN ${sha(origs[EN])}`];
function run() {
  const r = spawnSync(WT + '/node_modules/.bin/vitest.CMD', ['run'], { cwd: WT + '/packages/browser', encoding: 'utf8', shell: true });
  const txt = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  return { status: r.status, tests: (txt.match(/Tests\s+.*$/m) || ['?'])[0].trim() };
}
try {
  for (let i = 0; i < muts.length; i++) {
    const [name, file, from, to] = muts[i];
    if (name.startsWith('P5b')) continue;
    let src = origs[file];
    if (!src.includes(from)) { log.push(`${name}: ANCHOR NOT FOUND`); continue; }
    src = src.replace(from, to);
    if (name.startsWith('P5 ')) {
      const [, , f2, t2] = muts[i + 1];
      if (!src.includes(f2)) { log.push(`${name}: P5b ANCHOR NOT FOUND`); continue; }
      src = src.replace(f2, t2);
    }
    fs.writeFileSync(file, src);
    const r = run();
    fs.writeFileSync(file, origs[file]);
    log.push(`${name}: ${r.status === 0 ? 'SURVIVED' : 'KILLED'} | ${r.tests}`);
    console.log(log[log.length - 1]);
  }
} finally {
  for (const f of [PC, EN]) fs.writeFileSync(f, origs[f]);
  log.push(`restored PC match=${sha(fs.readFileSync(PC, 'utf8')) === sha(origs[PC])} EN match=${sha(fs.readFileSync(EN, 'utf8')) === sha(origs[EN])}`);
  console.log(log[log.length - 1]);
  fs.writeFileSync(process.argv[2], log.join('\n') + '\n');
}
