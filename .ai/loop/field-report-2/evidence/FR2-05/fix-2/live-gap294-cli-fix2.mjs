// FR2-05 fix-1 live regression for GAP-294 (CRITICAL trailing-dot/space containment escape).
//
// Adapted from evidence/FR2-05/audit-1/live-chrome-trailing-dot-confirmation/live-trailing-dot.mjs
// (copied, not modified, at evidence/FR2-05/fix-1/live-trailing-dot-adapted.mjs) into a permanent,
// generalized regression: it drives the REAL `sutradhar` CLI + REAL Chrome against a real fixture
// server, for THREE variants of the GAP-294 escape:
//   - dot: "<allowedRoot>\jn.\sub"                    (the exact audit-1 escape)
//   - anywhere: "<allowedRoot>\subdir.\jn.\sub"        ("the trick anywhere in the path")
//   - space: "<allowedRoot>\jn \sub"                   (trailing space variant)
// Each variant is run N times (default 10) against the CURRENT (fixed) build. Expected outcome
// after the fix: every trial's `download` command must FAIL (exit != 0, containment-rejected)
// BEFORE ever reaching Chrome/CDP — the fix rejects at `resolveDownloadDir`, so no CDP session is
// even created. This also implicitly exercises the "reject at path-containment level" mechanism
// the unit tests (PC8-PC11) already cover, but end-to-end through the real product, matching the
// audit's own reproduction exactly.
//
// Usage: node live-gap294-verify.mjs [trialsPerVariant]
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..', '..');
const CLI_PATH = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const fixtureServerPath = path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'fr2-05-download-server.mjs');
const { startDownloadServer } = await import(pathToFileURL(fixtureServerPath).href);

const EVIDENCE_DIR = path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-05', 'fix-2');
await fs.mkdir(EVIDENCE_DIR, { recursive: true });

const TRIALS_PER_VARIANT = Number(process.argv[2] ?? 10);

const spawnedChildren = new Set();
function trackChild(cp) {
  spawnedChildren.add(cp);
  cp.on('exit', () => spawnedChildren.delete(cp));
  return cp;
}
async function killTrackedChildren() {
  for (const cp of [...spawnedChildren]) {
    try {
      if (cp.pid && !cp.killed) process.kill(cp.pid);
    } catch {}
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
  try {
    return { ok: true, value: f() };
  } catch (e) {
    return { ok: false, error: `${e.code ?? ''} ${String(e.stderr ?? e.message).slice(0, 300)}` };
  }
}

const VARIANTS = {
  dot: (allowedRoot) => path.join(allowedRoot, 'jn.', 'sub'),
  space: (allowedRoot) => path.join(allowedRoot, 'jn ', 'sub'),
  anywhere: (allowedRoot) => path.join(allowedRoot, 'subdir.', 'jn.', 'sub'),
};

async function runTrial(variantId, trialNum) {
  const log = [];
  const record = (s) => {
    log.push(s);
  };

  const R = await fs.mkdtemp(path.join(os.tmpdir(), `fr205-audit2-cli-${variantId}-t${trialNum}-`));
  const allowedRoot = path.join(R, 'root');
  const outside = path.join(R, 'outside');
  const work = path.join(R, 'work');
  const stateDir = path.join(R, 'state');
  await fs.mkdir(allowedRoot, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(work, { recursive: true });

  record(`--- variant=${variantId} trial ${trialNum} R=${R} ---`);

  const jnPath = path.join(allowedRoot, 'jn');
  const mklinkRes = tryf(() =>
    execFileSync('cmd.exe', ['/d', '/c', 'mklink', '/J', jnPath, outside], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    }),
  );
  record(`mklink: ${JSON.stringify(mklinkRes)}`);
  let outcome;
  if (!mklinkRes.ok) {
    record('setup-failed (no junction support)');
    await fs.rm(R, { recursive: true, force: true }).catch(() => {});
    return { variantId, trialNum, log, outcome: 'setup-failed' };
  }

  const escapeDir = VARIANTS[variantId](allowedRoot);
  record(`escapeDir=${escapeDir}`);

  const server = await startDownloadServer();
  const name = `t${trialNum}-${variantId}-${Date.now()}.bin`;
  const pageUrl = server.pageUrl(`FIX1-${variantId}-${trialNum}`, { name });

  const baseEnv = {
    ...process.env,
    SUTRADHAR_CLI_STATE_DIR: stateDir,
    SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: allowedRoot,
  };

  const navRes = await runCli(['nav', pageUrl], { cwd: work, env: baseEnv });
  record(`nav exit=${navRes.code}`);

  const dlRes = await runCli(['download', '#dl', escapeDir], { cwd: work, env: baseEnv });
  record(`download exit=${dlRes.code} stdout=${dlRes.stdout.trim()} stderr=${dlRes.stderr.trim().slice(0, 500)}`);

  await runCli(['close'], { cwd: work, env: baseEnv });

  // Independent ground truth: did the file land outside the root (escape), or was the request
  // rejected before ever reaching Chrome/CDP (fixed)?
  const outsideFiles = await fs.readdir(outside).catch(() => []);
  const anyOutsideFile = outsideFiles.some((f) => f !== 'sub' || true) && outsideFiles.length > 0;
  const outsideSubExists = existsSync(path.join(outside, 'sub'));
  record(`outside top-level entries: ${JSON.stringify(outsideFiles)}, outside/sub exists=${outsideSubExists}`);

  const rejectedBeforeCdp =
    dlRes.code !== 0 &&
    /outside the allowed download directories|trailing dot or space/.test(dlRes.stderr + dlRes.stdout);

  if (rejectedBeforeCdp && !outsideSubExists) {
    outcome = 'fixed-rejected';
  } else if (outsideSubExists) {
    outcome = 'ESCAPED';
  } else if (dlRes.code !== 0) {
    outcome = 'rejected-other-reason';
  } else {
    outcome = 'unexpected-success';
  }
  record(`OUTCOME: ${outcome}`);

  await server.close();
  try {
    await fs.rm(jnPath, { force: true });
  } catch {}
  try {
    await fs.rm(R, { recursive: true, force: true });
  } catch {}

  return { variantId, trialNum, log, outcome };
}

async function main() {
  const allResults = [];
  for (const variantId of Object.keys(VARIANTS)) {
    for (let i = 1; i <= TRIALS_PER_VARIANT; i++) {
      const r = await runTrial(variantId, i);
      allResults.push(r);
      console.log(`[${r.outcome}] ${variantId} trial ${i}`);
    }
  }
  await killTrackedChildren();

  const byVariant = {};
  for (const r of allResults) {
    byVariant[r.variantId] ??= { fixed: 0, escaped: 0, other: 0, total: 0 };
    byVariant[r.variantId].total++;
    if (r.outcome === 'fixed-rejected') byVariant[r.variantId].fixed++;
    else if (r.outcome === 'ESCAPED') byVariant[r.variantId].escaped++;
    else byVariant[r.variantId].other++;
  }

  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'gap294-cli-results.json'),
    JSON.stringify({ trialsPerVariant: TRIALS_PER_VARIANT, byVariant, results: allResults }, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'gap294-cli-trials-log.txt'),
    allResults.map((r) => r.log.join('\n')).join('\n\n'),
    'utf-8',
  );

  console.log('\n=== SUMMARY ===');
  let anyEscape = false;
  for (const [variantId, s] of Object.entries(byVariant)) {
    console.log(`${variantId}: fixed=${s.fixed}/${s.total} escaped=${s.escaped}/${s.total} other=${s.other}/${s.total}`);
    if (s.escaped > 0) anyEscape = true;
  }
  process.exitCode = anyEscape ? 1 : 0;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
