// Fixture HTTP server for FR2-05 (download directory / upload roots) live-verify.
// See .ai/loop/field-report-2/evidence/FR2-05/spec.md §3.
import http from 'node:http';
import crypto from 'node:crypto';

/**
 * Starts the fixture server on 127.0.0.1:0. Returns:
 *  - origin: the server's base URL
 *  - pageUrl(caseId, opts): builds a /page URL for a given case id and download filename
 *  - served: array of {caseId, req, name, size, sha256} — independent ground truth for every
 *    /file response actually sent, in request order
 *  - close(): shuts the server down
 */
export async function startDownloadServer() {
  const served = [];
  let reqCounter = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/page') {
      const caseId = url.searchParams.get('case') ?? '0';
      const name = url.searchParams.get('name') ?? `file-${caseId}.bin`;
      // FR2-07 (additive): `empty=1` makes the download link ask /file for a 0-byte body.
      const emptyQs = url.searchParams.get('empty') === '1' ? '&empty=1' : '';
      const html =
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>FR2-05 case ${caseId}</title></head>` +
        `<body>` +
        `<a id="dl" href="/file?case=${encodeURIComponent(caseId)}&name=${encodeURIComponent(name)}${emptyQs}">download</a>` +
        `<a id="dl-evil" href="/file?case=${encodeURIComponent(caseId)}&name=${encodeURIComponent('../../evil-' + caseId + '.txt')}">evil</a>` +
        `<input type="file" id="f">` +
        `<button id="pick" onclick="document.getElementById('f').click()">pick</button>` +
        `<div id="out"></div>` +
        `<script>` +
        `document.getElementById('f').addEventListener('change', function (e) {` +
        `  var file = e.target.files[0];` +
        `  document.getElementById('out').textContent = file ? (file.name + ':' + file.size) : '';` +
        `});` +
        `</script>` +
        `</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url.pathname === '/file') {
      const caseId = url.searchParams.get('case') ?? '0';
      const name = url.searchParams.get('name') ?? 'file.bin';
      reqCounter += 1;
      const n = reqCounter;
      const header = Buffer.from(`fr2-05 case=${caseId} req=${n}\n`, 'utf-8');
      // FR2-07 (additive): `empty=1` -> Content-Length 0 (a server that "succeeds" with no bytes).
      const body =
        url.searchParams.get('empty') === '1' ? Buffer.alloc(0) : Buffer.concat([header, crypto.randomBytes(65536)]);
      const sha256 = crypto.createHash('sha256').update(body).digest('hex');
      served.push({ caseId, req: n, name, size: body.length, sha256 });
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      });
      res.end(body);
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
    pageUrl: (caseId, opts = {}) =>
      `${origin}/page?case=${encodeURIComponent(caseId)}&name=${encodeURIComponent(opts.name ?? `${caseId}.bin`)}${opts.empty ? '&empty=1' : ''}`,
    served,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
      }),
  };
}
