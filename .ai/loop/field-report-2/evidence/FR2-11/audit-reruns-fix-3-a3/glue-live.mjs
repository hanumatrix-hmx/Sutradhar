// AUDIT-3 live repro of A3-F1: a whitespace-free token that STARTS with a scheme:// URL is exempt from the path rule AND
// from the userinfo strip for everything after the first authority, so a second URL's userinfo or a local path glued to
// it (JSON, fetch arguments, error text) is stored verbatim. MCP (tab + session), CLI history.jsonl / history / --json.
// Usage: node glue-live.mjs <mcp-js> <cli-js> <label>
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { here, mcpClient, runCli, startServer } from './lib.mjs';
const [mcpPath, cliPath, label] = process.argv.slice(2);
const can = (t) => [...new Set((String(t).match(/a3c[a-z0-9]+/gi) ?? []).map((x) => x.toLowerCase()))];
const BS = String.fromCharCode(92);
const winPath = 'C:' + BS + BS + 'Users' + BS + BS + 'A3Cglueuser' + BS + BS + 'doc.txt';
const CODES = [
  "['https://h.test/a','https://u:A3Cgluepw@h2.test/p'].length",
  "['https://h.test/a','" + winPath + "'].length",
  "JSON.stringify({u:'https://h.test/a',f:'/home/A3Cgluehome/x.txt'}).length",
];
const THROW = "throw new Error('https://h.test/a,https://u:A3Cglueerr@h2.test/p')";
const srv = await startServer();
const out = { label };
const c = mcpClient(path.resolve(mcpPath));
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true, initialUrl: srv.origin + '/p' })).json.sessionId;
  for (const code of [...CODES, THROW]) await c.tool('browser.eval', { sessionId: sid, code });
  const tab = await c.tool('browser.get_action_history', { sessionId: sid });
  const ses = await c.tool('browser.get_action_history', { sessionId: sid, scope: 'session' });
  out.mcp = { tab: can(tab.text), session: can(ses.text), stored: ses.json.entries.map((e) => [e.target, e.error ?? null]) };
  await c.tool('browser.shutdown_all', {});
} finally { c.kill(); }
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-a3glue-'));
const env = { SUTRADHAR_CLI_STATE_DIR: path.join(scratch, 'state') };
try {
  await runCli(path.resolve(cliPath), ['nav', srv.origin + '/p'], { env, cwd: scratch });
  for (const code of [...CODES, THROW]) await runCli(path.resolve(cliPath), ['eval', code], { env, cwd: scratch });
  await runCli(path.resolve(cliPath), ['close'], { env, cwd: scratch });
  const file = await fs.readFile(path.join(scratch, 'state', 'history.jsonl'), 'utf8');
  const h = await runCli(path.resolve(cliPath), ['history'], { env, cwd: scratch });
  const j = await runCli(path.resolve(cliPath), ['history', '--json'], { env, cwd: scratch });
  out.cli = { file: can(file), human: can(h.out), json: can(j.out), args: file.trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.verb === 'eval').map((l) => [l.args[0], l.error ?? null]) };
} finally { await srv.close(); await fs.rm(scratch, { recursive: true, force: true }).catch(() => {}); }
await fs.writeFile(path.join(here, 'glue-live-' + label + '.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
