// AUDIT-2 live probe: shapes the attack generator found leaking, driven through the REAL paths (MCP server dist or
// bundle, CLI dist or bundle), plus a verification deep-equality check (history.verification must equal
// sanitizeHistoryEntry(result).verification exactly) and the expect-text / cwd storage questions.
// Usage: node live-attack.mjs <mcp-js> <cli-js> <label>
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { here, mcpClient, runCli, canariesIn, delay } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const [mcpPath, cliPath, label] = process.argv.slice(2);
const B = await import(pathToFileURL(path.join(repo, 'packages/browser/dist/index.js')).href);
const PAGE = `<!doctype html><title>A2</title><input id="pw" aria-label="Password"><button id="btn" onclick='document.getElementById("o").textContent="Account 4111-CNRYotpshown"'>Go</button><div id="o"></div><a id="cs" href="com.example.app:/cb#access_token=CNRYcslink">cs</a>`;
const server = http.createServer((req, res) => {
  const p = (req.url ?? '').split('?')[0];
  if (p === '/redir') return res.writeHead(302, { location: 'com.example.app:/cb#access_token=CNRYredir' }).end();
  if (p === '/p') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  res.writeHead(404).end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const O = `http://127.0.0.1:${server.address().port}`;
const out = { label, mcp: {}, cli: {}, verif: [] };
const EXPECTED_STORED = ['CNRYexpotp', 'CNRYwaitotp', 'CNRYcwdsecret', 'CNRYcliexpotp'];
// ---------- MCP
const c = mcpClient(mcpPath);
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true })).json.sessionId;
  const b = { sessionId: sid };
  const results = [];
  const act = async (name, args, t) => { const r = await c.tool(name, { ...b, ...args }, t); results.push({ name, args, r }); await delay(1100); return r; };
  await act('browser.navigate', { url: `${O}/p` });
  await act('browser.navigate', { url: 'about:blank#CNRYaboutfrag' });
  await act('browser.navigate', { url: 'com.example.app:/cb#access_token=CNRYcustomnav' });
  await act('browser.navigate', { url: `${O}/redir` });
  await act('browser.navigate', { url: `${O}/p` });
  await act('browser.click', { target: '#cs' });
  await act('browser.navigate', { url: `${O}/p` });
  await act('browser.eval', { code: "['intranet:8080/p#CNRYevalintra', 'about:blank#CNRYevalabout', 'https://x.test/my dir#CNRYevalspace'].length" });
  await act('browser.eval', { code: "throw new Error('see intranet:8080/p?CNRYerrintra')" });
  await act('browser.click', { target: '#btn', expect: { text: 'CNRYexpotp' } });
  await act('browser.wait_for', { text: 'CNRYwaitotp', timeoutMs: 0 });
  await act('browser.click', { target: '#btn', expect: { url: '/p?x=CNRYexpurlq' } });
  await act('browser.click', { target: '#missing' }, 90000);
  await act('browser.type', { target: '#pw', value: 'CNRYtyped', expect: { text: 'CNRYtyped' } });
  const tab = await c.tool('browser.get_action_history', b);
  const ses = await c.tool('browser.get_action_history', { ...b, scope: 'session' });
  out.mcp.entries = ses.json?.entries?.map((e) => ({ t: e.actionType, s: e.success, target: e.target, url: e.url, error: e.error, reason: e.verification?.reason, checks: e.verification?.evidence?.checks }));
  out.mcp.canariesSession = canariesIn(ses.text);
  out.mcp.canariesTab = canariesIn(tab.text);
  out.mcp.unexpected = out.mcp.canariesSession.filter((k) => !EXPECTED_STORED.includes(k));
  const hv = ses.json.entries.filter((e) => e.verification);
  const rv = results.filter((x) => x.r.json?.verification);
  out.verifPairs = { history: hv.length, results: rv.length };
  for (let i = 0; i < Math.min(hv.length, rv.length); i++) {
    const want = B.sanitizeHistoryEntry({ actionType: 'x', success: true, executionTimeMs: 0, timestamp: 't', verification: rv[i].r.json.verification }).verification;
    const raw = rv[i].r.json.verification;
    out.verif.push({ action: rv[i].name, historyType: hv[i].actionType, deepEqualSanitized: isDeepStrictEqual(want, hv[i].verification), deepEqualRaw: isDeepStrictEqual(raw, hv[i].verification), reasonResult: String(raw.reason).slice(0, 160), reasonHistory: String(hv[i].verification.reason).slice(0, 160) });
  }
  await c.tool('browser.shutdown_all', {});
} finally { c.kill(); }
// ---------- CLI
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-a2-'));
const cwd = path.join(scratch, 'CNRYcwdsecret', 'client-acme');
await fs.mkdir(cwd, { recursive: true });
const env = { SUTRADHAR_CLI_STATE_DIR: path.join(scratch, 'state') };
const log = [];
const run = async (...args) => { const r = await runCli(path.resolve(cliPath), args, { env, cwd }); log.push({ args, code: r.code, err: r.err.slice(0, 300) }); return r; };
try {
  await run('nav', `${O}/p`);
  await run('nav', 'com.example.app:/cb#access_token=CNRYclicustom');
  await run('nav', `${O}/redir`);
  await run('nav', `${O}/p`);
  await run('eval', "'intranet:8080/p#CNRYclievalintra'");
  await run('clicktext', 'intranet:8080/p#CNRYclickt');
  await run('click', '#btn', '--expect-text', 'CNRYcliexpotp');
  await run('upload', '#pw', 'rel' + path.sep + 'CNRYreldir' + path.sep + 'f.txt');
  await run('close');
  const file = await fs.readFile(path.join(scratch, 'state', 'history.jsonl'), 'utf8');
  const human = await run('history');
  out.cli.log = log;
  out.cli.fileCanaries = canariesIn(file);
  out.cli.humanCanaries = canariesIn(human.out);
  out.cli.unexpected = out.cli.fileCanaries.filter((k) => !EXPECTED_STORED.includes(k));
  out.cli.lines = file.trim().split('\n').map((l) => { const j = JSON.parse(l); return { verb: j.verb, args: j.args, exit: j.exitCode, error: j.error, cwd: j.cwd, actions: j.actions.map((a) => ({ t: a.actionType, target: a.target, error: a.error, reason: a.verification?.reason, checks: a.verification?.evidence?.checks })) }; });
  out.cli.humanHead = human.out.slice(0, 1500);
} finally {
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  server.close();
}
await fs.writeFile(path.join(here, `live-attack-${label}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ label, mcpUnexpected: out.mcp.unexpected, mcpAll: out.mcp.canariesSession, cliUnexpected: out.cli.unexpected, cliAll: out.cli.fileCanaries, humanAll: out.cli.humanCanaries, verifPairs: out.verifPairs, verif: out.verif.map((v) => [v.action, v.historyType, v.deepEqualSanitized, v.deepEqualRaw]) }, null, 1));
