// AUDIT-2 independent privacy attack generator (shapes NOT in the builder's matrix).
// (Written without literal backslashes: BS = char 92, control chars via fromCharCode.)
// Runs every shape through every stored-string path of the BUILT dist:
//   T  redactHistoryText (free text: reason, error, evidence, selector)
//   E  sanitizeHistoryEntry (error, selector, target(click), url, verification.reason + evidence expected/observed/detail)
//   N  sanitizeHistoryEntry target for actionType navigate (redactHistoryUrl)
//   C  CLI: redactCliArgs over verbs nav/newtab/download/clicktext/waitfor/click/upload/screenshot + buildHistoryLine error
// A cell LEAKs when the canary appears in the output. Usage: node attack-gen.mjs <root> [out.json]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = process.argv[2];
const out = process.argv[3];
const B = await import(pathToFileURL(path.join(root, 'packages/browser/dist/index.js')).href);
const H = await import(pathToFileURL(path.join(root, 'packages/cli/dist/history-file.js')).href);
let n = 0;
const K = () => `Kq${(++n).toString(36)}Zx`;
const C = (c) => String.fromCharCode(c);
const BS = C(92), TAB = C(9), NL = C(10), NBSP = C(0xa0), ZWSP = C(0x200b), Q = C(34);
const UE = 'b' + C(0xfc) + 'cher.example';
const CYR = [0x43f, 0x440, 0x438, 0x43c, 0x435, 0x440].map(C).join('') + '.' + C(0x440) + C(0x444);
const shapes = [
  ['idn-scheme-q', (k) => `https://${UE}/p?t=${k}`, 'url'],
  ['idn-scheme-frag', (k) => `https://${UE}/p#${k}`, 'url'],
  ['idn-noscheme-q=', (k) => `${UE}/p?t=${k}`, 'url'],
  ['idn-noscheme-frag', (k) => `${UE}/p#${k}`, 'url'],
  ['cyr-noscheme-frag', (k) => `${CYR}/p#${k}`, 'url'],
  ['cyr-noscheme-q-noeq', (k) => `${CYR}/p?${k}`, 'url'],
  ['cyr-scheme-frag', (k) => `http://${CYR}/p#${k}`, 'url'],
  ['puny-noscheme-frag', (k) => `xn--bcher-kva.example/p#${k}`, 'url'],
  ['upper-scheme-q', (k) => `HTTPS://X.TEST/P?T=${k}`, 'url'],
  ['upper-scheme-frag', (k) => `HTTP://x.test/p#${k}`, 'url'],
  ['mixed-scheme-q', (k) => `hTtPs://x.test/p?t=${k}`, 'url'],
  ['javascript-q', (k) => `javascript:location=1//?t=${k}`, 'url'],
  ['mailto-q=', (k) => `mailto:a@b.test?subject=${k}`, 'url'],
  ['mailto-q-noeq', (k) => `mailto:a@b.test?${k}`, 'url'],
  ['about-frag', (k) => `about:blank#${k}`, 'url'],
  ['about-q', (k) => `about:blank?${k}`, 'url'],
  ['chrome-q', (k) => `chrome://settings/?search=${k}`, 'url'],
  ['chrome-frag', (k) => `chrome://x/#${k}`, 'url'],
  ['ws-q', (k) => `ws://h.test:9/p?t=${k}`, 'url'],
  ['wss-frag', (k) => `wss://h.test/p#${k}`, 'url'],
  ['redirect=url', (k) => `redirect=https://x.test/?token=${k}`, 'url'],
  ['word-before-url', (k) => `xhttps://x.test/?t=${k}`, 'url'],
  ['eq-before-url-frag', (k) => `a=https://x.test/p#${k}`, 'url'],
  ['nested-url-in-query', (k) => `https://a.test/cb?next=https://b.test/?t=${k}`, 'url'],
  ['nested-encoded-in-query', (k) => `https://a.test/cb?next=https%3A%2F%2Fb.test%2F%3Ft%3D${k}`, 'url'],
  ['encoded-standalone', (k) => `https%3A%2F%2Fb.test%2F%3Ft%3D${k}`, 'url'],
  ['double-encoded-standalone', (k) => `https%253A%252F%252Fb.test%252F%253Ft%253D${k}`, 'url'],
  ['encoded-in-path', (k) => `https://a.test/r/https%3A%2F%2Fb.test%2F%3Ft%3D${k}`, 'url-path(by-rule)'],
  ['backslash-url-q=', (k) => `http:${BS}${BS}host.test${BS}p?t=${k}`, 'url'],
  ['backslash-url-frag', (k) => `http:${BS}${BS}host.test${BS}p#${k}`, 'url'],
  ['backslash-url-q-noeq', (k) => `http:${BS}${BS}host.test${BS}p?${k}`, 'url'],
  ['tab-sep-frag', (k) => `https://x.test/p${TAB}#${k}`, 'url'],
  ['nl-sep-q', (k) => `https://x.test/p?a=1${NL}${k}`, 'url'],
  ['nbsp-in-query', (k) => `https://x.test/p?a=1${NBSP}${k}`, 'url'],
  ['space-in-path-then-frag', (k) => `https://x.test/my dir#${k}`, 'url'],
  ['space-in-path-then-q-noeq', (k) => `https://x.test/my dir?${k}`, 'url'],
  ['space-in-query-then-url', (k) => `https://x.test/cb?q=ab ${k}&next=https://y.test/`, 'url'],
  ['space-in-query-then-host', (k) => `https://x.test/cb?q=ab ${k}.example.com/`, 'url'],
  ['json-escaped-quotes', (k) => `{${BS}${Q}u${BS}${Q}:${BS}${Q}https://x.test/p?t=${k}${BS}${Q}}`, 'url'],
  ['json-escaped-slashes', (k) => `https:${BS}/${BS}/x.test${BS}/p?t=${k}`, 'url'],
  ['json-escaped-slashes-frag', (k) => `https:${BS}/${BS}/x.test${BS}/p#${k}`, 'url'],
  ['json-double-escaped-frag', (k) => `https:${BS}${BS}/${BS}${BS}/x.test${BS}${BS}/p#${k}`, 'url'],
  ['single-label-port-frag', (k) => `intranet:8080/p#${k}`, 'url'],
  ['single-label-port-q-noeq', (k) => `intranet:8080/p?${k}`, 'url'],
  ['custom-scheme-frag-token', (k) => `com.example.app:/cb#access_token=${k}`, 'url'],
  ['custom-scheme-frag-2', (k) => `myapp://cb#access_token=${k}&x=1`, 'url'],
  ['ipv6-noscheme-frag', (k) => `[::1]:9/p#${k}`, 'url'],
  ['fullwidth-paren-wrap', (k) => `${C(0xff08)}https://x.test/p?t=${k}${C(0xff09)}`, 'url'],
  ['zwsp-before-q', (k) => `https://x.test/p${ZWSP}?t=${k}`, 'url'],
  ['url-semicolon-param', (k) => `https://x.test/p;jsessionid=${k}`, 'url'],
  ['userinfo-scheme', (k) => `https://u:${k}@x.test/`, 'url'],
  ['userinfo-noscheme', (k) => `u:${k}@x.test/p`, 'url'],
  ['userinfo-double-at', (k) => `https://u:${k}@@x.test/`, 'url'],
  ['form-body-space', (k) => `a=1&token=my ${k}`, 'url'],
  ['win-fwd', (k) => `C:/Users/${k}/docs/f.txt`, 'path'],
  ['win-back', (k) => `C:${BS}Users${BS}${k}${BS}docs${BS}f.txt`, 'path'],
  ['win-lower', (k) => `c:${BS}users${BS}${k}${BS}f.txt`, 'path'],
  ['rel-dotdot', (k) => `..${BS}${k}${BS}f.txt`, 'relpath'],
  ['rel-dot', (k) => `./${k}/f.txt`, 'relpath'],
  ['drive-relative', (k) => `C:${k}${BS}f.txt`, 'relpath'],
  ['long-path', (k) => `${BS}${BS}?${BS}C:${BS}Users${BS}${k}${BS}f.txt`, 'path'],
  ['device-path', (k) => `${BS}${BS}.${BS}C:${BS}Users${BS}${k}${BS}f.txt`, 'path'],
  ['env-userprofile', (k) => `%USERPROFILE%${BS}${k}${BS}f.txt`, 'relpath'],
  ['env-home-posix', (k) => `$HOME/${k}/f.txt`, 'relpath'],
  ['tilde-backslash', (k) => `~${BS}${k}${BS}f.txt`, 'path'],
  ['colon-before-posix', (k) => `path:/home/${k}/f.txt`, 'path'],
  ['file-single-slash', (k) => `file:/home/${k}/f.txt`, 'path'],
  ['file-drive-noslash', (k) => `file:C:/Users/${k}/f.txt`, 'path'],
  ['unc-forward', (k) => `//fileserver/share/${k}/f.txt`, 'path'],
  ['unc-json-escaped', (k) => `${BS}${BS}${BS}${BS}srv${BS}${BS}share${BS}${BS}${k}${BS}${BS}f.txt`, 'path'],
  ['win-in-quotes-spaces', (k) => `${Q}C:${BS}Users${BS}Ada ${k}${BS}Desktop${BS}f.txt${Q}`, 'path'],
  ['posix-in-parens', (k) => `(/home/${k}/f.txt)`, 'path'],
  ['home-dir-only', (k) => `C:${BS}Users${BS}${k}`, 'basename-dir'],
  ['posix-eq', (k) => `file=/home/${k}/f.txt`, 'path'],
  ['win-after-word-colon', (k) => `ENOENT:C:${BS}Users${BS}${k}${BS}f.txt`, 'path'],
];
const contexts = [
  (s) => s,
  (s) => `Current URL ${s} does not contain ${Q}/done${Q}`,
  (s) => `Action failed: net::ERR at '${s}', retrying`,
  (s) => 'x'.repeat(7990) + ' ' + s,
  (s) => `<${s}>`,
];
const rows = [];
const leak = (o, k) => JSON.stringify(o ?? '').includes(k);
for (const [name, mk, cls] of shapes) {
  contexts.forEach((ctx, ci) => {
    const k = K();
    const s = ctx(mk(k));
    const T = B.redactHistoryText(s);
    const e = B.sanitizeHistoryEntry({
      actionType: 'click', selector: s, target: s, url: s, error: s, success: false, executionTimeMs: 1, timestamp: 't',
      verification: { verified: false, urlChanged: false, elementFound: false, confidence: 0, reason: s,
        evidence: { tier: 'contradicted', checks: [{ check: 'expect.url', outcome: 'fail', expected: s, observed: s, detail: s }] } },
    });
    const N = B.sanitizeHistoryEntry({ actionType: 'navigate', target: s, success: true, executionTimeMs: 1, timestamp: 't' }).target;
    const cli = {};
    for (const [verb, args] of [['nav', [s]], ['newtab', [s]], ['download', [s, s]], ['clicktext', [s]], ['waitfor', ['url', s]], ['click', [s]], ['upload', ['3', s]], ['screenshot', [s]]]) cli[verb] = H.redactCliArgs(verb, args);
    cli.line = H.buildHistoryLine({ ts: 't', sessionId: 's', cwd: 'C:/w', verb: 'click', args: [], exitCode: 1, durationMs: 1, error: s });
    const where = [];
    if (leak(T, k)) where.push('text');
    for (const f of ['selector', 'target', 'url', 'error']) if (leak(e[f], k)) where.push('entry.' + f);
    if (leak(e.verification, k)) where.push('entry.verification');
    if (leak(N, k)) where.push('navigate.target');
    for (const v of Object.keys(cli)) if (leak(cli[v], k)) where.push('cli.' + v);
    rows.push({ shape: name, cls, ctx: ci, canary: k, leaks: where, sample: ci === 0 ? { in: s, text: T, url: e.url, nav: N, cliNav: cli.nav, cliDownload: cli.download, cliUpload: cli.upload } : undefined });
  });
}
const byShape = {};
for (const r of rows) {
  byShape[r.shape] ??= { cls: r.cls, leakCells: 0, cells: 0, where: new Set() };
  byShape[r.shape].cells++;
  if (r.leaks.length) { byShape[r.shape].leakCells++; r.leaks.forEach((w) => byShape[r.shape].where.add(w)); }
}
const summary = Object.entries(byShape).map(([s, v]) => ({ shape: s, cls: v.cls, cells: v.cells, leakCells: v.leakCells, where: [...v.where] }));
const total = rows.length, leaking = rows.filter((r) => r.leaks.length).length;
console.log(`cells=${total} leaking=${leaking}`);
for (const s of summary) if (s.leakCells) console.log(`LEAK ${s.cls.padEnd(18)} ${s.shape.padEnd(28)} ${s.leakCells}/${s.cells} ${s.where.join(',')}`);
if (out) writeFileSync(out, JSON.stringify({ root, total, leaking, summary, samples: rows.filter((r) => r.sample).map((r) => ({ shape: r.shape, leaks: r.leaks, ...r.sample })) }, null, 1));
