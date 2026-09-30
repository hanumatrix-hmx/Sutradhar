// Auditor CLI probes against the BUILT packages/cli/dist/cli.js (real headless Chrome, own state dir).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { startAuditServer } from './audit-server.mjs';
const repoRoot = process.argv[2];
const outFile = process.argv[3];
const CLI = process.argv[4] ?? path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const rows = [];
const DEADLINE = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 12 * 60 * 1000);
const rec = (id, exp, ok, data) => { rows.push({ id, exp, pass: !!ok, ...data }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} :: ${exp} :: ${JSON.stringify(data).slice(0, 600)}`); };
const srv = await startAuditServer();
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-audit-clistate-'));
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-audit-cliwork-'));
const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir };
const cli = (argv) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...argv], { env, cwd: work, windowsHide: true });
  let out = '', err = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
  const timer = setTimeout(() => { try { c.kill(); } catch {} }, 120000);
  c.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim() }); });
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
try {
  let r = await cli(['nav', `${srv.origin}/p.html?n=${++n}`]);
  rec('CLI.nav', 'exit 0 + Verification: verified line', r.code === 0 && /Verification: verified/.test(r.out), r);
  r = await cli(['press', '#txt', 'a']);
  rec('CLI.press', 'exit 0, verified', r.code === 0 && /Verification: verified/.test(r.out), r);
  r = await cli(['press', '#nofocus', 'b']);
  rec('CLI.press-abort-NEG', 'Press aborted, exit 1', r.code === 1 && /Press aborted/.test(r.out), r);
  r = await cli(['eval', "document.getElementById('txt').value"]);
  rec('CLI.press-abort-nokey', 'observer: #txt value still a (key b NOT sent)', /(^|\W)a(\W|$)/.test(r.out) && !/ab/.test(r.out), r);
  await delay(1100);
  r = await cli(['click', '#noop', '--expect-text', 'DISPLAY-NONE-TEXT']);
  rec('CLI.expect-hidden-NEG', 'exit 4 + stderr expectation failed', r.code === 4 && /expectation failed/.test(r.err), r);
  await delay(1100);
  r = await cli(['click', '#missing', '--expect-text', 'x']);
  rec('CLI.action-failed', 'exit 1 not 4', r.code === 1, r);
  await delay(1100);
  r = await cli(['click', '#real', '--json']);
  let j; try { j = JSON.parse(r.out); } catch {}
  rec('CLI.json', '--json prints result with verification', r.code === 0 && j?.verification?.evidence?.tier === 'verified', { code: r.code, tier: j?.verification?.evidence?.tier, out: j ? undefined : r.out });
  r = await cli(['clickpoint', '5000', '5000']);
  rec('CLI.clickpoint-offscreen-NEG', 'exit 0, NOT verified contradicted', r.code === 0 && /NOT verified .* contradicted/.test(r.out), r);
  r = await cli(['nav', `${srv.origin}/status/404?n=${++n}`]);
  rec('CLI.nav404-NEG', 'exit 0 (no expect) + NOT verified contradicted', r.code === 0 && /NOT verified .* contradicted/.test(r.out) && /HTTP 404/.test(r.out), r);
  r = await cli(['nav', `${srv.origin}/redirect?n=${++n}`, '--expect-url', '/b']);
  rec('CLI.nav-expect-NEG', 'exit 4, stdout Navigated to + NOT verified', r.code === 4 && /Navigated to/.test(r.out) && /NOT verified/.test(r.out), r);
  r = await cli(['nav', `${srv.origin}/a?n=${++n}`, '--expect-url-changed', '--expect-url-unchanged']);
  rec('CLI.flag-conflict', 'nonzero exit with mutually exclusive message', r.code !== 0 && /mutually exclusive/.test(r.out + r.err), r);
  r = await cli(['screenshot', path.join(work, 's.png')]);
  rec('CLI.screenshot', 'Verification line NOT verified unverifiable', r.code === 0 && /NOT verified .* unverifiable/.test(r.out), r);
  r = await cli(['nav', `${srv.origin}/dlpage?n=${++n}`]);
  r = await cli(['download', '#dl0', path.join(work, 'dl')]);
  rec('CLI.download0-NEG', 'exit 0, NOT verified contradicted 0 bytes', r.code === 0 && /contradicted/.test(r.out) && /0 bytes/.test(r.out), r);
} finally {
  const c = await cli(['close']);
  console.log('close', JSON.stringify(c));
  await fs.writeFile(outFile, rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
  console.log('SUMMARY', rows.filter((x) => x.pass).length, '/', rows.length);
  await srv.close();
  await delay(1000);
  for (const d of [stateDir, work]) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  clearTimeout(DEADLINE);
}
