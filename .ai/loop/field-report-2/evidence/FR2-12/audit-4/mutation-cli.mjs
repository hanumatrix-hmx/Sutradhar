// FR2-12 audit-4: GAP-276 item 3 (disclosed NOT done in fix-3) -- do cli.ts's 3 guarded call sites
// still bypass-survive the cli unit suite? Mutates packages/cli/src/cli.ts only (vitest runs src),
// restores from memory, sha256-verified. Writes audit-4/mutation-cli-results.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-4')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const PKG = path.join(root, 'packages', 'cli');
const FILE = path.join(PKG, 'src', 'cli.ts');
const VITEST = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = await fs.readFile(FILE); const origSha = sha(orig); const t = orig.toString('utf8');
const M = [
  { id: 'B3-success-bare-console.log', from: 'writeJsonStdoutOnce(JSON.stringify(report, null, 2));', to: 'console.log(JSON.stringify(report, null, 2));' },
  { id: 'B4-preempt-bypass', from: '      printDialogBlockedJsonOnce(blockedMessage, raced.pending);', to: '      console.log(JSON.stringify(dialogBlockedJsonDoc(blockedMessage, raced.pending), null, 2));' },
  { id: 'B5-catch-bypass', from: 'if (printDialogBlockedJsonOnce((err as Error).message, pending)) {', to: 'if ((console.log(JSON.stringify(dialogBlockedJsonDoc((err as Error).message, pending))), true)) {' },
];
const results = [];
try {
  for (const m of M) {
    const i = t.indexOf(m.from);
    if (i < 0) { results.push({ id: m.id, error: 'anchor not found' }); continue; }
    await fs.writeFile(FILE, t.slice(0, i) + m.to + t.slice(i + m.from.length), 'utf8');
    const r = spawnSync(process.execPath, [VITEST, 'run'], { cwd: PKG, encoding: 'utf8', timeout: 600000 });
    const s = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
    const mm = s.match(/Tests\s+(.*)\n/);
    results.push({ id: m.id, status: r.status, tests: mm ? mm[1].trim() : 'unparsed', survived: r.status === 0 });
    await fs.writeFile(FILE, orig);
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await fs.writeFile(FILE, orig);
  const ok = sha(await fs.readFile(FILE)) === origSha;
  await fs.writeFile(path.join(here, 'mutation-cli-results.json'), JSON.stringify({ origSha, restoredShaMatch: ok, results }, null, 2));
  console.log('restored', ok);
}
