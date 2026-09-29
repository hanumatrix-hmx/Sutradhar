import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { startAuditFixtureServer } from '../../../../../../tools/scenario-suite/fixtures/fr2-12-audit-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..', '..');
const CLI_PATH = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');

function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [CLI_PATH, ...args], { env: { ...process.env, ...opts.env }, cwd: repoRoot });
    let stdout = '', stderr = '';
    cp.stdout.on('data', d => stdout += d.toString('utf8'));
    cp.stderr.on('data', d => stderr += d.toString('utf8'));
    cp.on('close', code => resolve({ code, stdout, stderr }));
  });
}
async function mktemp(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const fixture = await startAuditFixtureServer();
for (const delayMs of [1550, 1560, 1570]) {
  const stateDir = await mktemp('repro268');
  const url = `${fixture.origin}/alert?n=repro&delayMs=${delayMs}`;
  const res = await runCli(['audit', url, '--json'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
  console.log(`\n=== delayMs=${delayMs} EXIT ${res.code} ===`);
  console.log('--- STDOUT ---');
  console.log(res.stdout);
  console.log('--- STDERR ---');
  console.log(res.stderr);
  await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
  await fs.rm(stateDir, { recursive: true, force: true });
}
await fixture.close();
process.exit(0);
