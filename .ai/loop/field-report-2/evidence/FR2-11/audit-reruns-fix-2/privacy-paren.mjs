// AUDIT-1: a real, navigable URL whose query contains '(' — does the token reach history (MCP + CLI)?
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { here, startServer, mcpClient, runCli, canariesIn } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const srv = await startServer();
const url = `http://127.0.0.1:${srv.port}/p?q=(a)&token=CNRYparen`;
const out = {};
const c = mcpClient(path.join(repo, 'packages/mcp-server/dist/cli.js'));
try {
  await c.init();
  const L = await c.tool('browser.launch', { headless: true });
  const sid = L.json.sessionId;
  const nav = await c.tool('browser.navigate', { sessionId: sid, url });
  out.mcpNavResultUrl = nav.json?.url;
  const h = await c.tool('browser.get_action_history', { sessionId: sid, scope: 'session' });
  out.mcpLeaks = canariesIn(h.text);
  out.mcpEntry = h.json.entries[0];
  await c.tool('browser.shutdown_all', {});
} finally { c.kill(); }
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-audit-paren-'));
const env = { SUTRADHAR_CLI_STATE_DIR: path.join(scratch, 'state') };
const cli = path.join(repo, 'packages/cli/dist/cli.js');
const r = await runCli(cli, ['nav', url], { env, cwd: scratch });
out.cliNavExit = r.code;
const file = await fs.readFile(path.join(scratch, 'state', 'history.jsonl'), 'utf8');
out.cliFileLeaks = canariesIn(file);
out.cliLine = JSON.parse(file.trim().split('\n')[0]);
const cl = await runCli(cli, ['close'], { env, cwd: scratch });
out.cliCloseExit = cl.code;
await fs.writeFile(path.join(here, 'privacy-paren.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ mcpLeaks: out.mcpLeaks, cliFileLeaks: out.cliFileLeaks, navExit: out.cliNavExit, mcpNavUrl: out.mcpNavResultUrl, reason: out.mcpEntry?.verification?.reason, args: out.cliLine.args }, null, 1));
await srv.close(); await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
