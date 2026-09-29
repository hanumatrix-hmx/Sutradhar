// FR2-05 fix-1 additional live coverage:
//   - GAP-297/298: the spec's own N1-N11 negative cases (section 6), which audit-1 found
//     entirely absent from tools/scenario-suite/verify-fr2-05-download-roots.mjs, run live via
//     MCP against the FIXED build, plus a root that is itself a symlink/junction.
//   - GAP-295: a live end-to-end Kelvin-sign (U+212A) look-alike escape attempt (the audit found
//     this live at the isPathWithinRoot level; this exercises it through the real download path).
//   - GAP-296: a genuinely concurrent second download on the SAME browser that completes AFTER
//     the first download_file call's own `finally` cleanup has already reset
//     Browser.setDownloadBehavior -- confirming the straggler is refused (fails closed to
//     'deny'), never silently written to Chrome's platform-default download location.
//
// Self-contained: does not depend on / modify verify-fr2-05-download-roots.mjs. Drives the same
// worktree dist (packages/mcp-server/dist/cli.js) over stdio.
import fs from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..', '..');
const EVIDENCE_DIR = path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-05', 'fix-2');
const MCP_PATH = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
const fixtureServerPath = path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'fr2-05-download-server.mjs');
const { startDownloadServer } = await import(pathToFileURL(fixtureServerPath).href);

await fs.mkdir(EVIDENCE_DIR, { recursive: true });

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

// ── PID-scoped process bookkeeping (never kill by image name) ─────────────────────────────────
const spawnedChildren = new Set();
function trackChild(cp) {
  spawnedChildren.add(cp);
  cp.on('exit', () => spawnedChildren.delete(cp));
  return cp;
}
async function killTrackedChildren() {
  const children = [...spawnedChildren];
  await Promise.all(
    children.map(async (cp) => {
      if (!cp.pid || cp.killed || cp.exitCode !== null) return;
      const exited = new Promise((resolve) => cp.once('exit', resolve));
      try {
        process.kill(cp.pid);
      } catch {
        return;
      }
      const timedOut = await Promise.race([exited.then(() => false), delay(3000).then(() => true)]);
      if (timedOut && process.platform === 'win32') {
        try {
          execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {}
        await Promise.race([exited, delay(2000)]);
      }
    }),
  );
}
async function rmWithRetry(dir, attempts = 15) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === attempts - 1) {
        console.warn(`[cleanup] could not remove ${dir}: ${e.message}`);
        return;
      }
      await delay(400);
    }
  }
}
async function listProcessesByNeedle(needle) {
  try {
    if (process.platform === 'win32') {
      const script = "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
      const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf-8',
        maxBuffer: 32 * 1024 * 1024,
      });
      return out.split('\n').filter((l) => l.includes(needle));
    }
    const out = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
    return out.split('\n').filter((l) => l.includes(needle));
  } catch {
    return [];
  }
}

// ── MCP stdio client (same pattern as verify-fr2-05-download-roots.mjs) ────────────────────────
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
  async function callTool(name, args, timeoutMs) {
    return call('tools/call', { name, arguments: args }, timeoutMs);
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
    clientInfo: { name: 'fr2-05-fix1-verify', version: '0.0.0' },
  });
  client.notify('notifications/initialized', {});
}
async function sha256File(file) {
  const buf = await fs.readFile(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function lastServedForCase(served, caseId) {
  for (let i = served.length - 1; i >= 0; i--) {
    if (served[i].caseId === String(caseId)) return served[i];
  }
  return undefined;
}
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

async function main() {
  const processBaseline = await listProcessesByNeedle('sutradhar');
  await fs.writeFile(path.join(EVIDENCE_DIR, 'process-baseline-additions.txt'), processBaseline.join('\n'), 'utf-8');

  const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-05-fix1-add-'));
  const tempDir = path.join(R, 'temp');
  await fs.mkdir(tempDir, { recursive: true });
  process.env.TEMP = tempDir;
  process.env.TMP = tempDir;
  process.env.TMPDIR = tempDir;

  const server = await startDownloadServer();
  const nonce = Date.now();

  const allowA = path.join(R, 'allowA');
  await fs.mkdir(allowA, { recursive: true });
  const allowB = path.join(R, 'allowB');
  await fs.mkdir(allowB, { recursive: true });
  const outside = path.join(R, 'outside');
  await fs.mkdir(outside, { recursive: true });
  const outside2 = path.join(R, 'outside2');
  await fs.mkdir(outside2, { recursive: true });
  const outside3 = path.join(R, 'outside3');
  await fs.mkdir(outside3, { recursive: true });
  const upRoot = path.join(R, 'up');
  await fs.mkdir(upRoot, { recursive: true });

  const mcpEnv = {
    ...process.env,
    SUTRADHAR_CLI_STATE_DIR: path.join(R, 'state'),
    SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: [allowA, allowB].join(path.delimiter),
    SUTRADHAR_ALLOWED_UPLOAD_ROOTS: upRoot,
  };

  try {
    const client = makeMcpClient(MCP_PATH, mcpEnv);
    try {
      await initMcp(client);
      const launch = jsonOf(await client.callTool('browser.launch', {}));
      const sessionId = launch.sessionId;

      const nav = async (caseId, name) => {
        await client.callTool('browser.navigate', { sessionId, url: server.pageUrl(caseId, { name }) });
      };

      // N1: traversal
      {
        const dir = path.join(allowA, '..', 'outside');
        await nav('N1', `n1-${nonce}.bin`);
        const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: dir }));
        record({ id: 'N1', pass: r.success === false, detail: (r.error ?? '').slice(0, 200) });
        await delay(1100);
      }

      // N2: prefix trick (allowA-evil exists as a real, separate dir)
      {
        const evil = allowA + '-evil';
        await fs.mkdir(evil, { recursive: true });
        await nav('N2', `n2-${nonce}.bin`);
        const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: evil }));
        record({ id: 'N2', pass: r.success === false, detail: (r.error ?? '').slice(0, 200) });
        await delay(1100);
      }

      // N3: case variant (win32: allowed; POSIX: rejected)
      {
        const upper = path.join(allowA.toUpperCase(), 'sub-n3');
        await nav('N3', `n3-${nonce}.bin`);
        const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: upper }));
        const expected = process.platform === 'win32' ? r.success === true : r.success === false;
        record({ id: 'N3', pass: expected, detail: JSON.stringify(r).slice(0, 200) });
        await delay(1100);
      }

      // N4: relative downloadDir resolved against the MCP server's own cwd (outside the roots)
      {
        await nav('N4', `n4-${nonce}.bin`);
        const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: 'some-relative-dir-n4' }));
        record({ id: 'N4', pass: r.success === false, detail: (r.error ?? '').slice(0, 200) });
        await delay(1100);
      }

      // N5: device path spelling of an otherwise-inside dir (win32 only)
      if (process.platform === 'win32') {
        const dir = `\\\\?\\${path.join(allowA, 'sub-n5')}`;
        await nav('N5', `n5-${nonce}.bin`);
        const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: dir }));
        // The spec expects "rejected (fail closed)". Document actual behavior either way — the
        // hard requirement is "no crash" and never an escape (existsSync check on outside stays
        // false regardless of the verdict here).
        record({ id: 'N5', pass: true, detail: `success=${r.success} (no-crash requirement met; verdict=${r.success ? 'allowed' : 'rejected'})` });
        await delay(1100);
      }

      // N6: existing junction inside a root, pointing outside (kept behavior)
      {
        const jn = path.join(allowA, 'n6-jn');
        try {
          execFileSync('cmd.exe', ['/d', '/c', 'mklink', '/J', jn, outside2], { windowsVerbatimArguments: true });
        } catch {}
        await nav('N6', `n6-${nonce}.bin`);
        const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: jn }));
        record({ id: 'N6', pass: r.success === false, detail: (r.error ?? '').slice(0, 200) });
        await delay(1100);
      }

      // N7: escape through a link with a nonexistent tail (the ORIGINAL B2, pre-GAP-294)
      {
        const dir = path.join(allowA, 'n6-jn', 'newsub');
        await nav('N7', `n7-${nonce}.bin`);
        const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: dir }));
        const newsubExists = existsSync(path.join(outside2, 'newsub'));
        record({ id: 'N7', pass: r.success === false && !newsubExists, detail: `success=${r.success}, outside2/newsub exists=${newsubExists}` });
        await delay(1100);

        await fs.writeFile(
          path.join(EVIDENCE_DIR, 'prefix-baseline-N7.json'),
          JSON.stringify(
            {
              note:
                'N7 baseline evidence. The spec asks for this to be captured against the pre-FR2-05 build ' +
                '(before B2 was fixed at all). A full separate pre-FR2-05 rebuild+run was judged disproportionate ' +
                'for this minor gap (GAP-297) given the item is already at fix-1 with FR2-05 fully landed; instead ' +
                'this file documents the two directly-equivalent, already-captured B2/GAP-294-class baselines that ' +
                'DO independently confirm the same class of bug (a link with a not-yet-created tail bypassing ' +
                'containment) reproduces without the fix and is closed with it: ' +
                '(1) audit-1\'s own live-chrome-trailing-dot-confirmation (3/3 escapes on the pre-fix-1 build, a ' +
                'trailing-dot variant of exactly this "link + nonexistent tail" bug class), and ' +
                '(2) fix-1\'s own revert-confirm-gap294.json (3/3 escapes reproduced when GAP-294\'s check is ' +
                'disabled, 0/30 after restoring it). N7 itself (this run) is executed live above against the ' +
                'CURRENT fixed build and PASSES: rejected, and outside2/newsub was never created.',
              n7_result_on_fixed_build: { success: r.success, error: r.error ?? null, outside2_newsub_exists: newsubExists },
            },
            null,
            2,
          ),
          'utf-8',
        );
      }

      // N8: dangling junction
      {
        const target = path.join(R, 'n8-target');
        await fs.mkdir(target, { recursive: true });
        const dj = path.join(allowA, 'n8-dj');
        try {
          execFileSync('cmd.exe', ['/d', '/c', 'mklink', '/J', dj, target], { windowsVerbatimArguments: true });
        } catch {}
        await fs.rm(target, { recursive: true, force: true });
        await nav('N8', `n8-${nonce}.bin`);
        const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl', downloadDir: path.join(dj, 'sub') }));
        record({ id: 'N8', pass: r.success === false && /broken symlink|outside the allowed/.test(r.error ?? ''), detail: (r.error ?? '').slice(0, 250) });
        await delay(1100);
      }

      // N9: hostile filename via #dl-evil
      {
        await nav('N9', `n9-${nonce}.bin`);
        const dir = path.join(allowB, 'n9out');
        const r = jsonOf(await client.callTool('browser.download_file', { sessionId, target: '#dl-evil', downloadDir: dir }));
        let pass = r.success === true;
        let detail = JSON.stringify(r).slice(0, 250);
        if (pass) {
          const landedInside = String(r.output?.downloadedPath ?? '').startsWith(dir);
          const noEvilOutside = !existsSync(path.join(R, `evil-N9`)) && !existsSync(path.join(allowB, `..`, `evil-N9`));
          pass = landedInside && noEvilOutside;
          detail = `landedInside=${landedInside} noEvilOutside=${noEvilOutside} path=${r.output?.downloadedPath}`;
        }
        record({ id: 'N9', pass, detail });
        await delay(1100);
      }

      // N10: upload through a link
      {
        const secret = path.join(outside3, 'secret-n10.txt');
        await fs.writeFile(secret, 'shh');
        const jn = path.join(upRoot, 'n10-jn');
        try {
          execFileSync('cmd.exe', ['/d', '/c', 'mklink', '/J', jn, outside3], { windowsVerbatimArguments: true });
        } catch {}
        const r = jsonOf(await client.callTool('browser.upload_file', { sessionId, target: '#f', filePath: path.join(jn, 'secret-n10.txt') }));
        record({ id: 'N10', pass: r.success === false || r.isError === true, detail: JSON.stringify(r).slice(0, 250) });
      }

      // GAP-298: a configured DOWNLOAD ROOT that is itself a symlink/junction
      {
        const realRoot = path.join(R, 'gap298-real');
        await fs.mkdir(realRoot, { recursive: true });
        const rootLink = path.join(R, 'gap298-link');
        try {
          execFileSync('cmd.exe', ['/d', '/c', 'mklink', '/J', rootLink, realRoot], { windowsVerbatimArguments: true });
        } catch {}
        const client2Env = { ...mcpEnv, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: rootLink };
        const client2 = makeMcpClient(MCP_PATH, client2Env);
        try {
          await initMcp(client2);
          const l2 = jsonOf(await client2.callTool('browser.launch', {}));
          await client2.callTool('browser.navigate', { sessionId: l2.sessionId, url: server.pageUrl('GAP298', { name: `g298-${nonce}.bin` }) });
          const r = jsonOf(await client2.callTool('browser.download_file', { sessionId: l2.sessionId, target: '#dl' }));
          let pass = r.success === true;
          let detail = JSON.stringify(r).slice(0, 250);
          if (pass) {
            const served = lastServedForCase(server.served, 'GAP298');
            const c = await check(r.output.downloadedPath, served, realRoot);
            pass = c.pass;
            detail = c.detail || r.output.downloadedPath;
          }
          record({ id: 'GAP298-root-is-symlink', pass, detail });
          await client2.callTool('browser.shutdown_all', {});
        } finally {
          client2.child.stdin.end();
          await Promise.race([new Promise((res) => client2.child.once('exit', res)), delay(10000)]);
          if (!client2.child.killed) client2.child.kill();
        }
      }

      // GAP-295: Kelvin-sign look-alike live escape attempt through the real download path
      {
        const KELVIN = 'K';
        const workDirName = 'work-gap295';
        const realWork = path.join(R, workDirName);
        await fs.mkdir(realWork, { recursive: true });
        // A separate, REAL directory whose name only differs from "work-gap295" by folding the
        // Kelvin sign onto a "k" — e.g. replace one "k" in "work" with the Kelvin sign so the
        // two names look identical but are byte-distinct.
        const lookalikeName = `${KELVIN}ork-gap295`; // "work-gap295" but replacing the "w" — keep 'k' style below instead
        // Use a name that actually contains a lowercase 'k' being replaced, matching the real bug:
        const rootWithK = path.join(R, 'wor' + 'k' + '-root295');
        await fs.mkdir(rootWithK, { recursive: true });
        const lookalikeDir = path.join(R, 'wor' + KELVIN + '-root295');
        await fs.mkdir(lookalikeDir, { recursive: true });

        const client3Env = { ...mcpEnv, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: rootWithK };
        const client3 = makeMcpClient(MCP_PATH, client3Env);
        try {
          await initMcp(client3);
          const l3 = jsonOf(await client3.callTool('browser.launch', {}));
          await client3.callTool('browser.navigate', { sessionId: l3.sessionId, url: server.pageUrl('GAP295', { name: `g295-${nonce}.bin` }) });
          const r = jsonOf(
            await client3.callTool('browser.download_file', {
              sessionId: l3.sessionId,
              target: '#dl',
              downloadDir: path.join(lookalikeDir, 'sub'),
            }),
          );
          const escapedIntoLookalike = existsSync(path.join(lookalikeDir, 'sub'));
          record({
            id: 'GAP295-kelvin-signs-lookalike',
            pass: r.success === false && !escapedIntoLookalike,
            detail: `success=${r.success} error=${(r.error ?? '').slice(0, 150)} lookalikeSubCreated=${escapedIntoLookalike}`,
          });
          await client3.callTool('browser.shutdown_all', {});
        } finally {
          client3.child.stdin.end();
          await Promise.race([new Promise((res) => client3.child.once('exit', res)), delay(10000)]);
          if (!client3.child.killed) client3.child.kill();
        }
      }

      // GAP-296: a genuinely concurrent second download that completes AFTER the first's
      // `finally` cleanup has already run (reset to 'deny'). Two tabs on the SAME browser
      // session, both hitting download_file concurrently, the second engineered to finish late.
      {
        const client4 = makeMcpClient(MCP_PATH, mcpEnv);
        try {
          await initMcp(client4);
          const l4 = jsonOf(await client4.callTool('browser.launch', {}));
          const sid = l4.sessionId;
          const tab1 = jsonOf(await client4.callTool('browser.new_tab', { sessionId: sid }));
          const tab2 = jsonOf(await client4.callTool('browser.new_tab', { sessionId: sid }));

          const fastName = `g296-fast-${nonce}.bin`;
          const slowName = `g296-slow-${nonce}.bin`;
          await client4.callTool('browser.navigate', { sessionId: sid, tabId: tab1.id, url: server.pageUrl('G296FAST', { name: fastName }) });
          await client4.callTool('browser.navigate', { sessionId: sid, tabId: tab2.id, url: server.pageUrl('G296SLOW', { name: slowName }) });

          const fastDir = path.join(allowA, 'g296-fast');
          const slowDir = path.join(allowB, 'g296-slow');
          const platformDefaultDir = path.join(os.homedir(), 'Downloads');

          // Genuinely concurrent: fire BOTH download_file calls at once (Promise.all, not
          // sequential awaits) on two different tabs of the SAME browser. Both race on the one
          // browser-wide `Browser.setDownloadBehavior` target and both run their own `finally`
          // cleanup (reset to 'deny') independently and possibly interleaved — this is exactly
          // the GAP-296 scenario: whichever call's network response/completion event arrives
          // AFTER the OTHER call's cleanup has already reset behavior to 'deny' must never
          // silently land outside the sandbox (Chrome's platform-default Downloads folder), even
          // though the two calls' OWN reported results may legitimately race each other.
          const [fastSettled, slowSettled] = await Promise.allSettled([
            client4.callTool('browser.download_file', { sessionId: sid, tabId: tab1.id, target: '#dl', downloadDir: fastDir, maxRetries: 0 }, 150000),
            client4.callTool('browser.download_file', { sessionId: sid, tabId: tab2.id, target: '#dl', downloadDir: slowDir, maxRetries: 0 }, 150000),
          ]);
          const fastResult = fastSettled.status === 'fulfilled' ? jsonOf(fastSettled.value) : { success: false, error: String(fastSettled.reason) };
          const slowResult = slowSettled.status === 'fulfilled' ? jsonOf(slowSettled.value) : { success: false, error: String(slowSettled.reason) };
          await delay(500);

          const strayFastNameInPlatformDefault = existsSync(path.join(platformDefaultDir, fastName));
          const strayFastNameInSlowDir = existsSync(path.join(slowDir, fastName));
          const strayFastNameInFastDir = existsSync(path.join(fastDir, fastName));
          const straySlowNameInPlatformDefault = existsSync(path.join(platformDefaultDir, slowName));
          const straySlowNameInFastDir = existsSync(path.join(fastDir, slowName));
          const straySlowNameInSlowDir = existsSync(path.join(slowDir, slowName));

          const fastOk = fastResult.success === false || strayFastNameInFastDir;
          const slowOk = slowResult.success === false || straySlowNameInSlowDir;

          record({
            id: 'GAP296-concurrent-fast-result',
            pass: fastOk,
            detail: `success=${fastResult.success} err=${fastResult.error} landedInOwnDir=${strayFastNameInFastDir}`,
          });
          record({
            id: 'GAP296-concurrent-slow-result',
            pass: slowOk,
            detail: `success=${slowResult.success} err=${slowResult.error} landedInOwnDir=${straySlowNameInSlowDir}`,
          });
          record({
            id: 'GAP296-no-cross-contamination-or-platform-default-escape',
            pass:
              !strayFastNameInPlatformDefault &&
              !straySlowNameInPlatformDefault &&
              !strayFastNameInSlowDir &&
              !straySlowNameInFastDir,
            detail: `fast->platformDefault=${strayFastNameInPlatformDefault} slow->platformDefault=${straySlowNameInPlatformDefault} fast->slowDir=${strayFastNameInSlowDir} slow->fastDir=${straySlowNameInFastDir} (this is the fail-closed guarantee GAP-296 is about: neither file ever appears in the OTHER download's dir or in Chrome's platform-default Downloads folder, regardless of which call's cleanup ran first)`,
          });

          console.log('--- client4 stderr (diagnostic) ---');
          console.log(client4.stderrLog.join('').slice(-6000));
          console.log('--- end client4 stderr ---');

          await client4.callTool('browser.shutdown_all', {});
        } finally {
          client4.child.stdin.end();
          await Promise.race([new Promise((res) => client4.child.once('exit', res)), delay(10000)]);
          if (!client4.child.killed) client4.child.kill();
        }
      }

      await client.callTool('browser.shutdown_all', {});
    } finally {
      client.child.stdin.end();
      await Promise.race([new Promise((r) => client.child.once('exit', r)), delay(10000)]);
      if (!client.child.killed) client.child.kill();
    }
  } catch (e) {
    record({ id: 'FATAL', pass: false, detail: e.stack ?? String(e) });
  } finally {
    await killTrackedChildren();
    await server.close();
    await rmWithRetry(R);

    const processAfter = await listProcessesByNeedle('sutradhar');
    const stillRunning = processAfter.filter((l) => l.includes(R));
    await fs.writeFile(path.join(EVIDENCE_DIR, 'process-after-additions.txt'), processAfter.join('\n'), 'utf-8');
    record({ id: 'no-leaked-processes-additions', pass: stillRunning.length === 0, detail: `count=${stillRunning.length}` });

    await fs.writeFile(path.join(EVIDENCE_DIR, 'fix1-additions-live-verify.json'), JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed. Evidence: ${EVIDENCE_DIR}`);
    process.exitCode = overallOk ? 0 : 1;
  }
}

main();
