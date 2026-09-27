// FR2-04 audit-4: live-kill check for vitest-surviving mutations. Applies ONE mutation, rebuilds
// @sutradhar/cli (and its workspace deps) with turbo --force, runs a live probe command, then
// restores the original bytes (sha256-verified) and rebuilds again. usage: node mutation-live.mjs <id>
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { repoRoot, here } from './lib.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const LIVE = {
  'A13-warden-drops-discoveredAt': {
    file: 'packages/browser/src/session/dialog-warden.ts',
    find: 'discoveredAt: this.discoveredAt.get(info.targetId) }));', repl: 'discoveredAt: undefined }));',
    probe: ['attrib-attack-probe.mjs', 'older-sibling-newer-alerts', '2', 'mutlive-A13'],
  },
  'A20-selectDialog-picks-collateral': {
    file: 'packages/cli/src/dialog-cli.ts',
    find: '  const target = sorted.find((d) => !d.blockedBy);', repl: '  const target = sorted[0];',
    probe: ['attrib-attack-probe.mjs', 'single-sync', '2', 'mutlive-A20'],
  },
};
const id = process.argv[2];
const m = LIVE[id];
const abs = path.join(repoRoot, m.file);
const orig = await fs.readFile(abs);
const origSha = sha(orig);
const text = orig.toString('utf-8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const find = m.find.replace(/\n/g, eol);
if (text.split(find).length !== 2) { console.log('find count mismatch'); process.exit(1); }
const build = () => spawnSync(path.join(repoRoot, 'node_modules/.bin/turbo.CMD'), ['run', 'build', '--filter=@sutradhar/cli...', '--force'], { cwd: repoRoot, encoding: 'utf-8', shell: true, timeout: 600000 });
const out = { id, at: new Date().toISOString() };
try {
  await fs.writeFile(abs, text.replace(find, m.repl.replace(/\n/g, eol)));
  const b1 = build();
  out.mutatedBuild = b1.status;
  const r = spawnSync(process.execPath, m.probe, { cwd: here, encoding: 'utf-8', timeout: 1800000 });
  out.probeStdout = r.stdout.slice(-3000);
} finally {
  await fs.writeFile(abs, orig);
  out.restoredShaOk = sha(await fs.readFile(abs)) === origSha;
  const b2 = build();
  out.restoreBuild = b2.status;
  await fs.writeFile(path.join(here, `mutation-live-${id}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!out.restoredShaOk) process.exit(2);
}
