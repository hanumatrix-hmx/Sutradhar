// T5: settle + alert. Same probe against master 75b29c6 (git-archive build) and the branch. MCP over stdio.
import path from 'node:path';
import fs from 'node:fs';
import { WT, MASTER, startServer, launchObserver, mcpSession, rec, results, PIDS, delay } from './lib.mjs';
const which = process.argv[2]; // 'master' | 'branch'
const root = which === 'master' ? MASTER : WT;
const serverJs = path.join(root, 'packages', 'mcp-server', 'dist', 'cli.js');
const srv = await startServer();
const { browser } = await launchObserver();
const m = await mcpSession(serverJs, browser.wsEndpoint());
const out = { which, root };
try {
  await m.tool('browser.navigate', { url: srv.origin + '/alert-btn' });
  const ctl = await m.tool('browser.click', { target: '#a' }, 60000);
  const ctlPend = await m.tool('browser.get_pending_dialog', {});
  await m.tool('browser.handle_dialog', { action: 'accept' });
  out.control = { ms: ctl.ms, success: ctl.json?.success, dialogPending: ctl.json?.dialogPending, pendingAfter: ctlPend.text.slice(0, 200) };
  for (const [label, settle] of [['settle2000', { timeoutMs: 2000 }], ['settleTrue', true]]) {
    await m.tool('browser.navigate', { url: srv.origin + '/alert-btn?x=' + label });
    const r = await m.tool('browser.click', { target: '#a', settle }, 60000);
    const pend = await m.tool('browser.get_pending_dialog', {});
    const h = await m.tool('browser.handle_dialog', { action: 'accept' });
    out[label] = { ms: r.ms, success: r.json?.success, error: r.json?.error, dialogPending: r.json?.dialogPending, verification: r.json?.verification?.evidence?.tier, pendingAfter: pend.text.slice(0, 200), handleAfter: h.text.slice(0, 200), rpcError: r.rpcError };
  }
} finally {
  await m.close(); await browser.close(); srv.close();
}
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), `../t5-${which}.json`), JSON.stringify({ ...out, pids: PIDS }, null, 2));
