// Settle on newly covered tools: each trigger starts a mutation burst at +150/+400 ms (gaps < 300 ms quiet window).
// With settle the call must return AFTER burst:2 (observer timestamp); without settle (controls) it returns before.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { launchObserver, mcpSession, pageFor, rec, results, PIDS, delay, page } from './lib.mjs';
const serverJs = process.argv[2]; const label = process.argv[3] ?? 'settle';
const body = `<input id="k"><div id="h" style="width:80px;height:30px;background:#ccc">hover</div>
<select id="s"><option value="a">a</option><option value="b">b</option></select>
<input id="f1"><input id="f2"><button id="cf">confirm</button><div id="pt" style="position:fixed;left:40px;top:300px;width:120px;height:40px;background:#9c9">pt</div>
<button id="rb">role button</button><div id="log"></div>
<script>window.__ev=window.__ev||[];const rec=(w)=>window.__ev.push({w,at:Date.now()});
const burst=(t)=>{rec(t+':0');setTimeout(()=>{log.appendChild(document.createElement('i'));rec(t+':1')},150);setTimeout(()=>{log.appendChild(document.createElement('i'));rec(t+':2')},400)};
k.addEventListener('keydown',()=>burst('press'));h.addEventListener('mouseenter',()=>burst('hover'));s.addEventListener('change',()=>burst('select'));
f2.addEventListener('input',()=>{if(!window.__f2){window.__f2=1;burst('fill')}});cf.addEventListener('click',()=>{if(confirm('go'))burst('dialog')});
pt.addEventListener('click',()=>burst('point'));rb.addEventListener('click',()=>burst('role'));
addEventListener('load',()=>burst('load'));addEventListener('pageshow',(e)=>{if(e.persisted)burst('pageshow')});</script>`;
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); r.end(page(body)); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const O = `http://127.0.0.1:${srv.address().port}`;
const { browser } = await launchObserver();
const m = await mcpSession(serverJs, browser.wsEndpoint());
const evs = async (pg) => pg.evaluate(() => window.__ev).catch(() => []);
const at = (e, w) => e.filter((x) => x.w === w).at(-1)?.at;
let n = 0;
const fresh = async () => { const u = `${O}/p?n=${++n}`; await m.tool('browser.navigate', { url: u }); const pg = await pageFor(browser, u); await pg.waitForFunction(() => window.__ev.some((e) => e.w === 'load:2'), { timeout: 5000 }); return { pg, u }; };
const check = async (id, tag, pg, r, settled) => { await pg.waitForFunction((t) => window.__ev.some((e) => e.w === t), { timeout: 5000 }, tag + ':2').catch(() => {}); const e = await evs(pg); const two = at(e, tag + ':2'); const ok = (r.json?.success !== false && !r.isError) && two !== undefined && (settled ? r.recvAt >= two : r.recvAt < two); rec(`${label}:${id}`, ok, { settled, recvMinusBurst2: two && r.recvAt - two, ms: r.ms, err: r.isError ? r.text.slice(0, 120) : r.json?.error }); };
for (const settled of [true, false]) {
  const S = settled ? { settle: true } : {};
  { const { pg } = await fresh(); await m.tool('browser.focus', { target: '#k' }); const r = await m.tool('browser.press_key', { key: 'x', ...S }); await check('press_key', 'press', pg, r, settled); }
  { const { pg } = await fresh(); const r = await m.tool('browser.hover', { target: '#h', ...S }); await check('hover', 'hover', pg, r, settled); }
  { const { pg } = await fresh(); const r = await m.tool('browser.select_option', { target: '#s', value: 'b', ...S }); await check('select_option', 'select', pg, r, settled); }
  { const { pg } = await fresh(); const r = await m.tool('browser.click_at_point', { x: 100, y: 320, ...S }); await check('click_at_point', 'point', pg, r, settled); }
  { const { pg } = await fresh(); const r = await m.tool('browser.click_by_role', { role: 'button', name: 'role button', ...S }); await check('click_by_role', 'role', pg, r, settled); }
  { const { pg } = await fresh(); const r = await m.tool('browser.fill_form', { fields: { '#f1': 'a', '#f2': 'b' }, ...S }); await check('fill_form', 'fill', pg, r, settled); }
  { const { pg } = await fresh(); await m.tool('browser.click', { target: '#cf' }); const r = await m.tool('browser.handle_dialog', { action: 'accept', ...S }); await check('handle_dialog', 'dialog', pg, r, settled); }
  { const u = `${O}/p?nav=${++n}`; const r = await m.tool('browser.navigate', { url: u, ...S }); const pg = await pageFor(browser, u); await check('navigate', 'load', pg, r, settled); }
  { const { pg } = await fresh(); const r = await m.tool('browser.reload', { ...S }); const pg2 = (await browser.pages()).find((p) => p.url().startsWith(O)); await check('reload', 'load', pg2, r, settled); }
}
await m.close(); await browser.close(); srv.close();
console.log(`SUMMARY ${label}: ${results.filter((r) => r.pass).length}/${results.length}`);
fs.writeFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', `settle-${label}.json`), JSON.stringify({ results, pids: PIDS }, null, 2));
