// Fixture HTTP server for FR2-07 (the single verification contract) live-verify.
// See .ai/loop/field-report-2/evidence/FR2-07/spec.md §3.
//
// Listens on BOTH 127.0.0.1:P and [::1]:P so `http://localhost:P` works whichever address
// `localhost` resolves to (never 0.0.0.0). `origin` (127.0.0.1) and `crossOrigin` (localhost) are
// different SITES, so the frame served from `crossOrigin` is an out-of-process iframe under
// Chrome's default site isolation. Every response is `Cache-Control: no-store`; per-case
// uniqueness goes ONLY in the query string (the FR2-01 gotcha: a fragment-only change is a
// same-document no-op).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUNG_FRAME_PAGE, hungPage, matrixCases, shell } from './fr2-07-matrix.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const SPOOF_SCRIPT =
  // The liar: a page that monkey-patches the async clipboard API in ITS OWN (main) world so that
  // writeText is a silent no-op and readText echoes the last "written" value back. An isolated
  // world (a separate JS realm over the same DOM) does not see any of this.
  '<script>(function(){var last="";' +
  'navigator.clipboard.writeText=async function(t){last=t;};' +
  'navigator.clipboard.readText=async function(){return last;};})();</script>';

function navPage(title) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1></body></html>`;
}

/**
 * Starts the server. Returns `{port, origin, crossOrigin, url(path, nonce), close()}`.
 */
export async function startFr207Server() {
  const pageHtml = await fs.readFile(path.join(here, 'fr2-07-verification.html'), 'utf-8');
  const frameHtml = await fs.readFile(path.join(here, 'fr2-07-frame.html'), 'utf-8');
  const hiddenTextHtml = await fs.readFile(path.join(here, 'fr2-07-hidden-text.html'), 'utf-8');
  const prob043Html = await fs.readFile(path.join(here, 'prob043-keyboard.html'), 'utf-8');
  let port = 0;
  /** responses of /matrix-hold parked until releaseHeld() (the hung-frame fixture) */
  const held = new Set();
  const releaseHeld = () => {
    for (const r of held) {
      try { r.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); r.end('released'); } catch { /* client gone */ }
    }
    held.clear();
  };
  const matrix = new Map(matrixCases().map((c) => [c.id, c]));

  const handler = (req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
      res.end(body);
    };
    switch (u.pathname) {
      case '/page.html': {
        let html = pageHtml.replaceAll('__XO_ORIGIN__', `http://localhost:${port}`);
        html = html.replace('<!--SPOOF-->', u.searchParams.get('spoofClipboard') === '1' ? SPOOF_SCRIPT : '');
        return send(200, html);
      }
      case '/frame.html':
        return send(200, frameHtml);
      case '/hidden-text.html':
        return send(200, hiddenTextHtml.replaceAll('__XO_ORIGIN__', `http://localhost:${port}`));
      case '/textframe.html': {
        const t = (u.searchParams.get('text') ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        return send(200, `<!doctype html><html><body><p>${t}</p></body></html>`);
      }
      case '/matrix': {
        const c = matrix.get(u.searchParams.get('case') ?? '');
        if (!c) return send(404, 'no such matrix case', { 'Content-Type': 'text/plain' });
        const tok = (u.searchParams.get('tok') ?? '').replace(/[^A-Za-z0-9_-]/g, '');
        return send(200, shell(c.html(`http://localhost:${port}`, tok), tok));
      }
      case '/matrix-frame':
        return send(200, `<!doctype html><html><body><p>${(u.searchParams.get('tok') ?? '').replace(/[^A-Za-z0-9_-]/g, '')}</p></body></html>`);
      case '/matrix-mid': {
        const c = matrix.get(u.searchParams.get('case') ?? '');
        if (!c?.mid) return send(404, 'no such matrix mid page', { 'Content-Type': 'text/plain' });
        return send(200, `<!doctype html><html><body>${c.mid(`http://localhost:${port}`, u.searchParams.get('tok') ?? '')}</body></html>`);
      }
      case '/matrix-hold': {
        held.add(res);
        const t = setTimeout(releaseHeld, 90000); // hard stop: never hold a renderer longer than 90 s
        t.unref();
        res.on('close', () => held.delete(res));
        return;
      }
      case '/matrix-hang':
        return send(200, HUNG_FRAME_PAGE);
      case '/matrix-hung': {
        const tokIn = u.searchParams.get('tokIn') ?? 'main';
        return send(200, hungPage(`http://localhost:${port}`, u.searchParams.get('tok') ?? '', { n: Number(u.searchParams.get('n') ?? 8), hungIndex: Number(u.searchParams.get('hung') ?? 3), hangOrigin: v6Listening ? `http://[::1]:${port}` : `http://localhost:${port}`, tokIn: tokIn === 'main' ? 'main' : Number(tokIn) }));
      }
      case '/prob043.html':
        return send(200, prob043Html);
      case '/nav/a':
        return send(200, navPage('Nav A'));
      case '/nav/b':
        return send(200, navPage('Nav B'));
      case '/nav/login':
        return send(200, navPage('Nav Login'));
      case '/nav/redirect':
        res.writeHead(302, { Location: '/nav/login', 'Cache-Control': 'no-store' });
        return res.end();
      case '/nav/missing':
        return send(404, navPage('Not found (404)'));
      case '/nav/form':
        return send(
          200,
          '<!doctype html><html><head><meta charset="utf-8"><title>Nav Form</title></head><body>' +
            '<form action="/nav/b" method="get"><input id="q" name="q"></form></body></html>',
        );
      default:
        return send(404, 'not-found', { 'Content-Type': 'text/plain' });
    }
  };

  const v4 = http.createServer(handler);
  await new Promise((resolve, reject) => {
    v4.once('error', reject);
    v4.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  port = v4.address().port;
  // The same port on IPv6 loopback, so `localhost` works if it resolves to ::1 first. Best effort:
  // a machine without IPv6 loopback simply doesn't get the second listener.
  const v6 = http.createServer(handler);
  let v6Listening = false;
  try {
    await new Promise((resolve, reject) => {
      v6.once('error', reject);
      v6.listen(port, '::1', () => resolve(undefined));
    });
    v6Listening = true;
  } catch {
    v6Listening = false;
  }

  const origin = `http://127.0.0.1:${port}`;
  return {
    port,
    origin,
    crossOrigin: `http://localhost:${port}`,
    v6Listening,
    releaseHeld,
    /** `url('/page.html', 'n1', 'spoofClipboard=1')` -> origin + path + ?n=<nonce>[&extra] */
    url: (p, nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`, extra = '') =>
      `${origin}${p}?n=${encodeURIComponent(nonce)}${extra ? `&${extra}` : ''}`,
    close: () => {
      releaseHeld();
      return Promise.all([
        new Promise((resolve) => v4.close(() => resolve(undefined))),
        v6Listening ? new Promise((resolve) => v6.close(() => resolve(undefined))) : Promise.resolve(),
      ]).then(() => undefined);
    },
  };
}
