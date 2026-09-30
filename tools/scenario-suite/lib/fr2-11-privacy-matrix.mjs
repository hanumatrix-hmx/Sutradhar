// FR2-11 fix-1: the GENERATED privacy matrix, shared by the unit specs (vitest) and the live verify script.
//
// Why generated: audit-1 found that hand-picked canaries (`?n=1&token=SECRET`) passed while `?q=(a)&token=X` leaked, and
// FR2-07 showed the same lesson (one example per bug, then enumerating shapes, both failed). So every SECRET POSITION is
// crossed with every SURROUND, and each cell carries its own unique canary.
//
// A case is { id, text, canaries[], keep[] }:
//   text      the string handed to a redactor / injected into a real action's message,
//   canaries  unique tokens (CNRY...) that must appear NOWHERE in any stored form,
//   keep      substrings that must STILL be visible (the display origin + pathname, a file's basename): proof the redaction
//             is not simply deleting everything.
export const CANARY_RE = /CNRY[A-Za-z0-9]*/g;
export const findCanaries = (text) => [...new Set(String(text).match(CANARY_RE) ?? [])];

/** Characters around a URL / path: brackets, quotes, separators, unicode, sentence punctuation, error-message frames. */
export const SURROUNDS = [
  ['', ''],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ["'", "'"],
  ['"', '"'],
  ['<', '>'],
  ['', ','],
  ['', ';'],
  ['', '|'],
  ['', '.'],
  ['(see ', ').'],
  ['', ' and then more words'],
  ['\u201c', '\u201d'],
  ['\uff08', '\uff09'],
  ['\u4e2d\u6587', '\u3002'],
  ['net::ERR_CONNECTION_REFUSED at ', ''],
  ['Navigation to "', '" failed: timeout'],
  ["expected '", "' to match but found nothing"],
  ['`', '`'],
];

let seq = 0;
const canary = (tag) => `CNRY${tag}${++seq}X`;

/**
 * URL-shaped cases. `origin` is e.g. `http://127.0.0.1:5000` (a real listening server for live runs); `hostPort` is
 * `127.0.0.1:5000`. Each entry builds its canary itself so two cases never share one.
 */
export function urlCases({ origin = 'http://127.0.0.1:5000', hostPort = '127.0.0.1:5000' } = {}) {
  const cases = [];
  const add = (id, build, { keep } = {}) => {
    const c = canary(id.replace(/[^A-Za-z0-9]/g, ''));
    const { text, keepIn } = build(c);
    cases.push({ id, text, canaries: [c], keep: keep ?? keepIn ?? [] });
  };
  const P = `${origin}/p`;
  // query value, every awkward character the audit found (and the ones next to them)
  add('query-plain', (c) => ({ text: `${P}?n=1&token=${c}`, keepIn: [P] }));
  add('query-paren', (c) => ({ text: `${P}?q=(a)&token=${c}`, keepIn: [P] }));
  add('query-bracket', (c) => ({ text: `${P}?ids[]=1&token=${c}`, keepIn: [P] }));
  add('query-brace', (c) => ({ text: `${P}?q={x}&token=${c}`, keepIn: [P] }));
  add('query-apostrophe', (c) => ({ text: `${P}?q=it's&token=${c}`, keepIn: [P] }));
  add('query-dquote', (c) => ({ text: `${P}?q="x"&token=${c}`, keepIn: [P] }));
  add('query-angle', (c) => ({ text: `${P}?q=<a>&token=${c}`, keepIn: [P] }));
  add('query-delims', (c) => ({ text: `${P}?a=1,2;3|4&token=${c}`, keepIn: [P] }));
  add('query-pct-brackets', (c) => ({ text: `${P}?ids%5B%5D=1&q=%28a%29&token=${c}`, keepIn: [P] }));
  add('query-first-char', (c) => ({ text: `${P}?${c}`, keepIn: [P] }));
  add('query-empty-key', (c) => ({ text: `${P}?=${c}`, keepIn: [P] }));
  add('query-no-path', (c) => ({ text: `${origin}?token=${c}`, keepIn: [origin] }));
  add('query-space', (c) => ({ text: `${P}?q=a b&token=${c}`, keepIn: [P] }));
  add('query-nested-url', (c) => ({ text: `${P}?next=http://other.test/x?t=${c}`, keepIn: [P] }));
  add('query-unicode', (c) => ({ text: `${P}?q=\u4e2d\u6587&token=${c}`, keepIn: [P] }));
  // query strings WITHOUT a scheme or a dotted host: a relative URL, a single-label intranet host, a bare query, a form body,
  // and a fully percent-encoded URL (none of them carries a `scheme://`, so a marker-only rule would miss them)
  add('query-bare', (c) => ({ text: `?token=${c}`, keepIn: [] }));
  add('query-relative-root', (c) => ({ text: `/p?token=${c}`, keepIn: ['/p'] }));
  add('query-relative-intranet', (c) => ({ text: `intranet/app?token=${c}`, keepIn: ['intranet/app'] }));
  add('query-relative-php', (c) => ({ text: `app/index.php?id=1&token=${c}`, keepIn: ['app/index.php'] }));
  add('query-relative-brackets', (c) => ({ text: `app/x?ids[]=1&q=(a)&token=${c}`, keepIn: ['app/x'] }));
  add('form-encoded', (c) => ({ text: `a=1&token=${c}`, keepIn: [] }));
  add('form-encoded-first', (c) => ({ text: `token=${c}&a=1&b=(x)`, keepIn: [] }));
  add('encoded-url', (c) => ({ text: `http%3A%2F%2F127.0.0.1%3A5000%2Fp%3Ftoken%3D${c}`, keepIn: [] }));
  add('encoded-url-lower', (c) => ({ text: `https%3a%2f%2fexample.com%2fp%3fx%3d${c}`, keepIn: [] }));
  // fragment
  add('fragment-plain', (c) => ({ text: `${P}#${c}`, keepIn: [P] }));
  add('fragment-route', (c) => ({ text: `${P}#/route?token=${c}`, keepIn: [P] }));
  add('fragment-brackets', (c) => ({ text: `${P}#a(b)[c]=${c}`, keepIn: [P] }));
  add('query-and-fragment', (c) => ({ text: `${P}?a=1#frag-${c}`, keepIn: [P] }));
  // userinfo
  add('userinfo-pass', (c) => ({ text: `http://user:${c}@${hostPort}/p`, keepIn: [`${hostPort}/p`] }));
  add('userinfo-user-only', (c) => ({ text: `http://${c}@${hostPort}/p`, keepIn: [`${hostPort}/p`] }));
  add('userinfo-no-path', (c) => ({ text: `http://user:${c}@${hostPort}`, keepIn: [hostPort] }));
  add('userinfo-and-query', (c) => ({ text: `http://user:${c}@${hostPort}/p?x=1`, keepIn: [`${hostPort}/p`] }));
  add('userinfo-scheme-less', (c) => ({ text: `user:${c}@${hostPort}/p`, keepIn: [`${hostPort}/p`] }));
  add('userinfo-scheme-less-no-path', (c) => ({ text: `user:${c}@${hostPort}`, keepIn: [hostPort] }));
  add('userinfo-at-in-password', (c) => ({ text: `http://us:${c}@x@${hostPort}/p`, keepIn: [`${hostPort}/p`] }));
  // path parameters (segment after a ';')
  add('path-param', (c) => ({ text: `${P};jsessionid=${c}`, keepIn: [P] }));
  add('path-param-mid', (c) => ({ text: `${P};${c}/q`, keepIn: [P] }));
  add('path-param-then-query', (c) => ({ text: `${P};a=${c}/q?x=1`, keepIn: [P] }));
  // scheme-less and protocol-relative hosts
  add('schemeless-ip-query', (c) => ({ text: `${hostPort}/p?token=${c}`, keepIn: [`${hostPort}/p`] }));
  add('schemeless-ip-fragment', (c) => ({ text: `${hostPort}/p#${c}`, keepIn: [`${hostPort}/p`] }));
  add('schemeless-ip-paren', (c) => ({ text: `${hostPort}/p?q=(a)&token=${c}`, keepIn: [`${hostPort}/p`] }));
  add('schemeless-ip-pathparam', (c) => ({ text: `${hostPort}/p;s=${c}`, keepIn: [`${hostPort}/p`] }));
  add('schemeless-domain-query', (c) => ({ text: `example.com/p?x=${c}`, keepIn: ['example.com/p'] }));
  add('schemeless-domain-root-query', (c) => ({ text: `example.com/?token=${c}`, keepIn: ['example.com/'] }));
  add('schemeless-domain-port', (c) => ({ text: `example.com:8443/a/b?x=${c}`, keepIn: ['example.com:8443/a/b'] }));
  add('schemeless-localhost', (c) => ({ text: `localhost:3000/app?t=${c}`, keepIn: ['localhost:3000/app'] }));
  add('schemeless-domain-bracket', (c) => ({ text: `www.example.org/p?ids[]=1&t=${c}`, keepIn: ['www.example.org/p'] }));
  add('protocol-relative', (c) => ({ text: `//example.com/p?x=${c}`, keepIn: ['example.com/p'] }));
  add('protocol-relative-userinfo', (c) => ({ text: `//u:${c}@example.com/p`, keepIn: ['example.com/p'] }));
  // IPv6
  add('ipv6-query', (c) => ({ text: `http://[::1]:5000/p?token=${c}`, keepIn: ['http://[::1]:5000/p'] }));
  add('ipv6-schemeless', (c) => ({ text: `[::1]:5000/p?token=${c}`, keepIn: ['[::1]:5000/p'] }));
  add('ipv6-fragment-paren', (c) => ({ text: `http://[::1]:5000/p#(${c})`, keepIn: ['http://[::1]:5000/p'] }));
  // other schemes
  add('ws-query', (c) => ({ text: `ws://${hostPort}/sock?token=${c}`, keepIn: [`ws://${hostPort}/sock`] }));
  add('ftp-userinfo', (c) => ({ text: `ftp://user:${c}@files.example.com/pub`, keepIn: ['files.example.com/pub'] }));
  add('chrome-extension-query', (c) => ({ text: `chrome-extension://abcdef/page.html?token=${c}`, keepIn: ['abcdef/page.html'] }));
  // data: and blob:
  add('data-url', (c) => ({ text: `data:text/html,<b>${c}</b>`, keepIn: [] }));
  add('data-url-base64', (c) => ({ text: `data:text/plain;base64,${c}`, keepIn: [] }));
  add('blob-url', (c) => ({ text: `blob:${origin}/${c}`, keepIn: [`blob:${origin}`] }));
  add('blob-url-query', (c) => ({ text: `blob:${origin}/uuid?t=${c}`, keepIn: [`blob:${origin}`] }));
  // multiple URLs in one reason: a secret in EACH of them
  cases.push(
    (() => {
      const a = canary('multiA');
      const b = canary('multiB');
      const d = canary('multiC');
      return {
        id: 'multi-url-3',
        text: `${P}?t=${a} redirected to ${origin}/q?x=(1)&t=${b} and then https://example.com/r?t=${d}`,
        canaries: [a, b, d],
        keep: [P, `${origin}/q`, 'https://example.com/r'],
      };
    })(),
  );
  cases.push(
    (() => {
      const a = canary('multiD');
      const b = canary('multiE');
      return { id: 'multi-url-comma', text: `${P}?t=${a},${origin}/q?t=${b}`, canaries: [a, b], keep: [P] };
    })(),
  );
  return cases;
}

/**
 * Local-path cases. The canary sits in a DIRECTORY component; the file's basename must survive. A canary in the basename
 * itself is not a leak by design (the rule is "keep the basename"), so basenames here are the fixed string `file.txt`.
 */
export function pathCases() {
  const cases = [];
  const add = (id, build) => {
    const c = canary(id.replace(/[^A-Za-z0-9]/g, ''));
    cases.push({ id, text: build(c), canaries: [c], keep: ['file.txt'] });
  };
  add('win-backslash', (c) => `C:\\Users\\${c}\\secret\\file.txt`);
  add('win-forward', (c) => `C:/Users/${c}/secret/file.txt`);
  add('win-spaces', (c) => `C:\\Users\\${c} John Smith\\my dir\\file.txt`);
  add('win-lowercase-drive', (c) => `e:\\work\\${c}\\file.txt`);
  add('win-deep-dir-spaces', (c) => `D:\\a b\\${c} c d\\e f\\file.txt`);
  add('unc', (c) => `\\\\server\\${c}share\\dir\\file.txt`);
  add('unc-spaces', (c) => `\\\\server\\${c} share\\my dir\\file.txt`);
  add('posix', (c) => `/home/${c}/secret/file.txt`);
  add('posix-spaces', (c) => `/home/${c} user/my dir/file.txt`);
  add('posix-tmp', (c) => `/tmp/${c}/file.txt`);
  add('posix-home-tilde', (c) => `~/${c}/dir/file.txt`);
  add('posix-with-query', (c) => `/home/${c}/dir/file.txt?x=1`);
  add('win-with-query', (c) => `C:\\Users\\${c}\\dir\\file.txt?x=1`);
  add('file-url-win', (c) => `file:///C:/Users/${c}/dir/file.txt`);
  add('file-url-posix', (c) => `file:///home/${c}/dir/file.txt`);
  add('file-url-spaces', (c) => `file:///C:/Users/${c} John/my dir/file.txt`);
  add('file-url-encoded-spaces', (c) => `file:///C:/Users/${c}%20John/dir/file.txt`);
  add('file-url-query', (c) => `file:///C:/Users/${c}/dir/file.txt?x=1`);
  return cases;
}

/** `pre + text + post` around a case; the canaries and keeps are unchanged. */
export function surround(c, [pre, post]) {
  return { ...c, id: `${c.id}|${JSON.stringify(pre)}${JSON.stringify(post)}`, text: `${pre}${c.text}${post}` };
}

/** Every case crossed with every surround. `kind` is 'url' | 'path' | 'all'. */
export function fullMatrix(opts = {}) {
  const base = [...urlCases(opts), ...pathCases()];
  return base.flatMap((c) => SURROUNDS.map((s) => surround(c, s)));
}

/** A stratified subset for the slow live CLI runs: every case once, each with a rotating surround. */
export function rotatingMatrix(opts = {}) {
  const base = [...urlCases(opts), ...pathCases()];
  return base.map((c, i) => surround(c, SURROUNDS[i % SURROUNDS.length]));
}

/**
 * Evaluates one redactor over a list of cases. Returns the failures: a canary still present (leak) or a `keep` that was
 * removed (over-redaction). `redact` maps a string to the stored string.
 */
export function evaluate(cases, redact) {
  const failures = [];
  for (const c of cases) {
    let out;
    try {
      out = String(redact(c.text));
    } catch (e) {
      failures.push({ id: c.id, kind: 'threw', message: String(e) });
      continue;
    }
    const leaked = c.canaries.filter((k) => out.includes(k));
    if (leaked.length) failures.push({ id: c.id, kind: 'leak', leaked, text: c.text, out });
    const lost = c.keep.filter((k) => !out.includes(k));
    if (lost.length) failures.push({ id: c.id, kind: 'over-redacted', lost, text: c.text, out });
  }
  return failures;
}

/**
 * Self-test of the canary search itself, run by both the unit spec and the live script:
 *  - positive control: it sees a canary in every generated text (otherwise the matrix would be vacuous),
 *  - negative control: an identity "redactor" fails EVERY canary case, and an over-eager "redactor" that deletes
 *    everything fails every `keep` (so both directions are actually detectable),
 *  - a clean string has no canary.
 */
export function selfTest(opts = {}) {
  const cases = fullMatrix(opts);
  const problems = [];
  if (cases.length < 500) problems.push(`matrix too small: ${cases.length}`);
  const blind = cases.filter((c) => findCanaries(c.text).length !== c.canaries.length);
  if (blind.length) problems.push(`canary search blind to ${blind.length} generated texts (first: ${blind[0].id})`);
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) problems.push('duplicate case ids');
  const identity = evaluate(cases, (t) => t);
  if (identity.filter((f) => f.kind === 'leak').length !== cases.length) problems.push('identity redactor not caught on every case');
  const eraser = evaluate(cases, () => '');
  if (eraser.filter((f) => f.kind === 'over-redacted').length !== cases.filter((c) => c.keep.length).length) {
    problems.push('over-redaction (erase everything) not caught');
  }
  if (findCanaries('a clean string https://example.com/p?x=1').length !== 0) problems.push('false positive on a clean string');
  return { cases: cases.length, problems };
}
