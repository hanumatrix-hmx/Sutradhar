// AUDIT-1: live type_by_label did-not-land on HEAD: neither the typed value nor the field content may reach history.
import path from 'node:path'; import fs from 'node:fs/promises';
import { here, mcpClient, startServer } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const srv = await startServer();
const c = mcpClient(path.join(repo, 'packages/mcp-server/dist/cli.js'));
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true, initialUrl: srv.origin + '/p' })).json.sessionId;
  const r = await c.tool('browser.type_by_label', { sessionId: sid, label: 'Mangle', value: 'CNRYlbl' }, 90000);
  const h = await c.tool('browser.get_action_history', { sessionId: sid });
  const e = h.json.entries.at(-1);
  const out = { resultError: (r.json?.error ?? r.text).slice(0, 200), entryType: e.actionType, success: e.success, entryError: e.error, reason: e.verification?.reason, leaksValue: h.text.includes('CNRYlbl'), leaksFieldContent: h.text.includes('lblYRNC') };
  console.log(JSON.stringify(out, null, 1));
  await fs.writeFile(path.join(here, 'typebylabel.json'), JSON.stringify(out, null, 1));
  await c.tool('browser.shutdown_all', {});
} finally { c.kill(); await srv.close(); }
