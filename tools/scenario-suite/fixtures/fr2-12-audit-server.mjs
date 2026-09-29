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

/** GAP-266 fix-2 repro: a real console error BEFORE a same-document navigation, a same-document
 *  navigation (history.replaceState / pushState / a hash change, chosen by `via`) partway through
 *  the page's own life, and a real console error + a real 404 fetch AFTER it. The fix under test
 *  is that NEITHER error, nor the 404, is dropped just because a same-document nav happened
 *  in between -- `since` must never move because of it. */
function sameDocPage(n, via) {
  const navCall =
    via === 'pushState'
      ? `history.pushState({}, '', location.pathname + '?n=${n}&pushed=1')`
      : via === 'hash'
        ? `location.hash = 'section-${n}'`
        : `history.replaceState({}, '', location.pathname + '?n=${n}&replaced=1')`;
  const script = `
    console.error('samedoc-before-${n}');
    setTimeout(function () {
      ${navCall};
      setTimeout(function () {
        console.error('samedoc-after-${n}');
        fetch('/missing-samedoc-${n}.png').catch(function () {});
      }, 150);
    }, 150);
  `;
  return `<html lang="en"><head><meta charset="utf-8"><title>SameDoc ${n}</title></head><body style="margin:0">` +
    `<h1>SameDoc fixture ${n}</h1><script>${script}</script></body></html>`;
}

/** GAP-266 fix-2, multi-hop variant: THREE same-document navigations in a row (replaceState,
 *  then pushState, then a hash change), each separated by a real console error -- kills a fix
 *  that only guards against a single same-document nav. */
function sameDocMultiPage(n) {
  const script = `
    console.error('samedoc-multi-0-${n}');
    setTimeout(function () {
      history.replaceState({}, '', location.pathname + '?n=${n}&r=1');
      console.error('samedoc-multi-1-${n}');
      setTimeout(function () {
        history.pushState({}, '', location.pathname + '?n=${n}&p=1');
        console.error('samedoc-multi-2-${n}');
        setTimeout(function () {
          location.hash = 'sec-${n}';
          console.error('samedoc-multi-3-${n}');
          fetch('/missing-samedoc-multi-${n}.png').catch(function () {});
        }, 100);
      }, 100);
    }, 100);
  `;
  return `<html lang="en"><head><meta charset="utf-8"><title>SameDocMulti ${n}</title></head><body style="margin:0">` +
    `<h1>SameDocMulti fixture ${n}</h1><script>${script}</script></body></html>`;
}

/** GAP-266 fix-2: a synthetic stand-in for what audit-2's live sweep found on 8/10 real sites --
 *  a same-document `history.replaceState` fired very shortly (well inside the settle window)
 *  after the page's own load, the way a hydrating SPA framework commonly does, WITH a real error
 *  on either side of it. */
function spaLikePage(n) {
  const script = `
    console.error('spa-like-hydration-error-${n}');
    history.replaceState({}, '', location.pathname + '?n=${n}&hydrated=1');
    setTimeout(function () { console.error('spa-like-post-hydration-error-${n}'); }, 50);
  `;
  return `<html lang="en"><head><meta charset="utf-8"><title>SpaLike ${n}</title></head><body style="margin:0">` +
    `<h1>SpaLike fixture ${n}</h1><script>${script}</script></body></html>`;
}

/** GAP-267 fix-2: the audited page's OWN main-document HTTP response is itself an error status
 *  (a real 404/500 on the requested URL, not just a sub-resource 404 the page fetches). */
function ownStatusPage(n, status) {
  return { status, body: `<html lang="en"><head><meta charset="utf-8"><title>OwnStatus ${n}</title></head><body style="margin:0">` +
    `<h1>Own-status ${status} fixture ${n}</h1><script>console.error('own-status-${status}-${n}');</script></body></html>` };
}

/** GAP-273 fix-3: the audited page's OWN 404, which THEN does a same-document navigation
 *  (hash change or history.replaceState) shortly after load -- the exact shape that defeated
 *  fix-2's final-`page.url()` string match (the final URL no longer equals the response URL,
 *  even though the response itself really was this page's own 404). */
function ownStatusThenSameDocPage(n, via) {
  const navCall =
    via === 'hash' ? `location.hash = 'sec-${n}'` : `history.replaceState({}, '', location.pathname + '?n=${n}&replaced=1')`;
  const script = `console.error('own-status-samedoc-404-${n}'); setTimeout(function () { ${navCall}; }, 150);`;
  return `<html lang="en"><head><meta charset="utf-8"><title>OwnStatusSameDoc ${n}</title></head><body style="margin:0">` +
    `<h1>Own-status 404 + same-doc (${via}) fixture ${n}</h1><script>${script}</script></body></html>`;
}

/** GAP-268 fix-2: what would defeat a one-sided guard next -- TWO dialogs opening during
 *  capture, not just one (an alert followed almost immediately by a confirm). */
function alertConfirmPage(n, delayMs) {
  const script = `setTimeout(function () { alert('fr2-12-audit-alert-${n}'); confirm('fr2-12-audit-confirm-${n}'); }, ${delayMs});`;
  return `<html lang="en"><head><meta charset="utf-8"><title>AlertConfirm ${n}</title></head><body style="margin:0">` +
    `<h1>AlertConfirm fixture ${n}</h1><script>${script}</script></body></html>`;
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
    if (url.pathname === '/alert-confirm') {
      const delayMs = Number(url.searchParams.get('delayMs') ?? '0');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(alertConfirmPage(n, delayMs));
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
    if (url.pathname === '/samedoc') {
      const via = url.searchParams.get('via') ?? 'replaceState';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(sameDocPage(n, via));
      return;
    }
    if (url.pathname === '/samedoc-multi') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(sameDocMultiPage(n));
      return;
    }
    if (url.pathname === '/spa-like') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(spaLikePage(n));
      return;
    }
    if (url.pathname === '/own-404') {
      const { status, body } = ownStatusPage(n, 404);
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }
    if (url.pathname === '/own-500') {
      const { status, body } = ownStatusPage(n, 500);
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }
    if (url.pathname === '/own-404-samedoc') {
      // GAP-273 fix-3: hash-setting / replaceState 404.
      const via = url.searchParams.get('via') ?? 'hash';
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ownStatusThenSameDocPage(n, via));
      return;
    }
    if (url.pathname === '/own-404-emptybody') {
      // GAP-273 fix-3: an error status with a Content-Length: 0 (truly empty) body -- the shape
      // audit-3 found makes Chrome substitute its own "friendly" error document, so
      // `page.url()` becomes `chrome-error://chromewebdata/` and never matches the real
      // response URL. The real Network.responseReceived event for THIS response (status 404,
      // frameId = main frame, type Document) still fires before Chrome swaps the document, which
      // is exactly what fix-3's live capture is keyed on instead of the final page.url().
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '0' });
      res.end();
      return;
    }
    if (url.pathname === '/own-500-emptybody') {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '0' });
      res.end();
      return;
    }
    if (url.pathname === '/own-redirect-404') {
      // A 302 chain whose FINAL hop is the audited page's own 404 (GAP-267's "302 chain ending in
      // a 404" shape) -- Location is relative so it stays on the same fixture origin.
      res.writeHead(302, { Location: `/own-404?n=${n}` });
      res.end();
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
