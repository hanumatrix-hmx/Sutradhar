// FR2-11 fix-2: SEEDED property generator for the character rule (shared by the unit specs and the live verify script).
//
// Why: fix-0 and fix-1 were tested with hand-picked and hand-enumerated shapes, and each audit found the next shape that was not on the
// list. The character rule is shape-independent, so its test is too: build thousands of strings of the form
//     prefix + DELIMITER + SECRET + suffix
// from random parts (scheme, slash form, host, path, delimiter, encoding, wrapper, surrounding prose) and require that SECRET is
// absent from every stored form. The generator never consults the redactor, so it cannot share its blind spots.
//
// Every case has its OWN secret (CNRYp<i>X) so one leak points at exactly one generated string. The PRNG is mulberry32, so a seed
// reproduces the exact same strings on any machine.
export const DEFAULT_SEED = 20261001;

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

const U = {
  nbsp: '\u00a0',
  zwsp: '\u200b',
  zwnj: '\u200c',
  ideo: '\u3000',
  tab: '\t',
  nl: '\n',
};

const SCHEMES = ['http', 'https', 'ftp', 'ws', 'wss', 'about', 'chrome', 'chrome-extension', 'com.example.app', 'myapp', 'x-y.z+w', 'intranet', 'HTTPS', 'hTtP', 'custom', 'mailto', 'tel', 'urn', 'app', 'a1'];
// the slash form after the scheme: a real `//`, a single `/`, none, a backslash form, a JSON-escaped form
const SLASH_FORMS = ['://', ':/', ':', ':\\\\', ':\\/\\/', ':///'];
const HOSTS = [
  'a.test', 'localhost', 'intranet', 'host', '127.0.0.1', '127.0.0.1:5123', 'intranet:8080', '[::1]', '[::1]:9', '[2001:db8::1]:8080', 'example.com:443',
  'b\u00fccher.example', '\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444', 'xn--bcher-kva.example', 'EXAMPLE.ORG', 'a-b.c-d.e', '1.2.3.4', 'x',
];
const PATHS = ['', '/', '/p', '/a/b', '/cb', '/my dir', '/a b/c d', '/p.html', '/x;y', '/deep/er/path/', '/%20sp', '/a\tb', '/a' + U.nbsp + 'b', '/a' + U.ideo + 'b'];
// [delimiter, how the secret follows it]. Literal delimiters and every encoding the rule has to see through.
const DELIMS = [
  '?', '#', ';', '?x=', '?x=1&t=', '#a=', '#/route?t=', '?=', '#access_token=', ';jsessionid=', '?q=ab ', '?q=a b&t=', '?t=\u4e2d\u6587&k=',
  '%3F', '%3f', '%23', '%3B', '%3b', '%253F', '%2523', '%253B', '%25253F', '%3Fx%3D', '%23a%3D',
  '\\u003f', '\\u0023', '\\u003b', '\\u003F', '\\x3f',
  '\uff1f', '\uff03', '\uff1b',
  '?' + U.nbsp, '#' + U.tab, '?' + U.zwsp, ' ?', '\t#', U.nbsp + '#', U.zwsp + '?', U.nl + '#',
];
const WRAPS = [['', ''], ['(', ')'], ['[', ']'], ['{', '}'], ["'", "'"], ['"', '"'], ['<', '>'], ['`', '`'], ['\u201c', '\u201d'], ['\uff08', '\uff09'], ['\\"', '\\"'], ['<a href="', '">']];
const SURROUNDS = [
  ['', ''],
  ['Current URL ', ' does not contain "/done"'],
  ["Action failed: net::ERR_ABORTED at '", "', retrying"],
  ['Navigation to ', ' timed out after 30000ms'],
  ['redirect: ', ' then more words and numbers 1 2 3'],
  ['{"url":"', '","n":1}'],
  ['x '.repeat(40), ''],
  ['', ' x'.repeat(40)],
  ['', ''],
];

/** One random URL-ish prefix (no secret). */
function urlPrefix(r) {
  const scheme = r.bool(0.85) ? r.pick(SCHEMES) : '';
  const slashes = scheme ? r.pick(SLASH_FORMS) : r.pick(['', '//', '\\\\']);
  const host = r.bool(0.9) ? r.pick(HOSTS) : '';
  const path = r.pick(PATHS);
  return scheme + slashes + host + path;
}

function pathCase(r, secret) {
  const base = ['f.txt', 'file.pdf', 'a b.docx', 'x.y.z'];
  const name = r.pick(base);
  const forms = [
    () => `C:\\Users\\${secret}\\docs\\${name}`,
    () => `c:/Users/${secret}/docs/${name}`,
    () => `D:\\work\\${secret} dir\\sub\\${name}`,
    () => `\\\\srv\\share\\${secret}\\${name}`,
    () => `//srv/share/${secret}/${name}`,
    () => `/home/${secret}/docs/${name}`,
    () => `/home/${secret} x/${name}`,
    () => `~/${secret}/${name}`,
    () => `~\\${secret}\\${name}`,
    () => `..\\${secret}\\${name}`,
    () => `./${secret}/${name}`,
    () => `$HOME/${secret}/${name}`,
    () => `%USERPROFILE%\\${secret}\\${name}`,
    () => `file:///C:/Users/${secret}/${name}`,
    () => `file:/home/${secret}/${name}`,
    () => `file:C:/Users/${secret}/${name}`,
    () => `path:/home/${secret}/${name}`,
    () => `ENOENT:C:\\Users\\${secret}\\${name}`,
    () => `\\\\\\\\srv\\\\share\\\\${secret}\\\\${name}`,
    () => `C:%5CUsers%5C${secret}%5C${name}`,
    () => `C:\\Users\\${secret}`,
    () => `/home/${secret}`,
    () => `/home/${secret}/https://a.test/p`,
  ];
  return r.pick(forms)();
}

function otherCase(r, secret) {
  const forms = [
    () => `#${secret}`,
    () => `?=${secret}`,
    () => `?${secret}`,
    () => `;${secret}`,
    () => `a=${secret}`,
    () => `a=1&b=${secret}`,
    () => `token=${secret}&a=1`,
    () => `a=1&token=my ${secret}`,
    () => `user:${secret}@host/`,
    () => `user:${secret}@host/p`,
    () => `user:${secret}@host`,
    () => `//u:${secret}@host/p`,
    () => `${secret}@host/p`,
    () => `https://u:x@${secret}@host.test/p`,
    () => `user:x@${secret}@host/`,
    () => `https://u@a@${secret}@host.test/p`,
    () => `u:${secret}@[::1]:9/p`,
    () => `%23${secret}`,
    () => `%3F${secret}`,
    () => `%253F${secret}`,
    () => `x%3Fy%3D${secret}`,
    () => `#${secret}=1`,
    () => `${U.nbsp}#${secret}`,
    () => `redirect=https://a.test/?t=${secret}`,
    () => `a=https://a.test/p#${secret}`,
    () => `data:,${secret}`,
    () => `data:text/plain;base64,${secret}`,
    () => `javascript:alert(${secret})`,
    () => `blob:http://a.test/${secret}`,
    () => `mailto:a@b.test?subject=${secret}`,
  ];
  return r.pick(forms)();
}

/**
 * `n` cases { id, text, secret, kind }. `kind`: 'delim' (prefix + delimiter + secret), 'path', 'other' (bare tokens).
 * The secret is always unique per case.
 */
export function generate(seed = DEFAULT_SEED, n = 6000) {
  const r = makeRng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const secret = `CNRYp${i}X`;
    const roll = r.next();
    let core;
    let kind;
    if (roll < 0.62) {
      kind = 'delim';
      const d = r.pick(DELIMS);
      core = urlPrefix(r) + d + secret + (r.bool(0.3) ? '&more=1' : r.bool(0.2) ? ' tail' : '');
    } else if (roll < 0.82) {
      kind = 'path';
      core = pathCase(r, secret);
    } else {
      kind = 'other';
      core = otherCase(r, secret);
    }
    const [wl, wr] = r.pick(WRAPS);
    const [sl, sr] = r.pick(SURROUNDS);
    out.push({ id: `p${i}`, kind, secret, text: sl + wl + core + wr + sr });
  }
  return out;
}

/** Shapes the rule must keep intact: proof the property test is not passed by an eraser. */
export const KEEP_CASES = [
  { text: 'Current URL http://127.0.0.1:5123/p/q does not contain "x"', keep: ['http://127.0.0.1:5123/p/q', 'Current URL'] },
  { text: 'see file C:\\Users\\Ada\\docs\\f.txt now', keep: ['f.txt'] },
  { text: 'No element found for selector', keep: ['No element found for selector'] },
];
