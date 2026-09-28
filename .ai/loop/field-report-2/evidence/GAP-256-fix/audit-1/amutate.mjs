// GAP-256-fix audit-1 mutation runner. Each mutant: exact-string replace in ONE src file, run vitest
// on the relevant spec files, record counts, restore the original bytes and verify sha256 == original.
// vitest reads src directly; dist is never rebuilt here, so this never changes the built CLI.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { here, repoRoot } from './alib.mjs';

const VITEST = path.join(repoRoot, 'node_modules/vitest/vitest.mjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const B = 'packages/browser', CL = 'packages/cli';
const MUTANTS = [
  { id: 'M1-drop-crash-event-listener', pkg: B, file: 'src/session/dialog-warden.ts', from: 'if (e?.targetId) this.crashedTargets.add(e.targetId);', to: 'void e;', specs: ['tests/unit/dialog-warden.spec.ts'] },
  { id: 'M2-no-reprobe-in-corroborate', pkg: B, file: 'src/session/dialog-warden.ts', from: "return (await livenessProbe(oldSession, 300)) !== 'responsive';", to: 'return true;', specs: ['tests/unit/dialog-warden.spec.ts'] },
  { id: 'M3-never-clear-on-recovery', pkg: B, file: 'src/session/dialog-warden.ts', from: 'this.crashedTargets.delete(info.targetId); // it answered: reloaded/recovered', to: '// mutated', specs: ['tests/unit/dialog-warden.spec.ts'] },
  { id: 'M4-corroboration-disabled', pkg: B, file: 'src/session/dialog-warden.ts', from: 'if (await this.corroborateCrash(target, session)) {', to: 'if (false && (await this.corroborateCrash(target, session))) {', specs: ['tests/unit/dialog-warden.spec.ts'] },
  { id: 'M5-crashed-still-reported-as-unknown-dialog', pkg: B, file: 'src/session/dialog-warden.ts', from: "if (state === 'responsive' || crashedIds.has(info.targetId)) continue;", to: "if (state === 'responsive') continue;", specs: ['tests/unit/dialog-warden.spec.ts'] },
  { id: 'M6-overbroad-every-unresponsive-is-crashed', pkg: B, file: 'src/session/dialog-warden.ts', from: 'if (this.crashedTargets.has(info.targetId)) crashedIds.add(info.targetId);', to: 'crashedIds.add(info.targetId);', specs: ['tests/unit/dialog-warden.spec.ts'] },
  { id: 'M7-crashed-not-excluded-from-attribution', pkg: B, file: 'src/session/dialog-warden.ts', from: ".filter(({ info }) => states.get(info.targetId) !== 'responsive' && !crashedIds.has(info.targetId))", to: ".filter(({ info }) => states.get(info.targetId) !== 'responsive')", specs: ['tests/unit/dialog-warden.spec.ts'] },
  { id: 'M8-crash-not-cleared-on-destroy', pkg: B, file: 'src/session/dialog-warden.ts', from: 'this.crashedTargets.delete(targetId);', to: '// mutated', specs: ['tests/unit/dialog-warden.spec.ts'] },
  { id: 'M9-listTabs-no-page-filter', pkg: B, file: 'src/session/dialog-cdp.ts', from: ".filter((t) => t.type === 'page')\n    .map((t) => ({ targetId: t.targetId, url: t.url, title: t.title }));", to: ".map((t) => ({ targetId: t.targetId, url: t.url, title: t.title }));", specs: ['tests/unit/dialog-cdp.spec.ts'] },
  { id: 'M10-listTabs-silently-empty-without-connection', pkg: B, file: 'src/session/dialog-cdp.ts', from: "if (!connection) throw new Error('no browser-level CDP connection available to list the targets');", to: 'if (!connection) return [];', specs: ['tests/unit/dialog-cdp.spec.ts'] },
  { id: 'M11-gate-clears-whenever-anything-crashed', pkg: CL, file: 'src/dialog-broker.ts', from: "        for (const c of listed.crashed) console.error(formatCrashNote(c));\n      }\n      const real", to: "        for (const c of listed.crashed) console.error(formatCrashNote(c));\n      }\n      if (listed.crashed && listed.crashed.length > 0) return { status: 'clear' };\n      const real", specs: ['tests/unit/dialog-broker.spec.ts'] },
  { id: 'M12-warden-broker-drops-crashed', pkg: CL, file: 'src/dialog-broker.ts', from: 'crashed: body.crashed ?? [],', to: 'crashed: [],', specs: ['tests/unit/dialog-broker.spec.ts'] },
  { id: 'M13-no-crash-note', pkg: CL, file: 'src/dialog-broker.ts', from: '        for (const c of listed.crashed) console.error(formatCrashNote(c));\n      }\n      const real', to: '        void listed;\n      }\n      const real', specs: ['tests/unit/dialog-broker.spec.ts'] },
];

const results = [];
for (const m of MUTANTS) {
  const abs = path.join(repoRoot, m.pkg, m.file);
  const orig = await fs.readFile(abs);
  const origSha = sha(orig);
  const text = orig.toString('utf-8');
  const n = text.split(m.from).length - 1;
  if (n !== 1) { results.push({ id: m.id, error: `pattern matched ${n} times` }); console.log(m.id, 'PATTERN', n); continue; }
  let out = '', code = 0;
  try {
    await fs.writeFile(abs, text.replace(m.from, m.to));
    try { out = execFileSync(process.execPath, [VITEST, 'run', '--globals', ...m.specs], { cwd: path.join(repoRoot, m.pkg), encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 }); }
    catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  } finally {
    await fs.writeFile(abs, orig);
  }
  const restoredSha = sha(await fs.readFile(abs));
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const tests = /Tests\s+(.*)/.exec(clean)?.[1]?.trim();
  const failedNames = [...clean.matchAll(/FAIL\s+(tests\/\S+)\s+>\s+(.*)/g)].map((x) => x[2].slice(0, 140));
  const r = { id: m.id, file: `${m.pkg}/${m.file}`, vitestExit: code, tests, killed: code !== 0, failedTests: [...new Set(failedNames)].slice(0, 12), restoredShaOk: restoredSha === origSha, sha: origSha };
  results.push(r);
  await fs.writeFile(path.join(here, `mutant-${m.id}.txt`), clean);
  console.log(JSON.stringify(r));
}
await fs.writeFile(path.join(here, 'mutation-results.json'), JSON.stringify(results, null, 2));
