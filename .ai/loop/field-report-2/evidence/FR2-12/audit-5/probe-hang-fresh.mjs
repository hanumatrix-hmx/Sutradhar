// FR2-12 audit-5 driver: GAP-274 hang bound, one FRESH child process per measurement (300s hard outer
// timeout each). Positive control: temporarily raise AUDIT_CDP_SETUP_BOUND_MS in dist/runtime.js to an
// effectively-infinite value (sha-verified restore), run the dialog case in a fresh child, restore.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { here, root, outPath } from './lib.mjs';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const DIST = path.join(root, 'packages', 'capability-runtime', 'dist', 'runtime.js');
const out = { runs: [] };
const OUT = outPath('probe-hang-fresh.json');
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const child = async (kase, tag) => {
  const file = `probe-hang-child-${tag}.json`;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, 'probe-hang-child.mjs'), kase, file], { cwd: here, encoding: 'utf8', timeout: 300000 });
  let res = null; try { res = JSON.parse(await fs.readFile(outPath(file), 'utf8')); } catch {}
  const rec = { tag, kase, exit: r.status, signal: r.signal, wallMs: Date.now() - t0, res };
  out.runs.push(rec); await save();
  console.log(tag, kase, 'exit', r.status, 'auditMs', res?.auditMs, 'bound', res?.boundInLoadedModule, 'own404', res?.own404Reported, res?.auditErr ?? '');
  return rec;
};
for (let i = 0; i < 3; i++) await child('dialog', `bounded-dialog-${i}`);
for (let i = 0; i < 2; i++) await child('navtimeout', `bounded-navtimeout-${i}`);
// positive control
const orig = await fs.readFile(DIST);
const origSha = sha(orig);
out.distShaBefore = origSha;
try {
  const txt = orig.toString('utf8');
  if ((txt.match(/AUDIT_CDP_SETUP_BOUND_MS = 1000;/g) || []).length !== 1) throw new Error('anchor');
  await fs.writeFile(DIST, txt.replace('AUDIT_CDP_SETUP_BOUND_MS = 1000;', 'AUDIT_CDP_SETUP_BOUND_MS = 2147483647;'));
  await child('dialog', 'UNBOUNDED-control-dialog-0');
} finally {
  await fs.writeFile(DIST, orig);
  out.distShaAfter = sha(await fs.readFile(DIST));
  out.distRestored = out.distShaAfter === origSha;
  await save();
}
await child('dialog', 'bounded-dialog-after-restore');
console.log('distRestored', out.distRestored);
