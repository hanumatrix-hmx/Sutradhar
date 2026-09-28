// Live test: does browser.download_file (real Chrome via CDP) follow a trailing-dot junction
// escape ("<allowedRoot>\jn.\subdir") the way plain Win32 CreateDirectoryW does?
//
// Setup per trial:
//   R = mkdtemp
//   allowedRoot = R/root      (the SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS root, passed to CLI)
//   outside     = R/outside   (OUTSIDE allowedRoot)
//   junction: allowedRoot/jn -> outside (mklink /J)
//   download target dir requested: allowedRoot/jn./sub   (literal trailing dot after "jn")
//
// Then: sutradhar nav <fixture-page>; sutradhar download #dl "<allowedRoot>\jn.\sub"
// Then check both allowedRoot/jn./sub (or allowedRoot/jn/sub) and outside/sub for the file.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = 'E:\\HMX_Projects\\Internal_Projects\\PinchTab\\.claude\\worktrees\\project-understanding-696041';
const CLI_PATH = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const fixtureServerPath = path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'fr2-05-download-server.mjs');
const { startDownloadServer } = await import(pathToFileURL(fixtureServerPath).href);

const EVIDENCE_DIR = path.join(
  repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-05', 'audit-1',
  'live-chrome-trailing-dot-confirmation',
);
await fs.mkdir(EVIDENCE_DIR, { recursive: true });

const spawnedChildren = new Set();
function trackChild(cp) {
  spawnedChildren.add(cp);
  cp.on('exit', () => spawnedChildren.delete(cp));
  return cp;
}
async function killTrackedChildren() {
  for (const cp of [...spawnedChildren]) {
    try { if (cp.pid && !cp.killed) process.kill(cp.pid); } catch {}
  }
}

function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd ?? repoRoot,
    });
    trackChild(cp);
    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    cp.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    cp.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function tryf(f) {
  try { return { ok: true, value: f() }; } catch (e) {
    return { ok: false, error: `${e.code ?? ''} ${String(e.stderr ?? e.message).slice(0, 300)}` };
  }
}

async function listDirSafe(p) {
  try {
    const entries = await fs.readdir(p, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) {
        out.push(`${e.name}/`);
        const sub = await listDirSafe(full);
        for (const s of sub) out.push(`  ${s}`);
      } else {
        const st = await fs.stat(full).catch(() => null);
        out.push(`${e.name} (${st ? st.size : '?'} bytes)`);
      }
    }
    return out;
  } catch (e) {
    return [`<error: ${e.message}>`];
  }
}

async function runTrial(trialNum) {
  const log = [];
  const record = (s) => { log.push(s); console.log(s); };

  const R = await fs.mkdtemp(path.join(os.tmpdir(), `fr205-live-t${trialNum}-`));
  const allowedRoot = path.join(R, 'root');
  const outside = path.join(R, 'outside');
  const work = path.join(R, 'work');
  const stateDir = path.join(R, 'state');
  await fs.mkdir(allowedRoot, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(work, { recursive: true });

  record(`--- Trial ${trialNum} ---`);
  record(`R=${R}`);
  record(`allowedRoot=${allowedRoot}`);
  record(`outside=${outside}`);

  // Create real junction: allowedRoot/jn -> outside
  const jnPath = path.join(allowedRoot, 'jn');
  const mklinkRes = tryf(() =>
    execFileSync('cmd.exe', ['/d', '/c', 'mklink', '/J', jnPath, outside], { encoding: 'utf8', windowsVerbatimArguments: true }),
  );
  record(`mklink result: ${JSON.stringify(mklinkRes)}`);
  if (!mklinkRes.ok) {
    record('FATAL: could not create junction, aborting trial');
    await fs.rm(R, { recursive: true, force: true }).catch(() => {});
    return { trialNum, log, outcome: 'setup-failed' };
  }

  // The trailing-dot escape path: allowedRoot\jn.\sub
  const escapeDir = path.join(allowedRoot, 'jn.', 'sub'); // path.join normalizes? check literal
  // path.join / path.win32.join does NOT strip trailing dots from a component (verified below);
  // it only collapses '.' as a whole segment (dot-segment), not 'jn.' which is not exactly '.'.
  record(`escapeDir (as constructed) = ${escapeDir}`);

  const server = await startDownloadServer();
  const name = `trial${trialNum}-${Date.now()}.bin`;
  const pageUrl = server.pageUrl(`T${trialNum}`, { name });

  const baseEnv = {
    ...process.env,
    SUTRADHAR_CLI_STATE_DIR: stateDir,
    SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: allowedRoot,
  };

  record(`nav to ${pageUrl}`);
  const navRes = await runCli(['nav', pageUrl], { cwd: work, env: baseEnv });
  record(`nav exit=${navRes.code} stdout=${navRes.stdout.trim()} stderr=${navRes.stderr.trim().slice(0, 500)}`);

  record(`download #dl "${escapeDir}"`);
  const dlRes = await runCli(['download', '#dl', escapeDir], { cwd: work, env: baseEnv });
  record(`download exit=${dlRes.code}`);
  record(`download stdout=${dlRes.stdout.trim()}`);
  record(`download stderr=${dlRes.stderr.trim().slice(0, 2000)}`);

  await runCli(['close'], { cwd: work, env: baseEnv });

  // Inspect both locations
  record('--- allowedRoot tree (post) ---');
  for (const l of await listDirSafe(allowedRoot)) record(l);
  record('--- outside tree (post) ---');
  for (const l of await listDirSafe(outside)) record(l);

  // Determine outcome
  const servedEntry = server.served.filter((s) => s.caseId === `T${trialNum}`).pop();
  record(`served entry: ${JSON.stringify(servedEntry)}`);

  let outcome = 'unknown';
  const m = dlRes.stdout.match(/^Downloaded "(.+)" to (.+)$/m);
  if (dlRes.code !== 0 || !m) {
    outcome = 'c-failed';
  } else {
    const reportedPath = m[2].trim();
    record(`reportedPath=${reportedPath}`);

    async function sha256File(f) {
      const buf = await fs.readFile(f);
      return crypto.createHash('sha256').update(buf).digest('hex');
    }

    // The literal path Chrome/CLI reported may not be realpath-able (Node's own realpath does
    // NOT strip the trailing dot the way Win32 CreateDirectoryW does — same asymmetry the audit
    // found). So check both real candidate physical locations directly by filename, independent
    // of what the CLI printed.
    const literalCandidate = reportedPath; // allowedRoot\jn.\sub\<name>
    const outsideCandidate = path.join(outside, 'sub', servedEntry?.name ?? name);
    const allowedLiteralJnDotCandidate = path.join(allowedRoot, 'jn.', 'sub', servedEntry?.name ?? name);
    const allowedJnCandidate = path.join(allowedRoot, 'jn', 'sub', servedEntry?.name ?? name); // via junction, same as outsideCandidate physically but different spelling

    const existsLiteral = existsSync(literalCandidate);
    const existsOutside = existsSync(outsideCandidate);
    const existsAllowedLiteralDot = existsSync(allowedLiteralJnDotCandidate);
    record(`existsSync(literal reported path)=${existsLiteral}`);
    record(`existsSync(outside/sub/<name>)=${existsOutside}`);
    record(`existsSync(allowedRoot/jn.<literal>/sub/<name>)=${existsAllowedLiteralDot}`);

    let hashMatchOutside = false;
    if (existsOutside && servedEntry) {
      const sha = await sha256File(outsideCandidate);
      hashMatchOutside = sha === servedEntry.sha256;
      record(`sha256(outside candidate)=${sha} servedSha256=${servedEntry.sha256} match=${hashMatchOutside}`);
    }

    // Ground truth: does allowedRoot itself (walked WITHOUT following into jn/jn.) contain any
    // new file at all? We already dumped the tree above (listDirSafe follows dirs including
    // junctions since fs.stat follows the link — so "allowedRoot tree" also shows what's behind
    // jn/jn.). Rely on the literal, no-symlink-following distinction instead: does a plain
    // fs.readdir on allowedRoot (non-recursive) show any entry besides "jn"?
    const allowedTopLevel = await fs.readdir(allowedRoot).catch(() => []);
    record(`allowedRoot top-level entries (literal, no dot-file created): ${JSON.stringify(allowedTopLevel)}`);
    const dotEntryCreated = allowedTopLevel.some((e) => e.toLowerCase() === 'jn.');

    if (existsOutside && hashMatchOutside && !dotEntryCreated) {
      outcome = 'b-escaped';
    } else if (dotEntryCreated) {
      outcome = 'a-safe (Chrome created a literal "jn." entry, did not follow the junction)';
    } else if (!existsLiteral && !existsOutside) {
      outcome = 'c-failed (file not found in either location)';
    } else {
      outcome = 'ambiguous';
    }
  }

  record(`OUTCOME for trial ${trialNum}: ${outcome}`);

  await server.close();
  // cleanup: remove junction first (not recursively, to avoid deleting outside's real contents
  // through the link), then remove R.
  try { await fs.rm(jnPath, { force: true }); } catch (e) { record(`cleanup jn rm warn: ${e.message}`); }
  try { await fs.rm(R, { recursive: true, force: true }); } catch (e) { record(`cleanup R warn: ${e.message}`); }
  record(`R removed: ${!existsSync(R)}`);

  return { trialNum, log, outcome };
}

async function main() {
  const allResults = [];
  for (let i = 1; i <= 3; i++) {
    const r = await runTrial(i);
    allResults.push(r);
  }
  await killTrackedChildren();

  const fullLog = allResults.map((r) => r.log.join('\n')).join('\n\n');
  await fs.writeFile(path.join(EVIDENCE_DIR, 'trials-log.txt'), fullLog, 'utf-8');
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'outcomes.json'),
    JSON.stringify(allResults.map((r) => ({ trial: r.trialNum, outcome: r.outcome })), null, 2),
    'utf-8',
  );
  console.log('=== SUMMARY ===');
  for (const r of allResults) console.log(`trial ${r.trialNum}: ${r.outcome}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
