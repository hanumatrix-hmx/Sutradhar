// FR2-11 fix-3: the concrete GLUE shapes audit-3 found leaking (A3-F1) and the ones that each protect ONE new rule, for the LIVE runs on MCP,
// SDK, CLI and the bundle. Every shape has its own canaries (CGLV...), so a leak points at exactly one shape. `keep` is what must still be
// readable in the stored form (no over-redaction). Each text is used twice: as the message of a failing eval (stored `error`) and inside the
// eval CODE as a JSON string literal (stored preview), the two ways audit-3 reached the stored text.
const BS = String.fromCharCode(92);
const q = String.fromCharCode(34);

export function glueShapes(tag) {
  const out = [];
  const add = (id, build, keep = []) => {
    const c = (n) => `CGLV${id.replace(/[^A-Za-z0-9]/g, '')}${tag}${n}`;
    const canaries = [c('a'), c('b')];
    out.push({ id, canaries, text: build(c('a'), c('b')), keep });
  };
  // audit-3 A3-F1 exact shapes
  add('js-array-userinfo', (a) => `['https://h.test/a','https://u:${a}@h2.test/p'].length`, ['https://h.test/a', 'h2.test/p']);
  add('json-config-db', (a) => `{api:'https://h.test/x',db:'postgres://admin:${a}@db:5432/app'}`, ['https://h.test/x', 'db:5432/app']);
  add('url-then-windows-path', (a) => `['https://h.test/a','C:/Users/${a}/doc.txt']`, ['https://h.test/a', 'doc.txt']);
  add('url-then-posix-path', (a) => `['https://h.test/a','/home/${a}/doc.txt']`, ['doc.txt']);
  add('comma-list', (a) => `https://h.test/p,/home/${a}/f.txt`, ['https://h.test/p', 'f.txt']);
  add('pipe-unc', (a) => `see: https://h.test/a|//srv/share/${a}/f.doc`, ['https://h.test/a', 'f.doc']);
  add('bidi-202a', (a) => `https://h.test/p${String.fromCharCode(0x202a)}/home/${a}/f.txt`, ['https://h.test/p', 'f.txt']);
  add('bidi-202e-windows', (a) => `https://h.test/p${String.fromCharCode(0x202e)}C:${BS}Users${BS}${a}${BS}f.txt`, ['f.txt']);
  add('three-urls', (a, b) => `['https://h.test/a','https://x@h2.test/b','https://u:${a}@h3.test/c?k=${b}']`, ['https://h.test/a', 'h2.test/b']);
  // the isolated rule cells
  add('password-with-parens', (a, b) => `postgres://admin:${a}(${b})@db:5432/app`, ['db:5432/app']);
  add('json-escaped-quote-in-userinfo', (a, b) => JSON.stringify({ db: `postgres://admin:${a}${q}${b}@db:5432/app` }), ['db:5432/app']);
  add('backslash-glue', (a) => `https://h.test/aC:${BS}Users${BS}${a}${BS}doc.txt`, ['https://h.test/a', 'doc.txt']);
  add('data-after-query', (a) => `https://h.test/p?token=${a},data:text/plain,x`, ['https://h.test/p']);
  add('file-after-path', (a, b) => `/home/${a}/f.txt${BS}file:///C:/Users/${b}/doc.txt`, ['f.txt']);
  // must stay readable (the IPv6 host group is the one bracket that does not split)
  add('ipv6-origin-kept', (a) => `http://[::1]:5000/p?token=${a}`, ['http://[::1]:5000/p']);
  return out;
}
