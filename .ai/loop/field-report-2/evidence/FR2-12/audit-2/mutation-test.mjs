// FR2-12 audit-2 mutation harness (auditor-written). One mutation at a time: backup -> mutate
// (exactly-one-match asserted) -> tsc the package -> vitest the package -> optional live probe in a
// CHILD process with a hard timeout -> restore from backup -> sha256-verify -> rebuild.
// Every child is spawned with a hard timeout and killed by its own PID tree only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const OUT = path.join(here, 'mutation-results.json');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

function run(cmd, args, cwd, timeoutMs) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024, shell: false });
  if (r.error && r.pid) { try { execFileSync('taskkill', ['/PID', String(r.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  return { status: r.status, error: r.error ? String(r.error) : undefined, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
const tsc = (pkg) => run(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')], path.join(root, 'packages', pkg), 300000);
function vitest(pkg, filter) {
  const args = [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...(filter ? [filter] : [])];
  const r = run(process.execPath, args, path.join(root, 'packages', pkg), 600000);
  const clean = r.out.replace(/\x1b\[[0-9;]*m/g, '');
  const tests = clean.match(/Tests\s+(.*)/)?.[1]?.trim();
  const failedNames = [...clean.matchAll(/(?:FAIL|×)\s+(.+)/g)].map((m) => m[1].trim()).slice(0, 8);
  return { status: r.status, error: r.error, tests, failedNames };
}

const MUTATIONS = {
  M1_reintroduce_min: { pkg: 'capability-runtime', file: 'src/audit/site-audit.ts',
    from: 'since = input.navCommittedAt ?? documentStartedAt;',
    to: 'if (input.navCommittedAt !== null && documentStartedAt !== null) { since = input.navCommittedAt <= documentStartedAt ? input.navCommittedAt : documentStartedAt; } else { since = input.navCommittedAt ?? documentStartedAt; }',
    live: ['runtime', 'mut'] },
  M2_early_commit_value: { pkg: 'capability-runtime', file: 'src/capability-runtime-placeholder', file2: 'src/runtime.ts',
    from: 'navCommittedAt = new Date().toISOString();', to: 'navCommittedAt = new Date(Date.now() - 1000).toISOString();', live: ['runtime', 'mut'] },
  M3_no_subframe_filter: { pkg: 'capability-runtime', file2: 'src/runtime.ts',
    from: "if (typeof page.mainFrame === 'function' && frame !== page.mainFrame()) return; // ignore subframes", to: 'void frame;' },
  M4_first_event_only: { pkg: 'capability-runtime', file2: 'src/runtime.ts',
    from: 'navCommittedAt = new Date().toISOString();', to: 'navCommittedAt ??= new Date().toISOString();', live: ['runtime', 'mut'] },
  M5_listener_never_attached: { pkg: 'capability-runtime', file2: 'src/runtime.ts',
    from: 'options.url !== undefined &&', to: 'false &&', live: ['runtime', 'mut'] },
  M6_reportDialogs_stdout: { pkg: 'cli', file2: 'src/cli.ts', occurrence: 1,
    from: 'const dialogLog = jsonMode ? console.error : console.log;', to: 'const dialogLog = console.log;', live: ['cli', 'mut'] },
  M6b_gate_handled_stdout: { pkg: 'cli', file2: 'src/cli.ts', occurrence: 2,
    from: 'const dialogLog = jsonMode ? console.error : console.log;', to: 'const dialogLog = console.log;', live: ['cli', 'mut'] },
  M7_gate_catch_textlines: { pkg: 'cli', file2: 'src/cli.ts',
    from: 'console.log(dialogBlockedJsonDoc(err.message, err.dialogs, err.handledRecords));', to: 'for (const line of err.stdoutLines()) console.log(line);', live: ['cli', 'mut'] },
  M8b_cmdAudit_catch_removed_boundary: { pkg: 'cli', file2: 'src/cli.ts',
    from: 'if (jsonMode && pending.length > 0) {', to: 'if (false && pending.length > 0) {', live: ['cli', 'boundary1500'] },
  M9_preempt_json_removed: { pkg: 'cli', file2: 'src/cli.ts',
    from: 'console.log(dialogBlockedJsonDoc(blockedMessage, raced.pending));', to: "console.error('mutated');", live: ['cli', 'mut'] },
};

const only = process.argv.slice(2);
for (const [name, m] of Object.entries(MUTATIONS)) {
  if (only.length && !only.includes(name)) continue;
  const file = path.join(root, 'packages', m.pkg, m.file2 ?? m.file);
  const original = fs.readFileSync(file, 'utf8');
  const origSha = sha(file);
  const backup = path.join(here, `.backup-${name}`);
  fs.writeFileSync(backup, original);
  const count = original.split(m.from).length - 1;
  const occ = m.occurrence;
  const rec = { file: path.relative(root, file), matches: count, origSha };
  if (occ ? count < occ : count !== 1) { rec.error = 'mutation anchor not found exactly once'; results[name] = rec; save(); fs.rmSync(backup); continue; }
  try {
    { let idx = -1; for (let k = 0; k < (occ ?? 1); k++) idx = original.indexOf(m.from, idx + 1); fs.writeFileSync(file, original.slice(0, idx) + m.to + original.slice(idx + m.from.length)); }
    rec.build = tsc(m.pkg).status;
    rec.vitest = vitest(m.pkg);
    rec.caughtByVitest = rec.vitest.status !== 0;
    if (m.live && rec.build === 0) {
      const [kind, mode] = m.live;
      const script = kind === 'runtime' ? 'probe-gap262-runtime.mjs' : 'probe-cli.mjs';
      const lr = run(process.execPath, [path.join(here, script), mode, name], here, 900000);
      rec.liveExit = lr.status; rec.liveErr = lr.error;
      const outFile = kind === 'runtime' ? path.join(here, `probe-gap262-runtime-${mode}.json`) : path.join(here, `probe-cli-${mode}-${name}.json`);
      try {
        const j = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        rec.live = kind === 'runtime' ? Object.fromEntries(Object.entries(j.cases).map(([k, v]) => [k, v.map(({ navEvents, ...x }) => x)])) : mode === 'mut' ? j.cases.mut : j.cases.S3_boundary.map((t) => ({ ms: t.alertAtMs, code: t.audit.code, single: t.audit.stdoutIsSingleJson, kind: t.audit.stdoutKind }));
        if (kind === 'runtime') fs.renameSync(outFile, path.join(here, `probe-gap262-runtime-mut-${name}.json`));
      } catch (e) { rec.liveReadErr = String(e); }
    }
  } finally {
    fs.writeFileSync(file, original);
    rec.restoredShaMatches = sha(file) === origSha;
    rec.rebuildAfterRestore = tsc(m.pkg).status;
    fs.rmSync(backup);
    results[name] = rec; save();
    console.log(name, JSON.stringify({ caught: rec.caughtByVitest, tests: rec.vitest?.tests, restored: rec.restoredShaMatches }));
  }
}
