// FR2-12 audit-1: auditor's own mutation tests. Each mutation is applied to the source, the
// capability-runtime vitest suite (and cli/mcp/sutradhar where relevant) is run, then the file
// is restored and its sha256 verified against the original.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const pkg = (p) => path.join(repoRoot, 'packages', p);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const vitest = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

const SITE = path.join(pkg('capability-runtime'), 'src', 'audit', 'site-audit.ts');
const REPORT = path.join(pkg('capability-runtime'), 'src', 'audit', 'audit-report.ts');
const RUNTIME = path.join(pkg('capability-runtime'), 'src', 'runtime.ts');
const OUTPUT = path.join(pkg('cli'), 'src', 'audit-output.ts');

const mutations = [
  { id: 'M1', file: SITE, desc: 'computeObservation navigated: drop min(), always use navStartedAt', from: "since = input.navStartedAt <= documentStartedAt ? input.navStartedAt : documentStartedAt;", to: 'since = input.navStartedAt;' },
  { id: 'M2', file: SITE, desc: 'computeObservation: coversWholeDocument always true', from: 'input.observingSince !== null && since !== null && input.observingSince <= since;', to: 'true;' },
  { id: 'M3', file: SITE, desc: 'scopeToDocument: >= becomes > (boundary entry dropped)', from: 'entries.filter((e) => e.timestamp >= sinceIso)', to: 'entries.filter((e) => e.timestamp > sinceIso)' },
  { id: 'M4', file: SITE, desc: 'computeObservation current-page: since = observingSince instead of documentStartedAt', from: '  } else {\n    since = documentStartedAt;\n  }', to: '  } else {\n    since = input.observingSince;\n  }' },
  { id: 'M5', file: REPORT, desc: 'buildAuditReport: bytes = base64 string length (wrong)', from: 'bytes: screenshotBuf.length', to: 'bytes: r.screenshotBase64.length' },
  { id: 'M6', file: REPORT, desc: 'buildAuditReport: success baseline drops diffPath (always null)', from: 'diffPath: files.diffPath,', to: 'diffPath: null,' },
  { id: 'M7', file: REPORT, desc: 'buildAuditReport: width/height swapped', from: 'screenshot: { path: files.screenshotPath, width, height,', to: 'screenshot: { path: files.screenshotPath, width: height, height: width,' },
  { id: 'M8', file: RUNTIME, desc: 'runtime.audit: navStartedAt not passed (null) to computeObservation', from: '      navStartedAt,\n', to: '      navStartedAt: null,\n' },
  { id: 'M9', file: RUNTIME, desc: 'runtime.audit: dialog fast-fail removed', from: 'if (pending) {\n      const truncated', to: 'if (false && pending) {\n      const truncated' },
  { id: 'M10', file: OUTPUT, pkg: 'cli', desc: 'auditExitCode: baseline error no longer forces exit 1', from: "if (report.baseline && 'error' in report.baseline) return 1;", to: '' },
  { id: 'M11', file: REPORT, desc: 'prepareAuditOutDir: skip the is-a-file check', from: 'if (existing && !existing.isDirectory()) {', to: 'if (false && existing && !existing.isDirectory()) {' },
];

const results = [];
const only = process.argv.slice(2);
for (const m0 of mutations) {
  if (only.length && !only.includes(m0.id)) continue;
  const orig = fs.readFileSync(m0.file, 'utf8');
  const crlf = orig.includes('\r\n');
  const m = crlf ? { ...m0, from: m0.from.replace(/\n/g, '\r\n'), to: m0.to.replace(/\n/g, '\r\n') } : m0;
  const origSha = sha(m.file);
  if (!orig.includes(m.from)) { results.push({ ...m, from: undefined, to: undefined, applied: false }); continue; }
  fs.writeFileSync(m.file, orig.replace(m.from, m.to));
  const pkgs = m.pkg ? [m.pkg] : ['capability-runtime'];
  const runs = {};
  try {
    for (const p of pkgs) {
      const r = spawnSync(process.execPath, [vitest, 'run'], { cwd: pkg(p), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const txt = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
      const failedNames = [...txt.matchAll(/(?:FAIL|×)\s+(.*)/g)].map((x) => x[1].trim()).slice(0, 8);
      runs[p] = { exit: r.status, summary: (txt.match(/Tests\s+.*$/m) || [''])[0], failedNames };
    }
  } finally {
    fs.writeFileSync(m.file, orig);
  }
  const restored = sha(m.file) === origSha;
  const caught = Object.values(runs).some((r) => r.exit !== 0);
  results.push({ id: m.id, desc: m.desc, file: path.relative(repoRoot, m.file), caught, runs, restoredShaMatches: restored });
  console.log(m.id, caught ? 'CAUGHT' : 'SURVIVED', JSON.stringify(runs), 'restored', restored);
  if (!restored) { console.error('RESTORE FAILED for', m.file); process.exit(2); }
}
fs.writeFileSync(path.join(here, only.length ? 'mutation-results-' + only.join('-') + '.json' : 'mutation-results.json'), JSON.stringify(results, null, 2));
