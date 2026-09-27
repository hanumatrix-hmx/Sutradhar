// Fixture HTTP server for FR2-12 (Machine-readable audit) live-verify and step-0 experiments.
// See .ai/loop/field-report-2/evidence/FR2-12/spec.md §3 for the exact route design and expected
// audit truth per route. Reusable module (not inline code) because FR2-13's `maxConsoleErrors`/
// `failOnBrokenRequests` gates need exactly this same page (spec T21/§3).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');
const require_ = createRequire(path.join(repoRoot, 'packages', 'capability-runtime', 'package.json'));
const { PNG } = require_('pngjs');

/** A tiny solid-color PNG, generated at startup so no binary is committed to git. */
function makePng(w, h) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (w * y + x) << 2;
      png.data[idx] = 80;
      png.data[idx + 1] = 160;
      png.data[idx + 2] = 220;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const OK_PNG = makePng(40, 40);

function html(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${body.title}</title>${body.headExtra ?? ''}</head><body style="margin:0">${body.bodyHtml}${body.script ? `<script>${body.script}</script>` : ''}</body></html>`;
}

function auditPage(n, slowMs) {
  const script = `
    console.error('fr2-12-console-${n}');
    setTimeout(()=>{throw new Error('fr2-12-pageerror-${n}')},0);
    fetch('/api/fail-${n}').catch(()=>{});
    ${slowMs ? `fetch('/slow-404-${n}?ms=${slowMs}').catch(()=>{});` : ''}
    setTimeout(()=>{ var s=document.getElementById('slot'); if (s) s.style.height='200px'; window.__fr212ShiftDone=true; },300);
  `;
  return `<html><head><meta charset="utf-8"><title>FR2-12 audit ${n}</title></head><body style="margin:0">` +
    `<div id="slot" style="height:0"></div>` +
    `<h1 style="font-size:48px">FR2-12 audit fixture ${n}</h1>` +
    `<p style="height:1200px">filler ${n}</p>` +
    `<img src="/img/ok.png" width="40" height="40">` +
    `<img src="/missing-${n}.png" alt="m">` +
    `<input id="q">` +
    `<label for="ok">OK</label><input id="ok">` +
    `<button></button>` +
    `<script>${script}</script></body></html>`;
}

function cleanPage(n) {
  return `<html lang="en"><head><meta charset="utf-8"><title>Clean ${n}</title></head><body style="margin:0">` +
    `<h1>Clean ${n}</h1><img src="/img/ok.png" alt="ok" width="40" height="40"></body></html>`;
}

function noisyPage(n) {
  const script = `console.error('noisy-${n}'); setTimeout(()=>{throw new Error('noisy-pageerror-${n}')},0);`;
  return `<html lang="en"><head><meta charset="utf-8"><title>Noisy ${n}</title></head><body style="margin:0">` +
    `<img src="/missing-noisy-${n}.png" alt="x"><script>${script}</script></body></html>`;
}

/** GAP-262 fix-1: an "old page" that keeps logging a console error and fetching a 404 on a
 *  short (25ms) interval for as long as it's alive -- used to prove the contamination-scope fix
 *  actually closes the whole navigate-call-to-commit window, not just the single-shot noise the
 *  original `/noisy` page produces (which a slow enough "clean" response could dodge by luck). */
function noisyIntervalPage(n) {
  const script = `
    var i = 0;
    var t = setInterval(function () {
      i++;
      console.error('noisy-interval-${n}-' + i);
      fetch('/missing-noisy-interval-${n}-' + i).catch(function () {});
    }, 25);
    window.addEventListener('pagehide', function () { clearInterval(t); });
  `;
  return `<html lang="en"><head><meta charset="utf-8"><title>NoisyInterval ${n}</title></head><body style="margin:0">` +
    `<script>${script}</script></body></html>`;
}

/** A dialog fixture: fires a native `alert()` a short, controllable delay after load -- used to
 *  reproduce GAP-261's "mid-audit alert" shape (the dialog opens sometime after navigation has
 *  already settled, while the audit itself is running against the page). */
function alertPage(n, delayMs) {
  const script = `setTimeout(function () { alert('fr2-12-audit-alert-${n}'); }, ${delayMs});`;
  return `<html lang="en"><head><meta charset="utf-8"><title>Alert ${n}</title></head><body style="margin:0">` +
    `<h1>Alert fixture ${n}</h1><script>${script}</script></body></html>`;
}

function shiftPage(n) {
  const script = `setTimeout(()=>{ var s=document.getElementById('slot'); if (s) s.style.height='200px'; window.__fr212ShiftDone=true; },300);`;
  return `<html lang="en"><head><meta charset="utf-8"><title>Shift ${n}</title></head><body style="margin:0">` +
    `<div id="slot" style="height:0"></div><h1 style="font-size:48px">Shift fixture ${n}</h1>` +
    `<script>${script}</script></body></html>`;
}

/**
 * Starts the fixture server on 127.0.0.1:0 (an OS-assigned free port). Returns the origin and a
 * close() to shut it down.
 */
export async function startAuditFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const n = url.searchParams.get('n') ?? '0';
    const slow = url.searchParams.get('slow');

    if (url.pathname === '/audit') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(auditPage(n, slow ? Number(slow) : undefined));
      return;
    }
    if (url.pathname === '/clean') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(cleanPage(n));
      return;
    }
    if (url.pathname === '/noisy') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(noisyPage(n));
      return;
    }
    if (url.pathname === '/noisy-interval') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(noisyIntervalPage(n));
      return;
    }
    if (url.pathname === '/alert') {
      const delayMs = Number(url.searchParams.get('delayMs') ?? '0');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(alertPage(n, delayMs));
      return;
    }
    if (url.pathname === '/clean-delayed') {
      // GAP-262: a "normal" (not artificially slow) response delay for the NEW page -- audit-1
      // found the contamination leak persists even at ~150ms, not just a pathologically slow one.
      const delayMs = Number(url.searchParams.get('delayMs') ?? '150');
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(cleanPage(n));
      }, delayMs);
      return;
    }
    if (url.pathname === '/shift') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(shiftPage(n));
      return;
    }
    if (url.pathname === '/img/ok.png' || url.pathname === '/favicon.ico') {
      // Chrome auto-requests /favicon.ico for every navigation; serving 200 here keeps the
      // "clean" fixture page genuinely clean (no incidental 404/console-error noise unrelated
      // to anything the test actually set up).
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(OK_PNG);
      return;
    }
    if (url.pathname.startsWith('/api/fail-')) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('fail');
      return;
    }
    if (url.pathname.startsWith('/slow-404-')) {
      const ms = Number(url.searchParams.get('ms') ?? '0');
      setTimeout(() => {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('slow-not-found');
      }, ms);
      return;
    }
    if (url.pathname.startsWith('/missing-')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not-found');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not-found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const addr = server.address();
  const origin = `http://127.0.0.1:${addr.port}`;
  return {
    origin,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
      }),
  };
}
