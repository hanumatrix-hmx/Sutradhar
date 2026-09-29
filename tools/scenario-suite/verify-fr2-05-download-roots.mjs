// Live-verify script for FR2-05 (download directory / upload roots). See
// .ai/loop/field-report-2/evidence/FR2-05/spec.md §5 for the case list this implements.
//
// Run (after `pnpm build`, or per-package `tsc`, in this worktree):
//   node tools/scenario-suite/verify-fr2-05-download-roots.mjs
//
// Drives the worktree dist only: packages/cli/dist/cli.js, packages/mcp-server/dist/cli.js
// (over stdio), packages/sutradhar/dist/index.js.
import fs from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { startDownloadServer } from './fixtures/fr2-05-download-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_05_EVIDENCE_DIR ??
  path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-05', 'run-1');

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const results = [];
let overallOk = true;

function record(entry) {
  results.push(entry);
  const tag = entry.pass ? 'PASS' : 'FAIL';
  if (!entry.pass) overallOk = false;
  console.log(`[${tag}] ${entry.id}${entry.detail ? ' — ' + entry.detail : ''}`);
}

async function rmWithRetry(dir, attempts = 15) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return true;
    } catch (e) {
      if (i === attempts - 1) {
        console.warn(`[cleanup] could not remove ${dir}: ${e.message}`);
        return false;
      }
      // FR2-05 fix-1 (GAP-299): the CLI/MCP child processes we spawn each launch their own real
      // Chrome subprocess, which can briefly hold a filesystem lock on a file/dir under `dir`
      // even after the CLI/MCP process itself has exited — killTrackedChildren() below now waits
      // for real process exit before this is called, but a laggy Chrome shutdown can still leave
      // a short EBUSY/EPERM window on Windows. Retry longer (15x400ms = 6s) than before (5x300ms
      // = 1.5s), which is what audit-1 found insufficient (3 leftover fr2-05-* dirs from run-1).
      // fix-1's own dogfooding still found occasional empty leftover `<R>/temp` dirs even at
      // 10x300ms=3s (cleared instantly by hand seconds later, consistent with a transient
      // post-exit AV/indexer lock rather than a genuine stuck handle) — 6s gives more margin.
      await delay(400);
    }
  }
}

// ── PID-scoped process bookkeeping (hard rule: never kill by image name) ──────────────────────
const spawnedChildren = new Set();
function trackChild(cp) {
  spawnedChildren.add(cp);
  cp.on('exit', () => spawnedChildren.delete(cp));
  return cp;
}
/**
 * FR2-05 fix-1 (GAP-299): the old version fired `process.kill(pid)` and returned immediately,
 * without ever waiting for the child to actually exit. On Windows, a spawned CLI/MCP process
 * that itself launched a real headless Chrome subprocess can take a moment to tear that
 * subprocess down after receiving the signal — audit-1 found 3 leftover `fr2-05-*` temp dirs
 * from run-1's own executions, i.e. `rmWithRetry`'s 1.5s of total retry time (5 x 300ms) was
 * exhausted while a child (or its own Chrome child) still held a handle inside the temp dir.
 * This now waits, per tracked child, for a real `exit` event (with a bounded timeout), and on
 * win32 escalates to `taskkill /PID <pid> /T /F` (kill the process TREE, so a still-alive Chrome
 * grandchild is also reaped) if the child hasn't exited on its own within that window — always
 * scoped to a PID this script itself spawned, never by image name, per this project's hard
 * process-hygiene rule.
 */
async function killTrackedChildren() {
  const children = [...spawnedChildren];
  await Promise.all(
    children.map(async (cp) => {
      if (!cp.pid || cp.killed || cp.exitCode !== null) return;
      const exited = new Promise((resolve) => cp.once('exit', resolve));
      try {
        process.kill(cp.pid);
      } catch {
        return; // already gone
      }
      const timedOut = await Promise.race([
        exited.then(() => false),
        new Promise((resolve) => setTimeout(() => resolve(true), 3000)),
      ]);
      if (timedOut && process.platform === 'win32') {
        try {
          execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          // already gone, or never existed under that pid anymore
        }
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
      }
    }),
  );
}

async function listProcessesByNeedle(needle) {
  try {
    if (process.platform === 'win32') {
      const script =
        "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
      const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf-8',
        maxBuffer: 32 * 1024 * 1024,
      });
      return out.split('\n').filter((l) => l.includes(needle));
    }
    const out = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
    return out.split('\n').filter((l) => l.includes(needle));
  } catch {
    return []; // never let a failed listing skip cleanup / the final assertion
  }
}

// ── sha256 / check() ────────────────────────────────────────────────────────────────────────
async function sha256File(file) {
  const buf = await fs.readFile(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Independent check: stat/hash the file on disk against the fixture's own `served` ground
 *  truth, and confirm it's really inside `expectedDir` (realpath + case-fold on win32). */
async function check(file, servedEntry, expectedDir) {
  const detail = [];
  let pass = true;
  try {
    const st = await fs.stat(file);
    if (st.size !== servedEntry.size) {
      pass = false;
      detail.push(`size ${st.size} !== served ${servedEntry.size}`);
    }
    const sha = await sha256File(file);
    if (sha !== servedEntry.sha256) {
      pass = false;
      detail.push('sha256 mismatch');
    }
    const realFile = realpathSync.native(file);
    const realDir = realpathSync.native(expectedDir);
    const [a, b] = process.platform === 'win32' ? [realFile.toLowerCase(), realDir.toLowerCase()] : [realFile, realDir];
    if (!(a === b || a.startsWith(b + path.sep))) {
      pass = false;
      detail.push(`${realFile} not inside ${realDir}`);
    }
  } catch (e) {
    pass = false;
    detail.push(`check() error: ${e.message}`);
  }
  return { pass, detail: detail.join('; ') };
}

function lastServedForCase(served, caseId) {
  for (let i = served.length - 1; i >= 0; i--) {
    if (served[i].caseId === String(caseId)) return served[i];
  }
  return undefined;
}

// ── CLI helpers ─────────────────────────────────────────────────────────────────────────────
const CLI_PATH = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');

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

// ── MCP stdio client (copied pattern from verify-fr2-12-audit.mjs / verify-fr2-01-wait-states.mjs)
function makeMcpClient(serverPath, env) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env: env ?? process.env });
  trackChild(child);
  let stdoutBuf = '';
  let nextId = 1;
  const pending = new Map();
  const stderrLog = [];
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    }
  });
  child.stderr.on('data', (d) => stderrLog.push(d.toString('utf8')));

  function call(method, params, timeoutMs = 60000) {
    const id = nextId++;
    const req = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify(req) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for response to ${method} (id=${id})`));
        }
      }, timeoutMs);
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async function callTool(name, args) {
    return call('tools/call', { name, arguments: args });
  }
  return { child, call, notify, callTool, stderrLog };
}
function textOf(result) {
  return result.content?.[0]?.text ?? '';
}
function jsonOf(result) {
  return JSON.parse(textOf(result));
}
async function initMcp(client) {
  await client.call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fr2-05-verify', version: '0.0.0' },
  });
  client.notify('notifications/initialized', {});
}

// ── main ────────────────────────────────────────────────────────────────────────────────────
async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const processBaseline = await listProcessesByNeedle('sutradhar');
  await fs.writeFile(path.join(EVIDENCE_DIR, 'process-baseline.txt'), processBaseline.join('\n'), 'utf-8');

  const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-05-'));
  const work = path.join(R, 'work');
  await fs.mkdir(work, { recursive: true });
  const tempDir = path.join(R, 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  const baseEnv = { ...process.env, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir, SUTRADHAR_CLI_STATE_DIR: path.join(R, 'state') };
  delete baseEnv.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS;
  delete baseEnv.SUTRADHAR_ALLOWED_UPLOAD_ROOTS;
  // Apply the same TEMP/TMP/TMPDIR to this script's own process, since the SDK is imported
  // in-process and reads os.tmpdir() at call time.
  process.env.TEMP = tempDir;
  process.env.TMP = tempDir;
  process.env.TMPDIR = tempDir;

  const server = await startDownloadServer();
  const nonce = Date.now();

  let sdkModule;
  try {
    // ── CLI cases ─────────────────────────────────────────────────────────────────────────
    {
      const name = `l1-${nonce}.bin`;
      await runCli(['nav', server.pageUrl('L1', { name })], { cwd: work, env: baseEnv });
      const res = await runCli(['download', '#dl', './out'], { cwd: work, env: baseEnv });
      const m = res.stdout.match(/^Downloaded "(.+)" to (.+)$/m);
      let pass = res.code === 0 && !!m && path.isAbsolute(m[2]);
      let detail = `exit=${res.code}`;
      if (pass) {
        const expectedDir = path.join(work, 'out');
        const served = lastServedForCase(server.served, 'L1');
        const c = await check(m[2].trim(), served, expectedDir);
        pass = c.pass && m[2].trim() === path.join(expectedDir, served.name);
        detail = c.detail || `path=${m[2]}`;
        const entries = await fs.readdir(expectedDir).catch(() => []);
        if (entries.length !== 1) {
          pass = false;
          detail += `; readdir=${JSON.stringify(entries)}`;
        }
      } else {
        detail += ` stdout=${res.stdout} stderr=${res.stderr}`;
      }
      record({ id: 'L1', pass, detail });
      await runCli(['close'], { cwd: work, env: baseEnv });
    }

    {
      const name = `l2-${nonce}.bin`;
      const absDl = path.join(R, 'abs-dl');
      await runCli(['nav', server.pageUrl('L2', { name })], { cwd: work, env: baseEnv });
      const res = await runCli(['download', '#dl', absDl], { cwd: work, env: baseEnv });
      const m = res.stdout.match(/^Downloaded "(.+)" to (.+)$/m);
      let pass = res.code === 0 && !!m;
      let detail = `exit=${res.code}`;
      if (pass) {
        const served = lastServedForCase(server.served, 'L2');
        const c = await check(m[2].trim(), served, absDl);
        pass = c.pass;
        detail = c.detail || `path=${m[2]}`;
      } else {
        detail += ` stdout=${res.stdout} stderr=${res.stderr}`;
      }
      record({ id: 'L2', pass, detail });
      await runCli(['close'], { cwd: work, env: baseEnv });
    }

    {
      const name = `l3-${nonce}.bin`;
      await runCli(['nav', server.pageUrl('L3', { name })], { cwd: work, env: baseEnv });
      const res = await runCli(['download', '#dl'], { cwd: work, env: baseEnv });
      const m = res.stdout.match(/^Downloaded "(.+)" to (.+)$/m);
      let pass = res.code === 0 && !!m;
      let detail = `exit=${res.code}`;
      if (pass) {
        const expectedDir = path.join(tempDir, 'sutradhar-downloads');
        const served = lastServedForCase(server.served, 'L3');
        const c = await check(m[2].trim(), served, expectedDir);
        pass = c.pass;
        detail = c.detail || `path=${m[2]}`;
      } else {
        detail += ` stdout=${res.stdout} stderr=${res.stderr}`;
      }
      record({ id: 'L3', pass, detail });
      await runCli(['close'], { cwd: work, env: baseEnv });
    }

    {
      const name = `same.bin`;
      await runCli(['nav', server.pageUrl('L4', { name })], { cwd: work, env: baseEnv });
      const res1 = await runCli(['download', '#dl', './out4'], { cwd: work, env: baseEnv });
      const res2 = await runCli(['download', '#dl', './out4'], { cwd: work, env: baseEnv });
      const m1 = res1.stdout.match(/^Downloaded "(.+)" to (.+)$/m);
      const m2 = res2.stdout.match(/^Downloaded "(.+)" to (.+)$/m);
      let pass = res1.code === 0 && res2.code === 0 && !!m1 && !!m2;
      let detail = `exit1=${res1.code} exit2=${res2.code}`;
      if (pass) {
        const served2 = lastServedForCase(server.served, 'L4');
        const c = await check(m2[2].trim(), served2, path.join(work, 'out4'));
        pass = c.pass;
        detail = c.detail || `path2=${m2[2]}`;
      } else {
        detail += ` stdout1=${res1.stdout} stdout2=${res2.stdout}`;
      }
      record({ id: 'L4', pass, detail });
      await runCli(['close'], { cwd: work, env: baseEnv });
    }

    {
      // L5: a following `download` with no dir, in a FRESH process/state, lands in the
      // default root, not `./out` (proves the earlier explicit-dir grant didn't persist).
      const name = `l5-${nonce}.bin`;
      const freshState = path.join(R, 'state-l5');
      const envL5 = { ...baseEnv, SUTRADHAR_CLI_STATE_DIR: freshState };
      await runCli(['nav', server.pageUrl('L5', { name })], { cwd: work, env: envL5 });
      const res = await runCli(['download', '#dl'], { cwd: work, env: envL5 });
      const m = res.stdout.match(/^Downloaded "(.+)" to (.+)$/m);
      let pass = res.code === 0 && !!m;
      let detail = `exit=${res.code}`;
      if (pass) {
        const inOut = m[2].startsWith(path.join(work, 'out'));
        pass = !inOut;
        detail = inOut ? `unexpectedly landed in ./out: ${m[2]}` : `path=${m[2]}`;
      } else {
        detail += ` stdout=${res.stdout} stderr=${res.stderr}`;
      }
      record({ id: 'L5', pass, detail });
      await runCli(['close'], { cwd: work, env: envL5 });
    }

    {
      const name = `l6-${nonce}.bin`;
      const cliEnvRoot = path.join(R, 'cli-env');
      const envL6 = { ...baseEnv, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: cliEnvRoot };
      await runCli(['nav', server.pageUrl('L6', { name })], { cwd: work, env: envL6 });
      const res = await runCli(['download', '#dl'], { cwd: work, env: envL6 });
      const m = res.stdout.match(/^Downloaded "(.+)" to (.+)$/m);
      let pass = res.code === 0 && !!m;
      let detail = `exit=${res.code}`;
      if (pass) {
        const served = lastServedForCase(server.served, 'L6');
        const c = await check(m[2].trim(), served, cliEnvRoot);
        pass = c.pass;
        detail = c.detail || `path=${m[2]}`;
      } else {
        detail += ` stdout=${res.stdout} stderr=${res.stderr}`;
      }
      record({ id: 'L6', pass, detail });
      await runCli(['close'], { cwd: work, env: envL6 });
    }

    {
      const afile = path.join(work, 'afile');
      await fs.writeFile(afile, 'unchanged');
      const before = await fs.readFile(afile, 'utf-8');
      await runCli(['nav', server.pageUrl('L7', { name: `l7-${nonce}.bin` })], { cwd: work, env: baseEnv });
      const res = await runCli(['download', '#dl', './afile'], { cwd: work, env: baseEnv });
      const after = await fs.readFile(afile, 'utf-8');
      const pass = res.code !== 0 && /not a directory/.test(res.stdout + res.stderr) && after === before;
      record({ id: 'L7', pass, detail: `exit=${res.code} stdout=${res.stdout} stderr=${res.stderr}` });
      await runCli(['close'], { cwd: work, env: baseEnv });
    }

    {
      const res = await runCli(['close'], { cwd: work, env: baseEnv });
      record({ id: 'L8', pass: res.code === 0, detail: `exit=${res.code}` });
    }

    // ── MCP A (download roots) ────────────────────────────────────────────────────────────
    const allowA = path.join(R, 'allowA');
    const allowB = path.join(R, 'allowB');
    const mcpAEnv = {
      ...baseEnv,
      SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: [allowA, allowB].join(path.delimiter),
    };
    const MCP_PATH = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
    {
      const client = makeMcpClient(MCP_PATH, mcpAEnv);
      try {
        await initMcp(client);
        const launch = jsonOf(await client.callTool('browser.launch', {}));
        const sessionId = launch.sessionId;

        // M1
        {
          const name = `m1-${nonce}.bin`;
          await client.callTool('browser.navigate', { sessionId, url: server.pageUrl('M1', { name }) });
          const dir = path.join(allowB, 'sub');
          const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: dir }));
          let pass = r.success === true;
          let detail = JSON.stringify(r).slice(0, 300);
          if (pass) {
            const served = lastServedForCase(server.served, 'M1');
            const c = await check(r.output.downloadedPath, served, dir);
            pass = c.pass;
            detail = c.detail || r.output.downloadedPath;
          }
          record({ id: 'M1', pass, detail });
        }

        // M2 (fresh navigation resets the duplicate-action guard's per-tab memory of #dl)
        await delay(1100);
        {
          const name = `m2-${nonce}.bin`;
          await client.callTool('browser.navigate', { sessionId, url: server.pageUrl('M2', { name }) });
          const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl' }));
          let pass = r.success === true && String(r.output?.downloadedPath ?? '').startsWith(allowA);
          record({ id: 'M2', pass, detail: JSON.stringify(r).slice(0, 300) });
        }

        // M3
        await delay(1100);
        {
          const outsideDir = path.join(R, 'outside');
          const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: outsideDir }));
          const errText = r.error ?? '';
          const pass =
            r.success === false &&
            errText.includes('outside the allowed download directories') &&
            errText.includes(allowA) &&
            errText.includes('Hint:') &&
            errText.includes('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS') &&
            !existsSync(outsideDir);
          record({ id: 'M3', pass, detail: errText.slice(0, 300) });
        }

        // M4
        await delay(1100);
        {
          const dir = path.join(tempDir, 'sutradhar-downloads', 'x');
          const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: dir }));
          record({ id: 'M4', pass: r.success === false, detail: JSON.stringify(r).slice(0, 200) });
        }

        await client.callTool('browser.shutdown_all', {});
      } finally {
        client.child.stdin.end();
        await Promise.race([new Promise((r) => client.child.once('exit', r)), delay(10000)]);
        if (!client.child.killed) client.child.kill();
      }
    }

    // ── MCP B (upload roots on) ───────────────────────────────────────────────────────────
    const upRoot = path.join(R, 'up');
    await fs.mkdir(upRoot, { recursive: true });
    const elsewhere = path.join(R, 'elsewhere');
    await fs.mkdir(elsewhere, { recursive: true });
    await fs.writeFile(path.join(upRoot, 'a.txt'), 'hello-a');
    await fs.writeFile(path.join(elsewhere, 'b.txt'), 'hello-b');
    const mcpBEnv = { ...baseEnv, SUTRADHAR_ALLOWED_UPLOAD_ROOTS: upRoot };
    {
      const client = makeMcpClient(MCP_PATH, mcpBEnv);
      try {
        await initMcp(client);
        const launch = jsonOf(await client.callTool('browser.launch', {}));
        const sessionId = launch.sessionId;
        await client.callTool('browser.navigate', { sessionId, url: server.pageUrl('M5', {}) });

        {
          const r = jsonOf(await client.callTool('browser.upload_file', { sessionId, target: '#f', filePath: path.join(upRoot, 'a.txt') }));
          let pass = r.success === true;
          if (pass) {
            const evalRes = jsonOf(await client.callTool('browser.eval', { sessionId, code: "document.getElementById('out').textContent" }));
            pass = evalRes?.result === 'a.txt:7' || String(evalRes?.result ?? '').startsWith('a.txt:');
          }
          record({ id: 'M5', pass, detail: JSON.stringify(r).slice(0, 200) });
        }

        await delay(1100);
        {
          const r = jsonOf(await client.callTool('browser.upload_file', { sessionId, target: '#f', filePath: path.join(elsewhere, 'b.txt') }));
          const errText = r.error ?? '';
          const pass = r.success === false && errText.includes('outside the allowed upload directories') && errText.includes('Hint:');
          record({ id: 'M6', pass, detail: errText.slice(0, 200) });
        }

        {
          const r = await client.callTool('browser.upload_file_via_trigger', { sessionId, target: '#pick', filePath: path.join(elsewhere, 'b.txt') });
          const text = textOf(r);
          const pass = r.isError === true && text.includes('outside the allowed upload directories');
          record({ id: 'M7', pass, detail: text.slice(0, 200) });
        }

        await client.callTool('browser.shutdown_all', {});
      } finally {
        client.child.stdin.end();
        await Promise.race([new Promise((r) => client.child.once('exit', r)), delay(10000)]);
        if (!client.child.killed) client.child.kill();
      }
    }

    // ── MCP C (no env — default preserved) ────────────────────────────────────────────────
    {
      const client = makeMcpClient(MCP_PATH, baseEnv);
      try {
        await initMcp(client);
        const launch = jsonOf(await client.callTool('browser.launch', {}));
        const sessionId = launch.sessionId;

        {
          const name = `m8-${nonce}.bin`;
          await client.callTool('browser.navigate', { sessionId, url: server.pageUrl('M8', { name }) });
          const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl' }));
          let pass = r.success === true;
          if (pass) {
            const expectedDir = path.join(tempDir, 'sutradhar-downloads');
            const served = lastServedForCase(server.served, 'M8');
            const c = await check(r.output.downloadedPath, served, expectedDir);
            pass = c.pass;
          }
          record({ id: 'M8', pass, detail: JSON.stringify(r).slice(0, 200) });
        }

        await delay(1100);
        {
          const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: path.join(R, 'abs') }));
          record({ id: 'M9', pass: r.success === false, detail: JSON.stringify(r).slice(0, 200) });
        }

        {
          const r = jsonOf(await client.callTool('browser.upload_file', { sessionId, target: '#f', filePath: path.join(elsewhere, 'b.txt') }));
          record({ id: 'M10', pass: r.success === true, detail: JSON.stringify(r).slice(0, 200) });
        }

        await client.callTool('browser.shutdown_all', {});
      } finally {
        client.child.stdin.end();
        await Promise.race([new Promise((r) => client.child.once('exit', r)), delay(10000)]);
        if (!client.child.killed) client.child.kill();
      }
    }

    // ── MCP D (bad env) ────────────────────────────────────────────────────────────────────
    {
      const badEnv = { ...baseEnv, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: 'out' };
      const client = makeMcpClient(MCP_PATH, badEnv);
      const exited = await Promise.race([
        new Promise((resolve) => client.child.once('exit', (code) => resolve({ exited: true, code }))),
        delay(10000).then(() => ({ exited: false })),
      ]);
      const stderrText = client.stderrLog.join('');
      const pass =
        exited.exited === true &&
        exited.code !== 0 &&
        stderrText.includes('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS') &&
        stderrText.includes('absolute');
      record({ id: 'M-bad-env', pass, detail: `exited=${JSON.stringify(exited)} stderr=${stderrText.slice(0, 300)}` });
      if (!client.child.killed) client.child.kill();
    }

    // ── SDK ────────────────────────────────────────────────────────────────────────────────
    const SDK_PATH = pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')).href;
    sdkModule = await import(SDK_PATH);
    {
      const sdkRoot = path.join(R, 'sdk');
      const upRootSdk = upRoot;
      const browser = await sdkModule.launch({ allowedDownloadRoots: [sdkRoot], allowedUploadRoots: [upRootSdk] });
      try {
        const page = await browser.newPage(server.pageUrl('S1', { name: `s1-${nonce}.bin` }));

        {
          const r = await page.download('#dl');
          const served = lastServedForCase(server.served, 'S1');
          const c = await check(r.path, served, sdkRoot);
          record({ id: 'S1-download', pass: c.pass, detail: c.detail || r.path });
        }

        await delay(1100); // clear the duplicate-action guard's 1s window for the same #dl target
        {
          let threw = false;
          let msg = '';
          try {
            await page.download('#dl', { downloadDir: path.join(R, 'outside-sdk') });
          } catch (e) {
            msg = e.message;
            threw = /outside the allowed download directories/.test(e.message);
          }
          record({ id: 'S1-download-outside', pass: threw, detail: msg.slice(0, 200) });
        }

        {
          let threw = false;
          try {
            await page.uploadFile('#f', path.join(elsewhere, 'b.txt'));
          } catch (e) {
            threw = /outside the allowed upload directories/.test(e.message);
          }
          record({ id: 'S1-upload-outside', pass: threw });
        }

        {
          let ok = true;
          try {
            await page.uploadFile('#f', path.join(upRootSdk, 'a.txt'));
          } catch {
            ok = false;
          }
          record({ id: 'S1-upload-ok', pass: ok });
        }
      } finally {
        await browser.close();
      }
    }

    {
      const envRoot = path.join(R, 'envroot');
      process.env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS = envRoot;
      const browser = await sdkModule.launch();
      try {
        const page = await browser.newPage(server.pageUrl('S2', { name: `s2-${nonce}.bin` }));
        const r = await page.download('#dl');
        const expectedDir = path.join(tempDir, 'sutradhar-downloads');
        const served = lastServedForCase(server.served, 'S2');
        const c = await check(r.path, served, expectedDir);
        const envRootMissing = !existsSync(envRoot);
        record({ id: 'S2', pass: c.pass && envRootMissing, detail: c.detail || `envRootMissing=${envRootMissing}` });
      } finally {
        await browser.close();
        delete process.env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS;
      }
    }
  } catch (e) {
    record({ id: 'FATAL', pass: false, detail: e.stack ?? String(e) });
  } finally {
    await killTrackedChildren();
    await server.close();

    // Unlink any junction/symlink first (none created in the live-verify itself — those live in
    // unit tests — but this stays defensive per the spec's cleanup order).
    await rmWithRetry(R);

    const processAfter = await listProcessesByNeedle('sutradhar');
    const stillRunning = processAfter.filter((l) => l.includes(R));
    await fs.writeFile(path.join(EVIDENCE_DIR, 'process-after.txt'), processAfter.join('\n'), 'utf-8');
    record({ id: 'no-leaked-processes', pass: stillRunning.length === 0, detail: `count=${stillRunning.length}` });

    await fs.writeFile(path.join(EVIDENCE_DIR, 'live-verify.json'), JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed. Evidence: ${EVIDENCE_DIR}`);
    process.exitCode = overallOk ? 0 : 1;
  }
}

main();
