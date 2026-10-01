// AUDIT-4 live privacy probe. Canaries (case-insensitive): a4c* = rule (a)/(b) value after an @ (fix-3 pre-pass class);
// a4u* = userinfo password with an ENCODED ? # ; in a structured URL field (navigate target / CLI URL args);
// a4x* = controls the rule already removed before fix-3 (must stay absent); a4l* = documented limit (may appear).
// Surfaces: MCP tab + session view, CLI history.jsonl, history, history --json. Caller results are recorded too.
// Usage: node priv4-live.mjs <mcp-js> <cli-js> <label>
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { here, mcpClient, runCli, can } from './lib4.mjs';
const [mcpPath, cliPath, label] = process.argv.slice(2);
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>A4 page</title></head><body><button id="b">B</button><input id="pw" type="password"></body></html>';
const server = http.createServer((req, res) => {
  const p = (req.url ?? '').split('?')[0];
  if (p === '/r') return res.writeHead(302, { location: '/p?email=bob@A4Credir1x' }).end();
  if (p.startsWith('/p')) return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  res.writeHead(404).end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const O = 'http://127.0.0.1:' + port;
const out = { label, mcp: [], cli: {} };
const c = mcpClient(path.resolve(mcpPath));
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true })).json.sessionId;
  const steps = [
    ['browser.navigate', { url: O + '/p?token=A4Xnavq1x#A4Xnavf1x' }],
    ['browser.navigate', { url: O + '/p?pw=P%40ssA4Cnavq2x' }],
    ['browser.navigate', { url: O + '/r' }],
    ['browser.eval', { code: "fetch('" + O + "/p?pw=P@ssA4Cevq3x').then(r => r.status)" }],
    ['browser.eval', { code: "throw new Error('callback " + O + "/cb?code=a@A4Ceerr4x failed')" }],
    ['browser.eval', { code: "throw new Error('PGPASSWORD=hunter@A4Ceerr5x')" }],
    ['browser.eval', { code: "throw new Error('x " + O + "/cb?code=A4Xeerr6x')" }],
    ['browser.eval', { code: "fetch('https://u:A4Xevu7x@h.test/x').catch(() => 1)" }],
    ['browser.click_by_text', { text: 'login?pw=P@ssA4Cct8x', timeoutMs: 1000 }],
    ['browser.wait_for', { url: '/p?pw=P@ssA4Cwf9x', timeoutMs: 0 }],
    ['browser.navigate', { url: 'http://admin:pa%3FA4Unavu10x@127.0.0.1:' + port + '/p' }],
    ['browser.navigate', { url: 'http://admin:pa%23A4Unavu11x@127.0.0.1:' + port + '/p' }],
    ['browser.navigate', { url: 'http://admin:A4Xnavu12x@127.0.0.1:' + port + '/p' }],
  ];
  for (const [name, args] of steps) {
    const r = await c.tool(name, { sessionId: sid, ...args }, 60000);
    out.mcp.push({ name, args: JSON.stringify(args).slice(0, 140), isError: r.isError, resultCanaries: can(r.text) });
  }
  const tab = await c.tool('browser.get_action_history', { sessionId: sid });
  const ses = await c.tool('browser.get_action_history', { sessionId: sid, scope: 'session' });
  out.mcpTabCanaries = can(tab.text);
  out.mcpSessionCanaries = can(ses.text);
  out.mcpEntries = (ses.json?.entries ?? []).map((e) => ({ seq: e.seq, t: e.actionType, ok: e.success, target: e.target, selector: e.selector, url: e.url, error: e.error?.slice(0, 140), reason: e.verification?.reason?.slice(0, 160), obs: (e.verification?.evidence?.checks ?? []).map((k) => k.observed).filter((x) => typeof x === 'string').slice(0, 3) }));
  await c.tool('browser.shutdown_all', {});
} finally { c.kill(); }
// ---------------- CLI ----------------
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-a4p-'));
const env = { SUTRADHAR_CLI_STATE_DIR: path.join(scratch, 'state') };
const run = (...a) => runCli(path.resolve(cliPath), a, { env, cwd: scratch });
const cliLog = [];
const cmds = [
  ['nav', O + '/p?pw=P%40ssA4Ccnav1x'],
  ['eval', "fetch('" + O + "/p?pw=P@ssA4Ccev2x').then(r => r.status)"],
  ['eval', "throw new Error('cb " + O + "/cb?code=a@A4Ccerr3x')"],
  ['clicktext', 'token=a@A4Ccct4x'],
  ['waitfor', '0', '--url', '/p?pw=P@ssA4Ccwf5x'],
  ['nav', 'http://admin:pa%3BA4Ucnav6x@127.0.0.1:' + port + '/p'],
  ['newtab', 'http://admin:pa%3FA4Ucnt7x@127.0.0.1:' + port + '/p'],
  ['eval', "throw new Error('x ?A4Xcerr8x')"],
  ['close'],
];
for (const a of cmds) { const r = await run(...a); cliLog.push({ a: a.join(' ').slice(0, 120), code: r.code, ms: r.ms, outCanaries: can(r.out + r.err) }); }
const hist = path.join(scratch, 'state', 'history.jsonl');
const raw = await fs.readFile(hist, 'utf8');
const human = await run('history');
const json = await run('history', '--json');
out.cli = { log: cliLog, fileCanaries: can(raw), humanCanaries: can(human.out), jsonCanaries: can(json.out), jsonByteIdentical: json.out === raw, lines: raw.trim().split('\n').map((l) => { const j = JSON.parse(l); return { verb: j.verb, args: j.args, err: j.error?.slice(0, 120), acts: j.actions.map((x) => [x.actionType, x.target ?? x.selector, x.error?.slice(0, 100)]) }; }) };
await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
server.close();
const all = [...out.mcpTabCanaries, ...out.mcpSessionCanaries, ...out.cli.fileCanaries, ...out.cli.humanCanaries, ...out.cli.jsonCanaries];
out.summary = { a4c_leaked: [...new Set(all.filter((x) => x.startsWith('a4c')))], a4u_leaked: [...new Set(all.filter((x) => x.startsWith('a4u')))], a4x_leaked_controls: [...new Set(all.filter((x) => x.startsWith('a4x')))] };
await fs.writeFile(path.join(here, 'priv4-live-' + label + '.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary, null, 1));
