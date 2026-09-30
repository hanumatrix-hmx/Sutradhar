// AUDIT-1 (FR2-08) probe library: an INDEPENDENT fixture server (not the builder fixtures), a raw MCP stdio client,
// and an independent puppeteer-core observer. Every PID started is logged; nothing is killed by image name.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

export const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
export const MASTER = 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad/m75';
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export const mono = () => performance.now();
export const PIDS = [];
export function logPid(pid, what) { PIDS.push({ pid, what }); console.error(`[pid] ${pid} ${what}`); }

const require_ = createRequire(path.join(WT, 'packages', 'browser', 'package.json'));
export const puppeteer = require_('puppeteer-core');

export function chromePath() {
  const cands = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  throw new Error('no chrome');
}

export const page = (body, head = '') => `<!doctype html><html><head><meta charset="utf-8"><title>audit</title>${head}</head><body>${body}</body></html>`;
// build the visible string in script from chunks, so the literal never sits in the page source
export const J = (s) => '[' + s.split(' ').map((w, i, a) => JSON.stringify(w + (i < a.length - 1 ? ' ' : ''))).join(',') + "].join('')";

export async function startServer() {
  const held = new Set();
  const releaseHeld = () => { for (const r of held) { try { r.writeHead(200, { 'Content-Type': 'text/plain' }); r.end('ok'); } catch {} } held.clear(); };
  let port = 0;
  const handler = (req, res) => {
    const u = new URL(req.url, 'http://x');
    const q = (k, d) => u.searchParams.get(k) ?? d;
    const send = (b, extra = {}) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(b); };
    const xo = `http://localhost:${port}`;
    switch (u.pathname) {
      case '/blank': return send(page('<p>blank</p>'));
      case '/toast': return send(page('<div id="log"></div>', `<script>window.__ev=[];setTimeout(()=>{const d=document.createElement('div');d.textContent=${J('Probe toast shown')};document.body.appendChild(d);window.__ev.push({w:'shown',at:Date.now()})},${Number(q('d', 2000))})</script>`));
      case '/click-toast': return send(page(`<button id="b">go</button><script>window.__ev=[];document.getElementById('b').addEventListener('click',()=>{window.__ev.push({w:'clicked',at:Date.now()});setTimeout(()=>{const d=document.createElement('div');d.textContent=${J('Late toast')};document.body.appendChild(d);window.__ev.push({w:'shown',at:Date.now()})},2000)})</script>`));
      case '/alert-now': return send(page(`<p>${q('t', 'Hello visible')}</p><script>setTimeout(()=>{window.__alertAt=Date.now();alert('probe-alert')},${Number(q('d', 300))})</script>`));
      case '/alert-btn': return send(page(`<button id="a">alert</button><div id="m"></div><script>document.getElementById('a').addEventListener('click',()=>{window.__alertAt=Date.now();alert('btn-alert')})</script>`));
      case '/spinner': return send(page('<div id="sp">Spinner text</div>', `<script>window.__ev=[];setTimeout(()=>{document.getElementById('sp').remove();window.__ev.push({w:'gone',at:Date.now()})},${Number(q('d', 1500))})</script>`));
      case '/flicker': return send(page('<div id="f"></div>', `<script>window.__ev=[];setTimeout(()=>{const f=document.getElementById('f');f.textContent=${J('Blinkword')};window.__ev.push({w:'on',at:Date.now()});setTimeout(()=>{f.textContent='';window.__ev.push({w:'off',at:Date.now()})},${Number(q('on', 30))})},${Number(q('d', 1500))})</script>`));
      default: return handler2(req, res, u, q, send, xo, held, releaseHeld);
    }
  };
  const s4 = http.createServer(handler);
  await new Promise((r) => s4.listen(0, '127.0.0.1', r));
  port = s4.address().port;
  const s6 = http.createServer(handler);
  await new Promise((r) => { s6.once('error', () => r()); s6.listen(port, '::1', r); });
  return { origin: `http://127.0.0.1:${port}`, xo: `http://localhost:${port}`, releaseHeld, close: () => { releaseHeld(); s4.close(); s6.close(); } };
}

function handler2(req, res, u, q, send, xo, held, releaseHeld) {
  switch (u.pathname) {
    case '/hung-xo': return send(page(`<p>${q('main', 'main text only')}</p><iframe src="${xo}/hangframe"></iframe><iframe src="${xo}/okframe?t=${encodeURIComponent(q('fr', 'frame text'))}"></iframe>`));
    case '/okframe': return send(page(`<p>${q('t', 'frame text')}</p>`));
    case '/hangframe': return send(page('<p>about to hang</p><script>addEventListener("load",()=>setTimeout(()=>{const x=new XMLHttpRequest();x.open("GET","/hold",false);try{x.send()}catch(e){}},30))</script>'));
    case '/hung-main': return send(page(`<p>${q('t', 'Present text')}</p><script>setTimeout(()=>{window.__hangAt=Date.now();const x=new XMLHttpRequest();x.open("GET","/hold",false);try{x.send()}catch(e){}},${Number(q('d', 300))})</script>`));
    case '/hold': { held.add(res); const t = setTimeout(releaseHeld, 120000); t.unref(); res.on('close', () => held.delete(res)); return; }
    case '/detach': return send(page(`<iframe id="fr" srcdoc="<p>InFrameWord</p>"></iframe><script>window.__ev=[];setTimeout(()=>{document.getElementById('fr').remove();window.__ev.push({w:'removed',at:Date.now()})},${Number(q('d', 1500))})</script>`));
    case '/nav-a': return send(page(`<p>OldMarker here</p><script>setTimeout(()=>{location.href='/nav-b?n='+Math.random()},${Number(q('d', 800))})</script>`));
    case '/nav-b': { setTimeout(() => send(page('<p>OldMarker here</p><p>page b</p>')), Number(q('slow', 1500))); return; }
    case '/shadow-late': return send(page('<div id="h"></div><div id="c"></div>', `<script>addEventListener('load',()=>{const o=document.getElementById('h').attachShadow({mode:'open'});const c=document.getElementById('c').attachShadow({mode:'closed'});setTimeout(()=>{const s=document.createElement('span');s.textContent=${J('ShadowOpenWord')};o.appendChild(s);const t=document.createElement('span');t.textContent=${J('ShadowClosedWord')};c.appendChild(t);},1000)})</script>`));
    case '/iframe-late': return send(page(`<iframe id="so" srcdoc="<p id=x></p><script>setTimeout(()=>{document.getElementById('x').textContent=['Same','OriginLate'].join('')},1000)</script>"></iframe><iframe src="${xo}/xo-late"></iframe>`));
    case '/xo-late': return send(page(`<p id="x"></p><script>setTimeout(()=>{document.getElementById('x').textContent=['Cross','OriginLate'].join('')},1500)</script>`));
    case '/js': return send(page('<p>js</p>', '<script>window.__v=0;setTimeout(()=>{window.__v=1;window.__at=Date.now()},1000)</script>'));
    case '/push': return send(page('<p>push</p>', '<script>setTimeout(()=>{history.pushState({},"",location.pathname+location.search+"&stage=pushed");window.__at=Date.now()},1000)</script>'));
    case '/svg': return send(page('<svg width="10" height="10"><defs><text id="t">SvgDefsWord</text></defs></svg><textarea>AreaWord</textarea><div style="display:none">HiddenWord</div><input value="ValueWord">'));
    default: res.writeHead(404); res.end('nf');
  }
}

export async function launchObserver(extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-fr208-prof-'));
  const b = await puppeteer.launch({ executablePath: chromePath(), headless: true, userDataDir: dir, args: ['--no-sandbox', ...extraArgs], defaultViewport: { width: 1000, height: 800 } });
  logPid(b.process()?.pid, 'observer chrome ' + dir);
  return { browser: b, dir };
}

const NL = String.fromCharCode(10);
export function mcpClient(serverJs, env = process.env) {
  const child = spawn(process.execPath, [serverJs], { stdio: ['pipe', 'pipe', 'pipe'], env });
  logPid(child.pid, 'mcp server ' + serverJs);
  let buf = ''; let id = 1; const pending = new Map();
  child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf(NL)) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue; let m; try { m = JSON.parse(l); } catch { continue; } if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } } });
  child.stderr.on('data', () => {});
  const call = (method, params, to = 90000) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + NL); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('rpc timeout ' + method)); } }, to); });
  return { child, call, notify: (m, p) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: m, params: p }) + NL) };
}

export async function mcpSession(serverJs, wsEndpoint) {
  const c = mcpClient(serverJs);
  await c.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit', version: '1' } });
  c.notify('notifications/initialized');
  const att = JSON.parse((await c.call('tools/call', { name: 'browser.attach', arguments: { endpoint: wsEndpoint } })).content[0].text);
  const sid = att.sessionId;
  const tool = async (name, a = {}, to = 90000) => {
    const t0 = mono(); const sentAt = Date.now();
    let r; let err;
    try { r = await c.call('tools/call', { name, arguments: { sessionId: sid, ...a } }, to); } catch (e) { err = e.message; }
    const ms = Math.round(mono() - t0);
    const text = r?.content?.[0]?.text ?? '';
    let json; try { json = JSON.parse(text); } catch {}
    return { ms, sentAt, recvAt: Date.now(), isError: !!r?.isError, text, json, rpcError: err };
  };
  const listBytes = async () => { const r = await c.call('tools/list', {}); return { n: r.tools.length, bytes: Buffer.byteLength(JSON.stringify(r.tools), 'utf8'), tools: r.tools }; };
  const close = async () => { try { await tool('browser.shutdown', {}, 10000); } catch {} c.child.stdin.end(); };
  return { sid, tool, close, child: c.child, listBytes };
}

export async function pageFor(browser, prefix, ms = 8000) {
  const t0 = mono();
  for (;;) { const p = (await browser.pages()).find((x) => x.url().startsWith(prefix)); if (p) return p; if (mono() - t0 > ms) throw new Error('observer never saw ' + prefix); await delay(50); }
}

export const results = [];
export function rec(id, pass, data) { results.push({ id, pass, ...data }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(data).slice(0, 700)}`); }
