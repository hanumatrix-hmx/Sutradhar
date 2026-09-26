// FR2-04 audit-1: two CLI sessions (two state dirs) started concurrently — does each get a warden?
// Captures the CLI's own stderr (the §2.5 "warden did not start" warning) and the warden process list.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const CLI = path.join(root, 'packages/cli/dist/cli.js');
const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-audit-cc-'));
const T = path.join(R, 'temp'); await fs.mkdir(T);
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>cc</title><button id=c onclick="confirm(1)">c</button>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const cli = (args, dir) => new Promise((res) => { const t0 = Date.now(); const c = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); let o = '', e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); c.on('exit', (code) => res({ code, ms: Date.now() - t0, stdout: o, stderr: e })); });
const readJ = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf-8')); } catch { return undefined; } };
const wardens = () => { const o = JSON.parse(execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Select ProcessId,CommandLine | ConvertTo-Json"', { encoding: 'utf-8' })); return (Array.isArray(o) ? o : [o]).filter((p) => /__dialog-warden/.test(p.CommandLine || '') && p.CommandLine.includes('') ).map((p) => { const m = /__dialog-warden\s+(\S+)/.exec(p.CommandLine); return { pid: p.ProcessId, stateFile: JSON.parse(Buffer.from(m[1], 'base64url').toString()).stateFile }; }).filter((w) => w.stateFile.startsWith(R)); };
const trials = [];
try {
  for (let i = 0; i < 4; i++) {
    const dA = path.join(R, `A${i}`), dB = path.join(R, `B${i}`);
    const [a, b] = await Promise.all([cli(['nav', URL_ + '?a' + i], dA), cli(['nav', URL_ + '?b' + i], dB)]);
    await delay(1500);
    const w = wardens();
    const t = { i, a: { code: a.code, ms: a.ms, stderr: a.stderr }, b: { code: b.code, ms: b.ms, stderr: b.stderr },
      wardenA: w.filter((x) => x.stateFile.startsWith(dA)).map((x) => x.pid), wardenB: w.filter((x) => x.stateFile.startsWith(dB)).map((x) => x.pid),
      fileA: (await readJ(path.join(dA, 'warden.json')))?.pid, fileB: (await readJ(path.join(dB, 'warden.json')))?.pid };
    // does the missing warden self-repair on the next command?
    if (!t.wardenA.length) { const s = await cli(['snap'], dA); t.aNextSnap = { code: s.code, stderr: s.stderr }; await delay(500); t.wardenAAfterNext = wardens().filter((x) => x.stateFile.startsWith(dA)).map((x) => x.pid); }
    if (!t.wardenB.length) { const s = await cli(['snap'], dB); t.bNextSnap = { code: s.code, stderr: s.stderr }; await delay(500); t.wardenBAfterNext = wardens().filter((x) => x.stateFile.startsWith(dB)).map((x) => x.pid); }
    trials.push(t); console.log(JSON.stringify(t));
    await Promise.all([cli(['close'], dA), cli(['close'], dB)]);
  }
} finally {
  server.close(); await delay(2500);
  const left = wardens();
  for (const w of left) { try { execSync(`taskkill /PID ${w.pid} /F`, { stdio: 'ignore' }); } catch {} }
  const chromeLeft = JSON.parse(execSync('powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Select ProcessId,CommandLine) | ConvertTo-Json"', { encoding: 'utf-8' }) || '[]');
  const inR = (Array.isArray(chromeLeft) ? chromeLeft : [chromeLeft]).filter((p) => (p.CommandLine || '').includes(R)).map((p) => p.ProcessId);
  for (const p of inR) { try { execSync(`taskkill /PID ${p} /F /T`, { stdio: 'ignore' }); } catch {} }
  for (let i = 0; i < 8; i++) { try { await fs.rm(R, { recursive: true, force: true }); break; } catch { await delay(500 * (i + 1)); } }
  await fs.writeFile(path.join(here, 'concurrent-sessions-probe.json'), JSON.stringify({ trials, leftoverWardens: left.map((w) => w.pid), leftoverChrome: inR }, null, 2));
  console.log('leftover wardens', left.map((w) => w.pid), 'chrome', inR);
}
