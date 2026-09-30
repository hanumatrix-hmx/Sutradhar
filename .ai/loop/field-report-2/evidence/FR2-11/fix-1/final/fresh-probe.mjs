// FR2-11 fix-1 FRESH probe (written by the fixer, independent of verify-fr2-11-history.mjs and of the matrix module; it re-reads live state
// AFTER each action: MCP responses, history.jsonl bytes on disk, `sutradhar history` output, the SDK runtime report). It reuses only the
// auditor's transport helpers (lib.mjs, copied unmodified to ../../audit-probes-rerun-fix-1/, sha256 recorded there).
// Usage: node fresh-probe.mjs <mcp-server-js> <cli-js> <label>
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { here as libHere, mcpClient, runCli, canariesIn } from '../../audit-probes-rerun-fix-1/lib.mjs';

const [mcpJs, cliJs, label = 'fresh'] = process.argv.slice(2);
const repo = path.resolve(libHere, '../../../../../..');
const out = { label, checks: [] };
const check = (name, ok, observed) => {
  out.checks.push({ name, ok: !!ok, observed });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' -- ' + JSON.stringify(observed).slice(0, 400)}`);
};

const PAGE = `<!doctype html><title>fresh</title><input id="file" type="file"><a id="dl" href="/dl.txt" download>d</a><input id="t" aria-label="T">`;
const server = http.createServer((req, res) => {
  const p = (req.url ?? '').split('?')[0];
  if (p === '/dl.txt') return res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="dl.txt"' }).end('x'.repeat(40));
  res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const O = `http://127.0.0.1:${port}`;

// NEGATIVE CONTROL: the audited character-class regex (HEAD 785dc53) DOES leave a canary in these texts, and canariesIn sees it.
const OLD = /\b(?:https?|wss?|file|blob):\/\/[^\s"'`<>()[\]{}]+/gi;
const controlTexts = [`${O}/p?q=(a)&token=CNRYctl1`, `${O}/p?ids[]=1&token=CNRYctl2`, `${O}/p?q={x}&token=CNRYctl3`, `${O}/p?q=it's&token=CNRYctl4`];
const oldLeaks = controlTexts.map((t) => canariesIn(t.replace(OLD, (m) => m.split(/[?#]/)[0])));
check('negative control: the OLD regex leaves a canary in all 4 audit shapes (so this probe can see the bug)', oldLeaks.every((l) => l.length === 1), oldLeaks);

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-fresh-'));
const upDir = path.join(scratch, 'CNRYfpUpDir with space', 'sub dir');
await fs.mkdir(upDir, { recursive: true });
const upFile = path.join(upDir, 'file.txt');
await fs.writeFile(upFile, 'x');
const dlRoot = path.join(scratch, 'CNRYfpDlRoot');
await fs.mkdir(dlRoot, { recursive: true });

// ── MCP ──
const c = mcpClient(path.resolve(mcpJs), { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: dlRoot });
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true })).json.sessionId;
  const b = { sessionId: sid };
  const navs = [
    `${O}/p?q=(a)&token=CNRYfpA1`,
    `${O}/p?ids[]=1&token=CNRYfpA2`,
    `${O}/p?q={x}&token=CNRYfpA3`,
    `${O}/p?q=it's&token=CNRYfpA4`,
    `http://user:CNRYfpB1@127.0.0.1:${port}/p;jsessionid=CNRYfpB2#CNRYfpB3`,
  ];
  for (const u of navs) await c.tool('browser.navigate', { ...b, url: u });
  await c.tool('browser.navigate', { ...b, url: `${O}/f` });
  const ev = await c.tool('browser.eval', { ...b, code: `throw new Error("see (http://127.0.0.1:1/p?x=1&t=CNRYfpE1) and 'C:\\\\Users\\\\CNRYfpE2 dir\\\\x y\\\\file.txt' and /home/CNRYfpE3/a b/file.txt")` });
  const up = await c.tool('browser.upload_file', { ...b, target: '#file', filePath: upFile });
  const upMiss = await c.tool('browser.upload_file', { ...b, target: 'input[type=file]', filePath: path.join(scratch, 'CNRYfpMissing', 'nofile.txt') });
  const dl = await c.tool('browser.download_file', { ...b, target: '#dl', downloadDir: path.join(dlRoot, 'CNRYfpDlDir', 'out dir') }, 60000);
  const session = await c.tool('browser.get_action_history', { ...b, scope: 'session' });
  const tab = await c.tool('browser.get_action_history', b);
  const navEntries = (session.json?.entries ?? []).filter((e) => e.actionType === 'navigate');
  check('MCP: 6 navigations recorded and every target is origin + path only', navEntries.length === 6 && navEntries.slice(0, 4).every((e) => e.target === `${O}/p`) && navEntries[4]?.target === `http://127.0.0.1:${port}/p`, navEntries.map((e) => e.target));
  check('MCP session view: no canary at all (queries with ( [ { \', userinfo, ;param, fragment, eval error with URL + Windows + POSIX paths, upload, download)', canariesIn(session.text).length === 0, canariesIn(session.text));
  check('MCP default tab view: no canary at all', canariesIn(tab.text).length === 0 && tab.json?.scope === 'tab', canariesIn(tab.text));
  check('MCP: the tool RESULTS did contain the secrets (the history is what is redacted): eval error text quotes the canary', canariesIn(ev.text).length >= 1, canariesIn(ev.text));
  check('MCP: upload ok, missing upload failed, download ok (the path tools really ran)', up.json?.success === true && upMiss.json?.success === false && dl.json?.success === true, [up.json?.success, upMiss.json?.success, dl.json?.success]);
  const evEntry = (session.json?.entries ?? []).find((e) => e.actionType === 'eval');
  check('MCP: the eval error entry keeps "see" text and the basenames only', /file\.txt/.test(evEntry?.error ?? '') && !/Users|home/.test(evEntry?.error ?? ''), evEntry?.error);
  await c.tool('browser.shutdown_all', {});
} finally {
  c.kill();
}

// ── CLI ──
const stateDir = path.join(scratch, 'state');
const env = { SUTRADHAR_CLI_STATE_DIR: stateDir };
const cli = (...a) => runCli(path.resolve(cliJs), a, { env, cwd: scratch });
const runs = [];
runs.push(await cli('nav', `127.0.0.1:${port}/p?token=CNRYfpG1`));
runs.push(await cli('nav', `http://127.0.0.1:${port}/p?q=(a)&ids[]=1&token=CNRYfpG2`));
runs.push(await cli('nav', `${O}/f`));
runs.push(await cli('upload', '#file', upFile));
runs.push(await cli('upload', 'input[type=file]', path.join(scratch, 'CNRYfpMissing', 'nofile.txt')));
runs.push(await cli('download', '#dl', path.join(dlRoot, 'CNRYfpDlDir', 'out dir')));
const dlEnv = await runCli(path.resolve(cliJs), ['download', '#dl', path.join(dlRoot, 'CNRYfpDlDir', 'out dir2')], { env: { ...env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: dlRoot }, cwd: scratch });
runs.push(dlEnv);
runs.push(await cli('eval', `throw new Error("url (http://127.0.0.1:1/p?x=1&t=CNRYfpG3) path C:\\\\Users\\\\CNRYfpG4\\\\f.txt")`));
const file = await fs.readFile(path.join(stateDir, 'history.jsonl'), 'utf8'); // FRESH read from disk, after every command
const lines = file.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const human = await cli('history');
const asJson = await cli('history', '--json');
check('CLI: one history line per command (9 commands incl. the env-rooted download)', lines.length === runs.length, { lines: lines.length, runs: runs.length });
check('CLI history.jsonl raw bytes: no canary (scheme-less URL args, paren/bracket queries, upload/download args and reasons, eval error with URL + Windows path)', canariesIn(file).length === 0, canariesIn(file));
check('CLI `sutradhar history` human output: no canary', canariesIn(human.out).length === 0 && human.code === 0, canariesIn(human.out));
check('CLI `sutradhar history --json` is byte-identical to the file and has no canary', asJson.out.replace(/\r\n/g, '\n').trimEnd() === file.trimEnd() && canariesIn(asJson.out).length === 0, canariesIn(asJson.out));
check('CLI scheme-less nav arg is stored as host:port/path (display part kept)', lines[0]?.args?.[0] === `127.0.0.1:${port}/p`, lines[0]?.args);
check('CLI upload arg = basename, download dir arg = <dir>', JSON.stringify(lines[3]?.args) === JSON.stringify(['#file', 'file.txt']) && JSON.stringify(lines[5]?.args) === JSON.stringify(['#dl', '<dir>']), [lines[3]?.args, lines[5]?.args]);
check('the CLI path verbs really ran (upload 0, missing upload non-zero, env-rooted download 0)', runs[3].code === 0 && runs[4].code !== 0 && dlEnv.code === 0, runs.map((r) => r.code));
const closed = await cli('close');
check('CLI close exited 0 and history.jsonl survives it', closed.code === 0 && (await fs.stat(path.join(stateDir, 'history.jsonl')).then(() => true, () => false)), closed.code);

// ── SDK ──
const sdk = await import(pathToFileURL(path.join(repo, 'packages/sutradhar/dist/index.js')).href);
const browser = await sdk.launch({ headless: true });
try {
  const page = (await browser.pages())[0];
  await page.goto(`${O}/p?ids[]=1&q=(a)&token=CNRYfpS1`);
  await page.goto(`http://u:CNRYfpS2@127.0.0.1:${port}/p;s=CNRYfpS3#CNRYfpS4`);
  await page.evaluate(`throw new Error("x (${O}/p?t=CNRYfpS5) y")`).catch(() => {});
  const rep = browser.runtime.getActionHistoryReport(browser.sessionId, { scope: 'session' });
  const tabRep = browser.runtime.getActionHistoryReport(browser.sessionId);
  check('SDK report (session + tab): no canary; targets are origin + path', canariesIn(JSON.stringify(rep)).length === 0 && canariesIn(JSON.stringify(tabRep)).length === 0 && rep.entries[0]?.target === `${O}/p`, { leaks: canariesIn(JSON.stringify(rep)), t0: rep.entries[0]?.target });
} finally {
  await browser.close().catch(() => {});
}

server.close();
await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
out.pass = out.checks.every((x) => x.ok);
await fs.writeFile(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), `fresh-probe-${label}.json`), JSON.stringify(out, null, 1));
console.log(`\n[fresh-probe ${label}] ${out.checks.filter((x) => x.ok).length}/${out.checks.length} checks passed`);
process.exitCode = out.pass ? 0 : 1;
