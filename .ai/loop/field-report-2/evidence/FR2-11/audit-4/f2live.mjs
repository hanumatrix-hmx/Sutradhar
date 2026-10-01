// AUDIT-4 F2 live repro: a VALID URL whose password holds a percent-encoded ? or # (canaries in the username and the password PREFIX).
// Usage: node f2live.mjs <mcp-js> <cli-js> <label>
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os'; import http from 'node:http';
import { here, mcpClient, runCli, can } from './lib4.mjs';
const [mcpPath, cliPath, label] = process.argv.slice(2);
const server = http.createServer((q, s) => s.writeHead(200, { 'content-type': 'text/html' }).end('<title>f2</title><p>auth=' + (q.headers.authorization ? 'yes' : 'no') + '</p>'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const U1 = 'http://A4Uuser1x:A4Upwpre1x%3Frest1@127.0.0.1:' + port + '/p', U2 = 'http://A4Uuser2x:A4Upwpre2x%23rest2@127.0.0.1:' + port + '/p';
const out = { label, urlsAreValid: [U1, U2].map((u) => { const x = new URL(u); return { user: x.username, pw: x.password, host: x.host }; }) };
const c = mcpClient(path.resolve(mcpPath));
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true })).json.sessionId;
  const r1 = await c.tool('browser.navigate', { sessionId: sid, url: U1 });
  out.navResult = { isError: r1.isError, url: r1.json?.url, sentAuth: (await c.tool('browser.eval', { sessionId: sid, code: 'document.body.innerText' })).text.slice(0, 40) };
  const h = await c.tool('browser.get_action_history', { sessionId: sid, scope: 'session' });
  out.mcpStored = h.json.entries.map((e) => [e.actionType, e.target, e.url]);
  out.mcpCanaries = can(h.text);
  await c.tool('browser.shutdown_all', {});
} finally { c.kill(); }
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-a4f2-'));
const env = { SUTRADHAR_CLI_STATE_DIR: path.join(scratch, 'state') };
try {
  await runCli(path.resolve(cliPath), ['nav', U2], { env, cwd: scratch });
  await runCli(path.resolve(cliPath), ['eval', '1'], { env, cwd: scratch });
  const raw = await fs.readFile(path.join(scratch, 'state', 'history.jsonl'), 'utf8');
  out.cliFileCanaries = can(raw);
  out.cliLines = raw.trim().split('\n').map((l) => { const j = JSON.parse(l); return [j.verb, j.args, j.actions.map((a) => [a.actionType, a.target, a.url])]; });
  await runCli(path.resolve(cliPath), ['close'], { env, cwd: scratch });
} finally { await fs.rm(scratch, { recursive: true, force: true }).catch(() => {}); server.close(); }
await fs.writeFile(path.join(here, 'f2live-' + label + '.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
