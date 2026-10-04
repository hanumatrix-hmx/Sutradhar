// Release 0.6.2 fixture server (product-independent: node:http only; no import from the repo).
// start() -> { url, port, hits, setPdf, close }, listening on 127.0.0.1:0.
// Every HTML route carries a marker comment <!--FIXTURE:<name>--> that the self-test asserts.
import http from 'node:http';

/** Indices (UTF-16 code units, in document.body.innerText) of the HIGH surrogate of each emoji pair in /long-emoji. */
export const EMOJI_PAIR_HIGH_INDICES = [3999, 5000, 7999, 10001];
export const EMOJI_TOTAL_LENGTH = 12000;
const EMOJI = '\u{1F600}'; // 2 UTF-16 code units

function longText(n) {
  const lines = [];
  let total = 0;
  let i = 1;
  while (total < n) {
    // Fixed width line: 'L' + 6 digits + ' ' + 33 filler chars = 40 chars, plus the newline innerText adds between divs.
    const line = `L${String(i).padStart(6, '0')} ${'abcdefghijklmnopqrstuvwxyz0123456'}`;
    lines.push(line);
    total += line.length + 1;
    i++;
  }
  return lines;
}

function emojiText() {
  // Build a plain string of EMOJI_TOTAL_LENGTH code units, ASCII except the pairs at EMOJI_PAIR_HIGH_INDICES.
  const chars = new Array(EMOJI_TOTAL_LENGTH);
  for (let i = 0; i < EMOJI_TOTAL_LENGTH; i++) chars[i] = String.fromCharCode(97 + (i % 26)); // a..z
  let s = '';
  let i = 0;
  const highs = new Set(EMOJI_PAIR_HIGH_INDICES);
  while (i < EMOJI_TOTAL_LENGTH) {
    if (highs.has(i)) { s += EMOJI; i += 2; } else { s += chars[i]; i += 1; }
  }
  return s;
}

const page = (name, title, body, head = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}<!--FIXTURE:${name}--></body></html>`;

export function start() {
  const hits = [];
  let pdfBytes = Buffer.from('%PDF-1.4\n%fixture-not-set\n');
  const counters = { reload: 0 };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    hits.push(u.pathname + u.search);
    const html = (s, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(s); };
    const p = u.pathname;

    if (p === '/long') {
      const n = Math.max(1, Number(u.searchParams.get('n') ?? 10000) | 0);
      const lines = longText(n);
      return html(page('long', 'Long page', lines.map((l) => `<div>${l}</div>`).join('')));
    }
    if (p === '/long-emoji') {
      return html(page('long-emoji', 'Long emoji page', `<pre id="t" style="margin:0;white-space:pre-wrap">${emojiText()}</pre>`));
    }
    if (p === '/short') {
      const t = 'Short fixture page. '.repeat(15).trim(); // 299 chars
      return html(page('short', 'Short page', `<p>${t}</p>`));
    }
    if (p === '/blank') {
      return html(page('blank', 'blank', '<p>blank child</p>'));
    }
    if (p === '/churn') {
      const k = Math.max(0, Number(u.searchParams.get('k') ?? 8) | 0);
      const ms = Math.max(1, Number(u.searchParams.get('ms') ?? 25) | 0);
      const self = req.url; // the top URL (kept verbatim so one iframe has src == top document URL)
      const buttons = [1, 2, 3, 4, 5].map((i) => `<button id="b${i}" onclick="window.__clicks.b${i}++">Button ${i}</button>`).join(' ');
      const script = `
        (function () {
          var K = ${k}, MS = ${ms}, SELF = ${JSON.stringify(self)};
          if (window !== window.top) { return; } // children never create iframes
          window.__clicks = { b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, late: 0 };
          window.__recreated = 0;
          window.__arm = function (d) { setTimeout(function () { var el = document.getElementById('late'); if (el) { el.style.display = ''; } }, d); };
          var holder = document.getElementById('frames');
          function mk(i) {
            var f = document.createElement('iframe');
            f.setAttribute('data-churn', String(i));
            f.style.cssText = 'width:80px;height:40px;border:0';
            f.src = (i === 0) ? SELF : '/blank?i=' + i;
            return f;
          }
          for (var i = 0; i < K; i++) { holder.appendChild(mk(i)); }
          setInterval(function () {
            for (var j = 0; j < K; j++) {
              var old = holder.children[j];
              var nf = mk(j);
              if (old) { holder.replaceChild(nf, old); } else { holder.appendChild(nf); }
              window.__recreated++;
            }
          }, MS);
        })();`;
      return html(page('churn', 'Churn page',
        `<div id="main">${buttons} <button id="late" style="display:none" onclick="window.__clicks.late++">Late button</button></div><div id="frames"></div><script>${script}</script>`));
    }
    if (p === '/nodeid-frame') {
      return html(page('nodeid-frame', 'Frame Title', '<button id="fb" onclick="window.__frameClicks=(window.__frameClicks||0)+1">Frame Go</button>'));
    }
    if (p === '/nodeid') {
      return html(page('nodeid', 'Nodeid page',
        `<button id="go" onclick="window.__goClicks=(window.__goClicks||0)+1">Go</button> <input id="inp" type="text" aria-label="Name"> <iframe id="fr" title="inner frame" src="/nodeid-frame" style="width:300px;height:80px"></iframe><script>window.__goClicks=0;</script>`));
    }
    if (p === '/hist/a' || p === '/hist/b') {
      const nm = p.slice(-1);
      return html(page(`hist-${nm}`, `Hist ${nm.toUpperCase()}`,
        `<h1>History page ${nm.toUpperCase()}</h1><script>window.addEventListener('pageshow', function (e) { var nav = performance.getEntriesByType('navigation')[0]; window.__nav = { type: nav && nav.type, persisted: e.persisted }; });</script>`));
    }
    if (p === '/hist/spa') {
      return html(page('hist-spa', 'Hist SPA',
        `<h1>History SPA</h1><script>history.pushState({}, '', '#2'); location.hash = 'x';</script>`));
    }
    if (p === '/reload-count') {
      counters.reload += 1;
      return html(page('reload-count', 'Reload count', `<h1 id="n">Reload count: ${counters.reload}</h1>`));
    }
    if (p === '/beforeunload') {
      return html(page('beforeunload', 'Beforeunload page',
        `<button id="arm-bu" onclick="window.onbeforeunload=function(e){e.preventDefault();e.returnValue='';return '';};window.__armed=true;">Arm</button>`));
    }
    if (p === '/pdf') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', 'inline');
      res.setHeader('content-length', String(pdfBytes.length));
      return res.end(pdfBytes);
    }
    res.statusCode = 404; res.setHeader('content-type', 'text/plain'); res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        hits,
        setPdf: (buf) => { pdfBytes = Buffer.from(buf); },
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}
