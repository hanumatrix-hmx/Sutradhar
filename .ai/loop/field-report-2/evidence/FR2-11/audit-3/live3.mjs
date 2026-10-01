// AUDIT-3 live privacy + verification probe (own canaries). Canary classes (case-insensitive):
//   a3c...  CLAIM: the rule says it is removed. Any occurrence in stored history = LEAK.
//   a3l...  LIMIT: no rule character guards it (bearer text, JSON, URL path, hostname, selector [a=b], cwd under home).
//   a3d...  DOCUMENTED-STORED (expect.text / wait_for text).
// Surfaces: MCP get_action_history tab + session (after EVERY action, new entries by seq), CLI history.jsonl,
// history, history --json. Also: tool results returned to the CALLER must keep the raw values (not redacted),
// and history.verification must deep-equal sanitizeHistoryEntry(result).verification.
// Usage: node live3.mjs <mcp-js> <cli-js> <label>
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { here, mcpClient, runCli, delay } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const [mcpPath, cliPath, label] = process.argv.slice(2);
const B = await import(pathToFileURL(path.join(repo, 'packages/browser/dist/index.js')).href);
const can = (t) => [...new Set((String(t).match(/a3[cld][a-z0-9]+/gi) ?? []).map((x) => x.toLowerCase()))];
const cls = (list) => ({ claim: list.filter((x) => x.startsWith('a3c')), limit: list.filter((x) => x.startsWith('a3l')), doc: list.filter((x) => x.startsWith('a3d')) });
const PAGE = (title) => '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title></head><body>' +
  '<input id="pw" type="password" aria-label="Password"><select id="sel"><option value="ok">OK</option></select>' +
  '<input id="file" type="file"><button id="btn" onclick="document.getElementById(\'o\').textContent=\'done A3Dexptext1 A3Dcexp1\'">Btn</button><div id="o"></div>' +
  '<button id="al" onclick="alert(\'Bearer A3Lalert1 then x?A3Calert2\')">Al</button>' +
  '<button id="lg" onclick="console.log(\'k=A3Clog1\')">Lg</button>' +
  '<iframe name="A3Lframe1" srcdoc="<p>frame A3Lframetext1</p>"></iframe></body></html>';
const server = http.createServer((req, res) => {
  const u = req.url ?? '';
  const p = u.split('?')[0];
  if (p === '/redir') return res.writeHead(302, { location: '/p?code=A3Credir1#access_token=A3Credir2' }).end();
  if (p.startsWith('/p') || p.startsWith('/reset/')) return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE('T A3Ltitle1'));
  res.writeHead(404).end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const O = 'http://127.0.0.1:' + port;
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-a3-'));
const upDir = path.join(scratch, 'A3Cupdir1', 'inner');
await fs.mkdir(upDir, { recursive: true });
await fs.writeFile(path.join(upDir, 'f.txt'), 'x');
const out = { label, mcp: { steps: [] }, cli: {} };
// ---------------- MCP ----------------
const c = mcpClient(path.resolve(mcpPath));
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true })).json.sessionId;
  let lastSeq = 0;
  const act = async (name, args, t = 60000) => {
    const r = await c.tool(name, { sessionId: sid, ...args }, t);
    const ses = await c.tool('browser.get_action_history', { sessionId: sid, scope: 'session' });
    const all = ses.json?.entries ?? [];
    const fresh = all.filter((e) => e.seq > lastSeq);
    lastSeq = Math.max(lastSeq, ...all.map((e) => e.seq));
    const v = r.json?.verification;
    const withV = fresh.filter((e) => e.verification);
    const step = { name, args: JSON.stringify(args).slice(0, 160), isError: r.isError, resultCanaries: can(r.text), newEntries: fresh.length, histCanaries: can(JSON.stringify(fresh)), keys: [...new Set(fresh.flatMap((e) => Object.keys(e)))] };
    if (v && withV.length) {
      const last = withV[withV.length - 1];
      const want = B.sanitizeHistoryEntry({ actionType: 'x', success: true, executionTimeMs: 0, timestamp: 't', verification: v }).verification;
      step.verifSanitizedEqual = isDeepStrictEqual(want, last.verification);
      step.verifRawEqual = isDeepStrictEqual(v, last.verification);
    }
    step.entries = fresh.map((e) => ({ t: e.actionType, ok: e.success, sel: e.selector, target: e.target, url: e.url, err: e.error?.slice(0, 160), reason: e.verification?.reason?.slice(0, 160), checks: e.verification?.evidence?.checks?.map((k) => [k.check, k.expected, k.observed, k.detail?.slice(0, 100)]) }));
    out.mcp.steps.push(step);
    return r;
  };
  await act('browser.navigate', { url: O + '/p?token=A3Cq1&x=1#A3Cf1' });
  await act('browser.navigate', { url: O + '/p%3Ftoken%3DA3Cenc1' });
  await act('browser.navigate', { url: O + '/reset/A3Lpath1/confirm' });
  await act('browser.navigate', { url: 'http://a3lhost1.localhost:' + port + '/p' });
  await act('browser.navigate', { url: 'http://user:A3Cui1@127.0.0.1:' + port + '/p' });
  await act('browser.navigate', { url: O + '/redir' });
  await act('browser.navigate', { url: 'com.example.app:/cb#A3Ccs1' });
  await act('browser.navigate', { url: O + '/p' });
  await act('browser.eval', { code: "'Authorization: Bearer A3Lbear1'.length" });
  await act('browser.eval', { code: "JSON.stringify({password:'A3Leval2'})" });
  await act('browser.eval', { code: "String('/x?t=A3Ceval3')" });
  await act('browser.eval', { code: "throw new Error('Bearer A3Lerr1 and https://h/p?A3Cerr2')" });
  await act('browser.eval', { code: "'A3Cres' + 'ult1'" });
  await act('browser.eval', { code: "document.title + ' ' + location.href" });
  await act('browser.click', { target: '#btn', expect: { url: '/p?x=A3Cexpu1' } });
  await act('browser.click', { target: '#btn', expect: { text: 'A3Dexptext1' } });
  await act('browser.click', { target: '[data-k=A3Lsel1]', timeoutMs: 1500, maxRetries: 0 }, 90000);
  await act('browser.click', { target: 'a[href="/p?code=A3Csel2"]', timeoutMs: 1500, maxRetries: 0 }, 90000);
  await act('browser.type', { target: '#pw', value: 'A3Ctyped1' });
  await act('browser.type_by_label', { label: 'Password', value: 'A3Ctyped2' });
  await act('browser.select_option', { target: '#sel', value: 'A3Cselval1' });
  await act('browser.set_clipboard', { text: 'A3Cclip1' });
  await act('browser.wait_for', { text: 'tok=A3Cwait1', timeoutMs: 0 });
  await act('browser.wait_for', { text: 'A3Dwait2', timeoutMs: 0 });
  await act('browser.wait_for', { url: 'p?A3Cwaitu1', timeoutMs: 0 });
  await act('browser.wait_for', { js: "document.title.includes('Bearer A3Lwaitjs1')", timeoutMs: 0 });
  await act('browser.upload_file', { target: '#file', filePath: path.join(upDir, 'f.txt') });
  await act('browser.upload_file', { target: '#file', filePath: path.join(scratch, 'A3Cupdir2', 'missing.txt') });
  await act('browser.click_by_text', { text: 'A3Lcbt1' }, 90000);
  await act('browser.click', { target: '#lg' });
  await act('browser.click', { target: '#al' });
  await act('browser.handle_dialog', { action: 'accept' });
  await act('browser.go_back', {});
  await act('browser.reload', {});
  const tab = await c.tool('browser.get_action_history', { sessionId: sid });
  const ses = await c.tool('browser.get_action_history', { sessionId: sid, scope: 'session' });
  out.mcp.tab = cls(can(tab.text));
  out.mcp.session = cls(can(ses.text));
  out.mcp.sessionCount = ses.json?.entries?.length;
  out.mcp.allKeys = [...new Set(ses.json.entries.flatMap((e) => Object.keys(e)))];
  out.mcp.verifKeys = [...new Set(ses.json.entries.filter((e) => e.verification).flatMap((e) => Object.keys(e.verification)))];
  out.mcp.callerResults = { nav0: out.mcp.steps[0].resultCanaries, evalResult: out.mcp.steps[12].resultCanaries };
  await c.tool('browser.shutdown_all', {});
} catch (e) { out.mcp.fatal = String(e.stack ?? e); } finally { c.kill(); }
// ---------------- CLI ----------------
const homeTmp = path.join(os.homedir(), 'AppData', 'Local', 'Temp');
const cwdHome = path.join(homeTmp, 'fr211a3-A3Lcwd1-' + label, 'sub');
const cwdOut = path.join(scratch, 'A3Ccwd2', 'x');
await fs.mkdir(cwdHome, { recursive: true });
await fs.mkdir(cwdOut, { recursive: true });
const env = { SUTRADHAR_CLI_STATE_DIR: path.join(scratch, 'state') };
const log = [];
const run = async (cwd, ...args) => { const r = await runCli(path.resolve(cliPath), args, { env, cwd }); log.push({ args: args.join(' ').slice(0, 120), code: r.code, ms: r.ms, outCanaries: can(r.out), err: r.err.slice(0, 200) }); return r; };
try {
  await run(cwdHome, 'nav', O + '/p?token=A3Ccq1#A3Ccf1');
  await run(cwdOut, 'nav', '127.0.0.1:' + port + '/p?token=A3Ccq2');
  await run(cwdOut, 'nav', O + '/reset/A3Lcpath1/confirm');
  await run(cwdOut, 'nav', O + '/redir');
  await run(cwdOut, 'nav', O + '/p%3Ftok%3DA3Ccenc1');
  await run(cwdOut, 'eval', "'Authorization: Bearer A3Lcbear1'.length");
  await run(cwdOut, 'eval', "String('/x?t=A3Cceval1')");
  await run(cwdOut, 'eval', "throw new Error('x;A3Ccerr1')");
  await run(cwdOut, 'eval', "'A3Ccres' + 'ult1'");
  await run(cwdOut, 'type', '#pw', 'A3Cctyped1');
  await run(cwdOut, 'setclipboard', 'A3Ccclip1');
  await run(cwdOut, 'select', '#sel', 'A3Ccsel1');
  await run(cwdOut, 'click', '#btn', '--expect-text', 'A3Dcexp1');
  await run(cwdOut, 'click', '#btn', '--expect-url', '/p?x=A3Ccexpu1');
  await run(cwdOut, 'clicktext', 'A3Lcct1');
  await run(cwdOut, 'waitfor', '0', '--text', 'k=A3Ccwait1');
  await run(cwdOut, 'upload', '#file', path.join(upDir, 'f.txt'));
  await run(cwdOut, 'screenshot', path.join(scratch, 'A3Ccshot1', 's.png'));
  await run(cwdOut, 'dialog', 'accept', 'A3Ccprompt1');
  await run(cwdOut, 'close');
  const file = await fs.readFile(path.join(scratch, 'state', 'history.jsonl'), 'utf8');
  const human = await run(cwdOut, 'history');
  const json = await run(cwdOut, 'history', '--json');
  out.cli.log = log;
  out.cli.file = cls(can(file));
  out.cli.human = cls(can(human.out + human.err));
  out.cli.json = cls(can(json.out));
  out.cli.jsonEqualsFile = json.out.trim() === file.trim();
  out.cli.lines = file.trim().split('\n').map((l) => { const j = JSON.parse(l); return { verb: j.verb, args: j.args, exit: j.exitCode, cwd: j.cwd, error: j.error, actions: j.actions.map((a) => ({ t: a.actionType, sel: a.selector, target: a.target, url: a.url, err: a.error?.slice(0, 120), reason: a.verification?.reason?.slice(0, 120) })) }; });
  out.cli.humanText = human.out.slice(0, 4000);
} catch (e) { out.cli.fatal = String(e.stack ?? e); } finally {
  server.close();
  await fs.rm(path.join(homeTmp, 'fr211a3-A3Lcwd1-' + label), { recursive: true, force: true }).catch(() => {});
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}
await fs.writeFile(path.join(here, 'live3-' + label + '.json'), JSON.stringify(out, null, 1));
const leaks = { mcpTab: out.mcp.tab?.claim, mcpSession: out.mcp.session?.claim, cliFile: out.cli.file?.claim, cliHuman: out.cli.human?.claim, cliJson: out.cli.json?.claim };
console.log(JSON.stringify({ label, CLAIM_LEAKS: leaks, limits: { mcp: out.mcp.session?.limit, cli: out.cli.file?.limit }, documented: { mcp: out.mcp.session?.doc, cli: out.cli.file?.doc }, caller: out.mcp.callerResults, verif: out.mcp.steps.filter((s) => 'verifSanitizedEqual' in s).map((s) => [s.name, s.verifSanitizedEqual, s.verifRawEqual]), keys: out.mcp.allKeys, verifKeys: out.mcp.verifKeys, fatal: [out.mcp.fatal, out.cli.fatal], cliCodes: out.cli.log?.map((l) => l.code).join(','), jsonEqualsFile: out.cli.jsonEqualsFile }, null, 1));
