// Auditor-2: snapshot-before-action / stale-read probes for expect over the built MCP server (launch mode:
// Sutradhar is the only CDP client). Text that the ACTION removes/hides must be contradicted; text the
// action adds must be verified; navigating away from a page must not verify the OLD page's text.
// Usage: node stale-read.mjs <repoRoot> <outJsonl> [--server=entry]
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
const [repoRoot, outFile] = process.argv.slice(2);
const sArg = process.argv.find((a) => a.startsWith('--server='));
const entry = sArg ? sArg.slice(9) : path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
const NL = String.fromCharCode(10);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 8 * 60 * 1000);
const PAGE = '<!doctype html><html><body><p id="t">OLDTEXTQQ1</p><p id="h">HIDETEXTQQ2</p><div id="out"></div>' +
  '<button id="rm" onclick="document.getElementById(\'t\').remove()">rm</button>' +
  '<button id="hide" onclick="document.getElementById(\'h\').style.display=\'none\'">hide</button>' +
  '<button id="add" onclick="document.getElementById(\'out\').textContent=\'NEW\'+\'TEXTQQ3\'">add</button>' +
  '<button id="late" onclick="setTimeout(function(){document.getElementById(\'out\').textContent=\'LATE\'+\'TEXTQQ4\'},400)">late</button>' +
  '<a id="go" href="/other">go</a></body></html>';
const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(req.url.startsWith('/other') ? '<!doctype html><p>OTHERPAGEQQ5</p>' : PAGE); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + srv.address().port;
const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; let next = 1; const pend = new Map();
child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf(NL)) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } });
child.stderr.on('data', () => {});
const call = (method, params) => new Promise((res, rej) => { const id = next++; pend.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + NL); setTimeout(() => { if (pend.has(id)) rej(new Error('timeout')); }, 90000); });
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a2', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + NL);
const tl = async (name, a) => { const m = await call('tools/call', { name, arguments: a }); const t = m.result?.content?.[0]?.text; let j; try { j = JSON.parse(t); } catch {} return j ?? { raw: t }; };
const launched = await tl('browser.launch', { headless: true });
const sessionId = launched.sessionId ?? launched.id;
console.log('PIDS', JSON.stringify({ mcp: child.pid, self: process.pid, sessionId }));
const T = (name, a) => tl(name, { sessionId, ...a });
const rows = [];
const rec = (id, want, j) => { const tier = j?.verification?.evidence?.tier; const ok = tier === want; rows.push({ id, want, tier, pass: ok, reason: j?.verification?.reason?.slice(0, 200) }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' want=' + want + ' got=' + tier + ' :: ' + (j?.verification?.reason ?? JSON.stringify(j)).slice(0, 160)); };
const fresh = async () => { await delay(1100); await T('browser.navigate', { url: origin + '/p?n=' + Math.random() }); };
await fresh(); rec('removed-text', 'contradicted', await T('browser.click', { target: '#rm', expect: { text: 'OLDTEXTQQ1' } }));
await fresh(); rec('hidden-by-action', 'contradicted', await T('browser.click', { target: '#hide', expect: { text: 'HIDETEXTQQ2' } }));
await fresh(); rec('added-text', 'verified', await T('browser.click', { target: '#add', expect: { text: 'NEWTEXTQQ3' } }));
await fresh(); rec('late-text-no-settle', 'contradicted', await T('browser.click', { target: '#late', expect: { text: 'LATETEXTQQ4' } }));
await fresh(); rec('nav-away-old-text', 'contradicted', await T('browser.navigate', { url: origin + '/other?x=1', expect: { text: 'OLDTEXTQQ1' } }));
await fresh(); rec('nav-new-text', 'verified', await T('browser.navigate', { url: origin + '/other?x=2', expect: { text: 'OTHERPAGEQQ5' } }));
await fresh(); rec('link-click-old-text', 'contradicted', await T('browser.click', { target: '#go', expect: { text: 'OLDTEXTQQ1' } }));
await fs.writeFile(outFile, rows.map((r) => JSON.stringify(r)).join(NL) + NL);
console.log('SUMMARY', rows.filter((r) => r.pass).length, '/', rows.length);
try { await T('browser.shutdown', {}); } catch {}
child.stdin.end(); await delay(800); try { child.kill(); } catch {}
srv.close(); clearTimeout(HARD); process.exit(0);
