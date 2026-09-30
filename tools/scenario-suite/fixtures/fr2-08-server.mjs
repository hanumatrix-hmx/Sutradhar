// Fixture HTTP server for FR2-08 (condition waits and settle everywhere) live-verify.
// See .ai/loop/field-report-2/evidence/FR2-08/spec.md section 3.
//
// Listens on 127.0.0.1:0 ONLY (never 0.0.0.0). Every response is `Cache-Control: no-store`, and every
// request is logged to `requests[]` (the network ground truth: a "pure setTimeout" case must show ZERO
// requests between load and the moment the effect appears). Per-case uniqueness goes ONLY in the query
// string (the FR2-01 gotcha: a fragment-only change is a same-document no-op).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The strict CSP of /csp.html: script-src allows ONLY the nonce'd inline script (no 'unsafe-eval'). */
export const CSP_HEADER = "script-src 'nonce-fr208'";

export async function startFr208Server() {
  const conditionsHtml = await fs.readFile(path.join(here, 'fr2-08-conditions.html'), 'utf-8');
  const cspHtml = await fs.readFile(path.join(here, 'fr2-08-csp.html'), 'utf-8');
  /** @type {Array<{path: string, at: number, ms?: number}>} */
  const requests = [];
  let port = 0;
  const handler = (req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const entry = { path: u.pathname + u.search, at: Date.now() };
    requests.push(entry);
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
      res.end(body);
    };
    switch (u.pathname) {
      case '/conditions.html':
        return send(200, conditionsHtml);
      case '/csp.html':
        return send(200, cspHtml, { 'Content-Security-Policy': CSP_HEADER });
      case '/slow': {
        const ms = Math.max(0, Math.min(10000, Number(u.searchParams.get('ms') ?? '0') || 0));
        setTimeout(() => {
          entry.doneAt = Date.now();
          send(200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
        }, ms);
        return;
      }
      case '/download.bin':
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="fr2-08.bin"',
          'Cache-Control': 'no-store',
        });
        return res.end(randomBytes(1024));
      case '/arrived.html':
        // 'Arri'+'ved' is built in script so the literal never sits in the page source
        return send(
          200,
          '<!doctype html><html><head><meta charset="utf-8"><title>arrived</title></head><body><h1 id="h"></h1>' +
            "<script>document.getElementById('h').textContent='Arri'+'ved';</script></body></html>",
        );
      case '/favicon.ico':
        return send(204, '');
      default:
        return send(404, 'not found', { 'Content-Type': 'text/plain' });
    }
  };
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  let nonce = 0;
  return {
    port,
    origin,
    requests,
    /** url('/conditions.html', { case: 'toast', delay: 2000 }) - adds a unique `n` so no two loads share a URL. */
    url(p, params = {}) {
      const q = new URLSearchParams({ ...params, n: `${Date.now().toString(36)}${(nonce++).toString(36)}` });
      return `${origin}${p}?${q.toString()}`;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
