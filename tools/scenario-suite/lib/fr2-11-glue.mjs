// FR2-11 fix-3: SEEDED GLUE generator (A3-F1). Companion of fr2-11-property.mjs, which puts ONE URL-ish thing in a token.
//
// audit-3 found that every property cell, isolated cell and fuzz string put at most one URL in a whitespace-free token, so the userinfo
// strip (first authority only) and the `scheme://` path exemption (whole token) were never exercised on TWO things glued together.
// This generator builds exactly those strings: 2 or 3 items (a URL, or a Windows / UNC / POSIX local path) joined by one of the glue
// delimiters (quotes, backtick, comma, parentheses, brackets, braces, angle brackets, pipe, caret, every Unicode format character)
// inside JSON, JS array / object / call text, with a secret in a slot of one (or every) item. The generator never calls the redactor.
//
// SECRET SLOTS: user:PASS@ userinfo, bare PASS@, a password that itself holds a delimiter, query, fragment, `;` params, a path-embedded
// segment of a local path, percent-encoded and double-encoded forms, unicode / IDN hosts. Each case has its OWN secret(s) (CGLU<i>x...).
export const GLUE_SEED = 20261101;

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (arr) => arr[int(arr.length)];
  return { next, int, pick, bool: (p = 0.5) => next() < p };
}

/** Every Unicode format character (category Cf) of the BMP and the tag block, found by the engine's own tables. */
export function cfChars() {
  const out = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (/^\p{Cf}$/u.test(ch)) out.push(ch);
  }
  return out;
}

// The glue delimiters of the fix-3 design. `class` names the rule that protects each one (used by the isolated cells).
export const QUOTES = ["'", '"', '`', '\\"', "\\'", '\\\\"'];
export const COMMAS = [','];
export const PARENS = ['(', ')'];
export const BRACKETS = ['[', ']'];
export const BRACES = ['{', '}'];
export const ANGLES = ['<', '>'];
export const PIPES = ['|', '^'];
export const DELIMS = [
  ...QUOTES, ...COMMAS, ...PARENS, ...BRACKETS, ...BRACES, ...ANGLES, ...PIPES,
  '","', "','", '", "', '\\",\\"', '),(', ')(', '][', '}{', '><', '`,`', '"|"', '",\n"', ',\u00ad', '\u00ad,', '"\u200b"',
  '\u00ad', '\u0600', '\u061c', '\u2066', '\u2069', '\ufeff', '\u200b', '\u200d', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2060', '\ufff9', '\u{e0001}', '\u{e0041}',
];

const SCHEMES = ['http', 'https', 'ftp', 'ws', 'wss', 'postgres', 'mongodb+srv', 'redis', 'custom-app', 'HTTPS'];
const HOSTS = ['h.test', 'h2.test', '127.0.0.1:5123', 'localhost', 'b\u00fccher.example', '\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444', 'xn--bcher-kva.example', '[::1]:9', 'db:5432', 'a-b.c-d.e', 'EXAMPLE.ORG', '\u4e2d\u6587.test'];
const PATHS = ['', '/', '/p', '/a/b', '/cb', '/app', '/x.html', '/deep/er/path'];
const FILES = ['doc.txt', 'f.pdf', 'a.b.png', 's.png'];

/** A URL item with NO secret (the clean neighbour). */
function cleanUrl(r) {
  return `${r.pick(['http', 'https', 'ws'])}://${r.pick(['h.test', '127.0.0.1:5123', 'localhost', 'a.test'])}${r.pick(PATHS)}`;
}

/** A URL item whose secret(s) sit in slot `slot`. Returns { text, secrets }. `weird` is a delimiter placed INSIDE the password. */
export function urlWithSecret(r, s, slot) {
  const scheme = r.pick(SCHEMES);
  const host = r.pick(HOSTS);
  const path = r.pick(PATHS);
  const u = `${scheme}://`;
  const w = r.pick(["'", '"', '(', ')', ',', '[', ']', '{', '}', '<', '>', '|', '`', '\u00ad', '\u200b', '\u202a', ':', '!', '*', '+', '$', '~']);
  switch (slot) {
    case 'userinfo':
      return { text: `${u}u:${s}a@${host}${path}`, secrets: [`${s}a`] };
    case 'userinfo-bare':
      return { text: `${u}${s}a@${host}${path}`, secrets: [`${s}a`] };
    case 'userinfo-weird':
      return { text: `${u}u:${s}a${w}${s}b@${host}${path}`, secrets: [`${s}a`, `${s}b`] };
    case 'userinfo-weird-bare':
      return { text: `${u}${s}a${w}${s}b@${host}${path}`, secrets: [`${s}a`, `${s}b`] };
    case 'userinfo-encoded':
      return { text: `${u}u%40x:${s}a%3A${s}b@${host}${path}`, secrets: [`${s}a`, `${s}b`] };
    case 'userinfo-2at':
      return { text: `${u}u:x@${s}a@${host}${path}`, secrets: [`${s}a`] };
    case 'query':
      return { text: `${u}${host}${path}?k=${s}a`, secrets: [`${s}a`] };
    case 'query-bare':
      return { text: `${u}${host}${path}?${s}a`, secrets: [`${s}a`] };
    case 'fragment':
      return { text: `${u}${host}${path}#${s}a`, secrets: [`${s}a`] };
    case 'fragment-route':
      return { text: `${u}${host}${path}#/r?t=${s}a`, secrets: [`${s}a`] };
    case 'params':
      return { text: `${u}${host}${path};jsessionid=${s}a`, secrets: [`${s}a`] };
    case 'params-bare':
      return { text: `${u}${host}${path};${s}a`, secrets: [`${s}a`] };
    case 'pct-query':
      return { text: `${u}${host}${path}%3Fk%3D${s}a`, secrets: [`${s}a`] };
    case 'pct-fragment':
      return { text: `${u}${host}${path}%23${s}a`, secrets: [`${s}a`] };
    case 'pct-params':
      return { text: `${u}${host}${path}%3B${s}a`, secrets: [`${s}a`] };
    case 'dbl-query':
      return { text: `${u}${host}${path}%253Fk%253D${s}a`, secrets: [`${s}a`] };
    case 'dbl-fragment':
      return { text: `${u}${host}${path}%2523${s}a`, secrets: [`${s}a`] };
    case 'userinfo+query':
      return { text: `${u}u:${s}a@${host}${path}?k=${s}b`, secrets: [`${s}a`, `${s}b`] };
    default:
      throw new Error('unknown url slot ' + slot);
  }
}
export const URL_SLOTS = [
  'userinfo', 'userinfo-bare', 'userinfo-weird', 'userinfo-weird-bare', 'userinfo-encoded', 'userinfo-2at', 'query', 'query-bare', 'fragment', 'fragment-route',
  'params', 'params-bare', 'pct-query', 'pct-fragment', 'pct-params', 'dbl-query', 'dbl-fragment', 'userinfo+query',
];

const bs = '\\';
/** A local path whose DIRECTORY segment is the secret (the path-embedded slot). */
export function pathWithSecret(r, s, form) {
  const f = r.pick(FILES);
  switch (form) {
    case 'win-back':
      return { text: `C:${bs}Users${bs}${s}a${bs}docs${bs}${f}`, secrets: [`${s}a`] };
    case 'win-fwd':
      return { text: `C:/Users/${s}a/docs/${f}`, secrets: [`${s}a`] };
    case 'win-json':
      return { text: `C:${bs}${bs}Users${bs}${bs}${s}a${bs}${bs}${f}`, secrets: [`${s}a`] };
    case 'unc':
      return { text: `${bs}${bs}srv${bs}share${bs}${s}a${bs}${f}`, secrets: [`${s}a`] };
    case 'unc-fwd':
      return { text: `//srv/share/${s}a/${f}`, secrets: [`${s}a`] };
    case 'posix':
      return { text: `/home/${s}a/docs/${f}`, secrets: [`${s}a`] };
    case 'posix-deep':
      return { text: `/var/lib/${s}a/x/y/z/${f}`, secrets: [`${s}a`] };
    case 'home':
      return { text: `~/${s}a/${f}`, secrets: [`${s}a`] };
    case 'win-pct':
      return { text: `C:%5CUsers%5C${s}a%5C${f}`, secrets: [`${s}a`] };
    case 'win-dir-only':
      return { text: `C:${bs}Users${bs}${s}a`, secrets: [`${s}a`] };
    case 'posix-dir-only':
      return { text: `/home/${s}a`, secrets: [`${s}a`] };
    default:
      throw new Error('unknown path form ' + form);
  }
}
export const PATH_FORMS = ['win-back', 'win-fwd', 'win-json', 'unc', 'unc-fwd', 'posix', 'posix-deep', 'home', 'win-pct', 'win-dir-only', 'posix-dir-only'];

/** An item (url or path) with a secret; kind 'url' | 'path'. */
function secretItem(r, s, kind) {
  return kind === 'url' ? urlWithSecret(r, s, r.pick(URL_SLOTS)) : pathWithSecret(r, s, r.pick(PATH_FORMS));
}
function neutralItem(r, kind) {
  if (kind === 'url') return { text: cleanUrl(r), secrets: [] };
  return { text: r.pick([`C:${bs}docs${bs}note.txt`, '/etc/hosts.conf', `${bs}${bs}srv${bs}share${bs}x.doc`]), secrets: [] };
}

// The text around the glued items: JSON / JS array and object text, call arguments, an error message, a plain join.
const FORMS = [
  (items, d) => items.join(d),
  (items, d) => `[${items.map((x) => `"${x}"`).join(',')}]`,
  (items, d) => `[${items.map((x) => `'${x}'`).join(',')}]`,
  (items, d) => `[${items.map((x) => `"${x}"`).join(d)}]`,
  (items, d) => `{${items.map((x, i) => `"k${i}":"${x}"`).join(',')}}`,
  (items, d) => `{${items.map((x, i) => `k${i}:'${x}'`).join(',')}}`,
  (items, d) => `JSON.stringify({${items.map((x, i) => `${'abc'[i]}:'${x}'`).join(',')}})`,
  (items, d) => `fetch(${items.map((x) => `"${x}"`).join(',')})`,
  (items, d) => `Error: ${items.join(d)}`,
  (items, d) => `throw new Error(JSON.stringify({${items.map((x, i) => `${'abc'[i]}:'${x}'`).join(',')}}))`,
  (items, d) => `(${items.join(d)})`,
  (items, d) => `<a href="${items[0]}">${items.slice(1).join(d)}</a>`,
  (items, d) => `${items.join(d)} done`,
  (items, d) => `see: ${items.join(d)}`,
  (items, d) => `\\"${items.join(`\\",\\"`)}\\"`,
  (items, d) => `{"urls":[${items.map((x) => JSON.stringify(x)).join(',')}]}`,
];

/**
 * `n` seeded cases { id, text, secrets, shape }. 2 or 3 items; the secret sits in one random item or in every item; the items are glued
 * by a random delimiter from DELIMS (a different one for every gap in the plain forms) inside a random FORM.
 */
export function generate(seed = GLUE_SEED, n = 6000) {
  const r = makeRng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const count = r.bool(0.4) ? 3 : 2;
    const secretAt = r.bool(0.3) ? -1 : r.int(count); // -1: every item carries a secret
    const items = [];
    const secrets = [];
    for (let k = 0; k < count; k++) {
      const kind = r.bool(0.55) ? 'url' : 'path';
      const it = secretAt === -1 || secretAt === k ? secretItem(r, `CGLU${i}x${k}`, kind) : neutralItem(r, kind);
      items.push(it.text);
      secrets.push(...it.secrets);
    }
    const form = r.int(FORMS.length);
    // gaps: one delimiter per gap for the plain join forms
    const d = r.pick(DELIMS);
    let text;
    if (form === 0 && r.bool(0.6)) {
      text = items[0];
      for (let k = 1; k < items.length; k++) text += r.pick(DELIMS) + items[k];
    } else {
      text = FORMS[form](items, d);
    }
    // a delimiter before the first and after the last item too
    if (r.bool(0.3)) text = r.pick(DELIMS) + text + r.pick(DELIMS);
    if (r.bool(0.15)) text = `Failed to load ${text} after 3 tries`;
    out.push({ id: `g${i}`, text, secrets, shape: `form${form}/n${count}/at${secretAt}` });
  }
  return out;
}

/**
 * The EXHAUSTIVE two-item matrix: every delimiter x every URL slot x {secret first, secret last} against a clean URL and against a local
 * path, plus every path form x every delimiter against a clean URL. Deterministic (the seed only picks scheme / host / path).
 */
export function matrix(seed = GLUE_SEED + 1) {
  const r = makeRng(seed);
  const out = [];
  let i = 0;
  for (const d of DELIMS) {
    for (const slot of URL_SLOTS) {
      for (const other of ['url', 'path']) {
        for (const first of [true, false]) {
          const s = `CGLM${i++}x`;
          const a = urlWithSecret(r, s, slot);
          const b = neutralItem(r, other);
          out.push({ id: `m${i}`, text: first ? a.text + d + b.text : b.text + d + a.text, secrets: a.secrets, shape: `${JSON.stringify(d)}/${slot}/${other}/${first ? 'first' : 'last'}` });
        }
      }
    }
    for (const form of PATH_FORMS) {
      for (const first of [true, false]) {
        const s = `CGLM${i++}x`;
        const a = pathWithSecret(r, s, form);
        const b = neutralItem(r, 'url');
        out.push({ id: `m${i}`, text: first ? a.text + d + b.text : b.text + d + a.text, secrets: a.secrets, shape: `${JSON.stringify(d)}/${form}/url/${first ? 'first' : 'last'}` });
      }
    }
  }
  return out;
}

/** Shapes the rule must keep (proof the property test is not passed by an eraser). */
export const KEEP_CASES = [
  { text: `["https://h.test/a","C:${bs}Users${bs}Ada${bs}doc.txt"]`, keep: ['https://h.test/a', 'doc.txt'] },
  { text: 'fetch("https://h.test/a","https://h2.test/p")', keep: ['https://h.test/a', 'https://h2.test/p', 'fetch('] },
  { text: 'see http://127.0.0.1:5123/p/q done', keep: ['http://127.0.0.1:5123/p/q', 'see', 'done'] },
];
