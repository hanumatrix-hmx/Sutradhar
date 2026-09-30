// CLI: waitfor verb, exit codes, D16 rejection, --text-gone note, dialog exit 3, --settle on new verbs.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { WT, startServer, puppeteer, rec, results, PIDS, logPid, delay, pageFor } from './lib.mjs';
const CLI = path.join(WT, 'packages', 'cli', 'dist', 'cli.js');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-fr208-cli-'));
const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir };
const run = (args, to = 60000) => new Promise((res) => { const t0 = performance.now(); const c = spawn(process.execPath, [CLI, ...args], { env }); logPid(c.pid, 'cli ' + args[0]); let o = ''; let e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); const k = setTimeout(() => c.kill(), to); c.on('close', (code) => { clearTimeout(k); res({ code, out: o, err: e, ms: Math.round(performance.now() - t0), endAt: Date.now() }); }); });
const srv = await startServer();
let obs;
const pg = async (prefix) => { if (!obs) { const st = JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf-8')); obs = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null }); } return pageFor(obs, prefix); };
try {
  const n1 = await run(['nav', srv.origin + '/toast?d=5000']);
  const p1 = await pg(srv.origin + '/toast');
  const w = await run(['waitfor', '15000', '--text', 'Probe toast shown']);
  const e1 = (await p1.evaluate(() => window.__ev)).find((x) => x.w === 'shown');
  rec('cli:waitfor-text', n1.code === 0 && w.code === 0 && /^Condition met after \d+ms: text="Probe toast shown"/.test(w.out) && e1 && w.endAt >= e1.at, { code: w.code, out: w.out.slice(0, 160), endMinusShown: e1 && w.endAt - e1.at });
  const t = await run(['waitfor', '2000', '--text', 'Never appears']);
  rec('cli:waitfor-timeout', t.code === 1 && /Wait failed: wait_for timed out after 2000ms/.test(t.out), { code: t.code, out: t.out.slice(0, 160) });
  const g = await run(['waitfor', '2000', '--text-gone', 'Never was here']);
  rec('cli:waitfor-vacuous-note', g.code === 0 && /Note: "Never was here" was not present/.test(g.err), { code: g.code, err: g.err.slice(0, 160) });
  const j = await run(['waitfor', '--js', 'window.__nope.x']);
  rec('cli:waitfor-js-throw', j.code === 1 && /js condition threw/.test(j.out) && j.ms < 8000, { code: j.code, ms: j.ms, out: j.out.slice(0, 140) });
  const u = await run(['waitfor']);
  const u2 = await run(['waitfor', 'abc', '--text', 'x']);
  const u3 = await run(['waitfor', '--text', 'X', '--text-gone', 'X']);
  const u4 = await run(['waitfor', '300000', '--text', 'x']);
  rec('cli:waitfor-usage', [u, u2, u3, u4].every((x) => x.code === 1), { codes: [u.code, u2.code, u3.code, u4.code], msgs: [u, u2, u3, u4].map((x) => (x.err || x.out).slice(0, 90)) });
  // D16: condition flag on another verb is rejected and the click never happens
  await run(['nav', srv.origin + '/click-toast']);
  const p2 = await pg(srv.origin + '/click-toast');
  const d16 = await run(['click', '#b', '--text', 'Saved']);
  await delay(300);
  const clicked = (await p2.evaluate(() => window.__ev)).some((x) => x.w === 'clicked');
  rec('cli:D16-reject', d16.code === 1 && /only valid with "waitfor"/.test(d16.err + d16.out) && !clicked, { code: d16.code, msg: (d16.err + d16.out).slice(0, 120), clicked });
  // dialog: exit 3, fast
  await run(['nav', srv.origin + '/alert-now?d=300&t=Hello%20visible']);
  await delay(700);
  const dl = await run(['waitfor', '10000', '--text', 'Hello visible']);
  rec('cli:waitfor-dialog-exit3', dl.code === 3 && /blocked by an open alert/.test(dl.out) && dl.ms < 8000, { code: dl.code, ms: dl.ms, out: dl.out.slice(0, 140) });
  await run(['dialog', 'accept']).catch(() => {});
  // settle on nav and press: nav --settle returns after the page burst of the toast page? use /click-toast + press is not bursty; check help text lists verbs instead
  const h = await run(['--help']);
  rec('cli:help-settle-verbs', /waitfor \[timeoutMs\]/.test(h.out + h.err) && /"clickpoint"\/"dragpoints"\/"download"/.test(h.out + h.err), { snippet: (h.out + h.err).match(/--settle[^]*?result/)?.[0]?.slice(0, 300) });
} finally {
  await run(['close']);
  if (obs) await obs.disconnect().catch(() => {});
  srv.close();
}
console.log(`SUMMARY cli: ${results.filter((r) => r.pass).length}/${results.length}`);
fs.writeFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'cli-probe.json'), JSON.stringify({ results, pids: PIDS, stateDir }, null, 2));
