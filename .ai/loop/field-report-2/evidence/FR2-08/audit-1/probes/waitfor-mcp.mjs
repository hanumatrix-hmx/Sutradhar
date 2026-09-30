// Adversarial live probes for browser.wait_for + settle over MCP stdio. arg1 = server js (branch dist or bundle).
import path from 'node:path';
import fs from 'node:fs';
import { startServer, launchObserver, mcpSession, pageFor, rec, results, PIDS, delay, mono } from './lib.mjs';
const serverJs = process.argv[2];
const label = process.argv[3] ?? 'mcp';
const only = (process.argv[4] ?? '').split(',').filter(Boolean);
const want = (id) => only.length === 0 || only.some((o) => id.startsWith(o));
const srv = await startServer();
const { browser } = await launchObserver();
const m = await mcpSession(serverJs, browser.wsEndpoint());
const W = (a, to) => m.tool('browser.wait_for', a, to);
const nav = async (p) => { await m.tool('browser.navigate', { url: srv.origin + p }); return pageFor(browser, srv.origin + p.split('#')[0]); };
const ev = async (pg) => pg.evaluate(() => window.__ev ?? []).catch(() => null);
const waitDialog = async (ms = 5000) => { const t0 = mono(); while (mono() - t0 < ms) { const r = await m.tool('browser.get_pending_dialog', {}); if (r.json?.dialog) return true; await delay(100); } return false; };
const frameAnswers = async (f, ms = 1500) => { let t; const r = await Promise.race([f.evaluate(() => 1).then(() => 'ok', () => 'err'), new Promise((res) => { t = setTimeout(() => res('hung'), ms); })]); clearTimeout(t); return r; };
const C = async (id, fn) => { if (!want(id)) return; try { await fn(id); } catch (e) { rec(`${label}:${id}`, false, { threw: e.message }); } };
const finish = async () => {
  await m.close(); await browser.close(); srv.close();
  const pass = results.filter((r) => r.pass).length;
  console.log(`SUMMARY ${label}: ${pass}/${results.length}`);
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..');
  fs.writeFileSync(path.join(dir, `waitfor-${label}.json`), JSON.stringify({ results, pids: PIDS }, null, 2));
};
const ctx = { srv, browser, m, W, nav, ev, waitDialog, frameAnswers, C, label, rec, delay, mono, pageFor };
const parts = ['./cases-a.mjs', './cases-b.mjs', './cases-c.mjs'];
for (const p of parts) { const mod = await import(p); await mod.default(ctx); }
await finish();
