// FR2-11 fix-2: the concrete shapes audit-2 found leaking (and the ones that each protect ONE rule), for the LIVE runs on MCP, CLI,
// SDK and the bundle. Every shape has its own canary (CNRY...), so a leak points at exactly one shape.
//   kind 'url'   : navigable (or at least passable to navigate; a refusal is expected and is itself recorded),
//   kind 'path'  : a local path (Windows, UNC, forward slashes, POSIX),
//   kind 'bare'  : a bare token with no URL and no path (only one rule protects it).
const BS = String.fromCharCode(92);

export function fix2Shapes(origin, tag) {
  const out = [];
  const add = (id, kind, build, extra = {}) => {
    const canary = `CNRYfx2${id.replace(/[^A-Za-z0-9]/g, '')}${tag}`;
    out.push({ id, kind, canary, text: build(canary), ...extra });
  };
  // audit-2 A2-F1: the RFC 8252 private-use redirect, about:blank, a single-label host:port
  add('custom-scheme-redirect', 'url', (c) => `com.example.app:/cb#access_token=${c}`);
  add('custom-scheme-redirect-query', 'url', (c) => `com.example.app:/cb?code=${c}`);
  add('about-blank-frag', 'url', (c) => `about:blank#${c}`, { keepTarget: 'about:blank' });
  add('about-blank-query', 'url', (c) => `about:blank?${c}`, { keepTarget: 'about:blank' });
  add('intranet-port-frag', 'url', (c) => `intranet:8080/p#${c}`);
  add('single-label-host', 'url', (c) => `http://intranet-host-${tag}/p#${c}`);
  // a URL with a space (Chrome percent-encodes it; the stored message may still carry the raw one)
  add('url-space-frag', 'url', (c) => `${origin}/fr2-11-history.html?a=1 b#${c}`, { keepTarget: `${origin}/fr2-11-history.html` });
  add('url-space-path-frag', 'url', (c) => `${origin}/my dir#${c}`, { keepTarget: origin });
  add('url-space-query-tail', 'url', (c) => `${origin}/fr2-11-history.html?q=ab ${c}`, { keepTarget: `${origin}/fr2-11-history.html` });
  // isolated rule cells
  add('bare-fragment', 'bare', (c) => `#${c}`);
  add('bare-query-eq', 'bare', (c) => `?=${c}`);
  add('form-token', 'bare', (c) => `a=${c}`);
  add('userinfo-noscheme', 'bare', (c) => `user:${c}@host/`);
  add('pct-hash', 'bare', (c) => `%23${c}`);
  add('pct-hash-double', 'bare', (c) => `x%253F${c}`);
  add('nbsp-tail', 'bare', (c) => `https://x.test/p?a=1${String.fromCharCode(0xa0)}${c}`);
  // paths: any drive letter, UNC, slash direction
  add('win-backslash', 'path', (c) => `C:${BS}Users${BS}${c}${BS}docs${BS}f.txt`, { keepPath: 'f.txt' });
  add('win-forward', 'path', (c) => `C:/Users/${c}/docs/f.txt`, { keepPath: 'f.txt' });
  add('win-other-drive', 'path', (c) => `Z:${BS}work${BS}${c}${BS}f.txt`, { keepPath: 'f.txt' });
  add('unc', 'path', (c) => `${BS}${BS}srv${BS}share${BS}${c}${BS}f.txt`, { keepPath: 'f.txt' });
  add('unc-forward', 'path', (c) => `//srv/share/${c}/f.txt`, { keepPath: 'f.txt' });
  add('posix', 'path', (c) => `/home/${c}/docs/f.txt`, { keepPath: 'f.txt' });
  add('home-dir-only', 'path', (c) => `C:${BS}Users${BS}${c}`);
  return out;
}

/** Non-URL-scheme shapes that can be handed to page.goto / navigate without Chrome doing anything unsafe. */
export const NAVIGABLE_IDS = new Set([
  'custom-scheme-redirect', 'custom-scheme-redirect-query', 'about-blank-frag', 'about-blank-query', 'intranet-port-frag', 'single-label-host',
  'url-space-frag', 'url-space-path-frag', 'url-space-query-tail',
]);
