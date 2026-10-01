// AUDIT-3 independent privacy attack generator (own seed 0xA3A3F11, own shapes; not the builder's or audit-2's).
// Every secret K is placed after / inside a construct; each construct is tagged CLAIM (the character rule says it is
// removed) or LIMIT (no rule character guards it: the rule does not claim it). Runs through every stored-string path of
// the BUILT dist: text, entry.{selector,target,url,error,verification.*}, navigate/eval/upload/wait_for targets,
// CLI redactCliArgs for every verb/position, buildHistoryLine error / actionsUnavailable / cwd, formatHistoryHuman.
// Usage: node attack3.mjs <root> [out.json]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = process.argv[2];
const outFile = process.argv[3];
const B = await import(pathToFileURL(path.join(root, 'packages/browser/dist/index.js')).href);
const H = await import(pathToFileURL(path.join(root, 'packages/cli/dist/history-file.js')).href);
let seed = 0xa3a3f11;
const rnd = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
let n = 0;
const K = () => { const al = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = 'Wv'; for (let i = 0; i < 8; i++) s += al[Math.floor(rnd() * al.length)]; return s + (++n).toString(36) + 'Jq'; };
const C = (...c) => String.fromCharCode(...c);
const BS = C(92), Q = C(34), BT = C(96), ELL = C(0x2026);
const enc = {
  '?': ['?', '%3F', '%3f', '%253F', '%25253f', BS + 'u003f', BS + 'u003F', BS + 'x3f', C(0xff1f), C(0xfe56)],
  '#': ['#', '%23', '%2523', BS + 'u0023', BS + 'x23', C(0xff03), C(0xfe5f)],
  ';': [';', '%3B', '%3b', '%253B', BS + 'u003b', C(0xff1b), C(0xfe54), C(0x37e)],
  '=': ['=', '%3D', '%3d', '%253D', BS + 'u003d', C(0xff1d), C(0xfe66)],
  '&': ['&', '%26', '%2526', BS + 'u0026', C(0xff06), C(0xfe60)],
  '@': ['@', '%40', '%2540', C(0xff20), C(0xfe6b)],
};
const WS = [' ', C(9), C(10), C(13), C(0xa0), C(0x2007), C(0x200b), C(0x2028), C(0x3000), C(0xfeff), C(0x205f), C(0x180e), C(0x1680), C(0x85)];
const PRE = ['', 'https://h.test/p', 'HTTP://H.TEST:8443/a/b', 'com.example.app:/cb', 'about:blank', 'intranet:8080/p', 'h.test/p', 'localhost:3000', '[::1]:9/p', 'x', 'ws://h/s', 'mailto:a', 'chrome://settings/x', 'view-source:https://h/p', 'blob:https://h/u', 'urn:x:y', 'data:text/html,a', 'javascript:void', 'tel:+1', 'file:///C:/d', 'C:' + BS + 'd' + BS + 'f.txt', '/srv/a', 'sftp://h/x'];
const WRAP = [
  (s) => s,
  (s) => 'Current URL ' + s + ' does not contain "/done"',
  (s) => 'net::ERR_ABORTED at ' + s,
  (s) => 'Navigation committed at ' + s + ', expected ' + Q + 'x' + Q,
  (s) => '(' + s + ')', (s) => "'" + s + "'", (s) => Q + s + Q, (s) => '[' + s + ']', (s) => '{"url":"' + s + '"}', (s) => '<' + s + '>', (s) => BT + s + BT,
  (s) => 'fetch(' + Q + s + Q + ').then(r=>r)',
  (s) => s + '.', (s) => s + ',next',
  (s) => 'z'.repeat(150) + ' ' + s,
  (s) => 'y '.repeat(3990) + s,
];
const cells = [];
const add = (cls, family, build) => { for (let i = 0; i < 6; i++) { const k = K(); cells.push({ cls, family, k, s: build(k) }); } };
const J = JSON.stringify;
for (const d of ['?', '#', ';']) for (const e of enc[d]) add('CLAIM', 'cut ' + J(e), (k) => pick(WRAP)(pick(PRE) + e + pick(['', 'a', 'x=']) + k));
for (const w of WS) add('CLAIM', 'cut-then-ws ' + w.charCodeAt(0).toString(16), (k) => pick(WRAP)(pick(PRE) + pick(['?', '#q', ';']) + w + k + ' tail'));
for (const w of WS) add('CLAIM', 'ws-then-cut ' + w.charCodeAt(0).toString(16), (k) => pick(WRAP)(pick(PRE) + w + pick(['?', ';', '#!']) + k));
for (const d of ['=', '&']) for (const e of enc[d]) {
  add('CLAIM', 'kv-right ' + J(e), (k) => pick(WRAP)(pick(['', 'token', 'sid', 'https://h/p/a', 'pw']) + e + k));
  add('CLAIM', 'kv-left ' + J(e), (k) => pick(WRAP)(k + e + pick(['1', '', 'x'])));
}
for (const e of enc['@']) {
  add('CLAIM', 'userinfo ' + J(e), (k) => pick(WRAP)(pick(['https://', 'ftp://', '//', 'ws://', 'git+ssh://', '']) + pick(['', 'u:', 'u%3A']) + k + e + 'h.test' + pick(['', '/p', ':22/r'])));
  add('CLAIM', 'userinfo-multi-at ' + J(e), (k) => pick(WRAP)('https://a@' + k + e + 'h.test/p'));
}
add('CLAIM', 'cookie sid=K; path=/', (k) => pick(WRAP)('Set-Cookie: sid=' + k + '; Path=/; HttpOnly'));
add('CLAIM', 'cookie a=1; sid=K', (k) => pick(WRAP)('Cookie: a=1; sid=' + k));
add('CLAIM', 'json k=v', (k) => pick(WRAP)('{"q":"a=' + k + '"}'));
add('CLAIM', 'jwt with padding', (k) => pick(WRAP)('Bearer eyJhbGciOiJIUzI1NiJ9.' + k + '=='));
add('CLAIM', 'form body', (k) => pick(WRAP)('grant_type=password&password=' + k));
add('CLAIM', 'matrix param', (k) => pick(WRAP)('https://h.test/p;jsessionid=' + k + '/x'));
add('CLAIM', 'html entity &#63;', (k) => pick(WRAP)('https://h.test/p&#63;t' + k));
add('CLAIM', 'percent-encoded whole url', (k) => pick(WRAP)('https%3A%2F%2Fh.test%2Fp%3Ft%3D' + k));
add('CLAIM', 'redirect param', (k) => pick(WRAP)('https://h/login?next=https%3A%2F%2Fi%2Fcb%23code%3D' + k));
for (const sep of ['/', BS, '%2F', '%5C', C(0xff0f)]) add('CLAIM', 'path-mid ' + J(sep), (k) => pick(WRAP)(pick(['', 'C:', '~', '.', '..', sep, sep + sep + 'srv']) + sep + k + sep + pick(['f.txt', 'x', 'report.pdf', 'a.b'])));
add('CLAIM', 'path-mid file:', (k) => pick(WRAP)('file:///home/' + k + '/f.txt'));
add('CLAIM', 'path-mid unc', (k) => pick(WRAP)(BS + BS + 'srv' + BS + k + BS + 'share' + BS + 'f.doc'));
add('CLAIM', 'path-last no-ext win', (k) => pick(WRAP)('C:' + BS + 'Users' + BS + k));
add('CLAIM', 'path-last no-ext posix', (k) => pick(WRAP)('/home/' + k));
add('LIMIT', 'bare token in prose', (k) => pick(WRAP)('session ' + k + ' expired'));
add('LIMIT', 'bearer header', (k) => pick(WRAP)('Authorization: Bearer ' + k));
add('LIMIT', 'basic header', (k) => pick(WRAP)('Authorization: Basic ' + k));
add('LIMIT', 'jwt no padding', (k) => pick(WRAP)('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.' + k));
add('LIMIT', 'json password', (k) => pick(WRAP)('{"password":"' + k + '"}'));
add('LIMIT', 'colon kv', (k) => pick(WRAP)('token:' + k));
add('LIMIT', 'url path segment', (k) => pick(WRAP)('https://h.test/reset/' + k + '/confirm'));
add('LIMIT', 'url path last', (k) => pick(WRAP)('https://h.test/reset/' + k));
add('LIMIT', 'url path no sep', (k) => pick(WRAP)('https://h.test/reset' + k));
add('LIMIT', 'hostname', (k) => pick(WRAP)('https://' + k + '.h.test/p'));
add('LIMIT', 'hostname schemeless', (k) => pick(WRAP)(k + '.h.test'));
add('LIMIT', 'path last with ext', (k) => pick(WRAP)('/tmp/x/' + k + '.txt'));
add('LIMIT', 'leading slash segment', (k) => pick(WRAP)('/' + k));
const cliVerbs = [['nav', 0], ['newtab', 0], ['audit', 0], ['compare', 0], ['compare', 1], ['compare', 2], ['download', 0], ['clicktext', 0], ['clickrole', 1], ['waitfor', 1], ['click', 0], ['hover', 0], ['type', 0], ['press', 0], ['press', 1], ['drag', 1], ['upload', 0], ['upload', 1], ['screenshot', 0], ['scroll', 0], ['focustab', 0], ['eval', 0], ['dialog', 0], ['select', 0], ['grant', 0], ['closetab', 0]];
const leak = (o, k) => J(o ?? '').includes(k);
const rows = [];
const base = { success: false, executionTimeMs: 1, timestamp: 't' };
for (const { cls, family, k, s } of cells) {
  const where = [];
  const chk = (name, v) => { if (leak(v, k)) where.push(name); };
  chk('text', B.redactHistoryText(s));
  chk('sel', B.redactHistorySelector(s));
  const v = { verified: false, urlChanged: false, elementFound: false, confidence: 0, reason: s, evidence: { tier: 'contradicted', checks: [{ check: 'expect.url', outcome: 'fail', expected: s, observed: s, detail: s }] } };
  const e = B.sanitizeHistoryEntry({ ...base, actionType: 'click', selector: s, target: s, url: s, error: s, verification: v });
  for (const f of ['selector', 'target', 'url', 'error']) chk('e.' + f, e[f]);
  const c0 = e.verification.evidence.checks[0];
  chk('e.reason', e.verification.reason); chk('e.expected', c0.expected); chk('e.observed', c0.observed); chk('e.detail', c0.detail);
  const nv = B.sanitizeHistoryEntry({ ...base, actionType: 'navigate', target: s, url: s });
  chk('nav.target', nv.target); chk('nav.url', nv.url);
  chk('eval.target', B.sanitizeHistoryEntry({ ...base, actionType: 'eval', target: s }).target);
  chk('upload.target', B.sanitizeHistoryEntry({ ...base, actionType: 'upload_file', target: s }).target);
  chk('waitfor.selector', B.sanitizeHistoryEntry({ ...base, actionType: 'wait_for', selector: 'text="' + s + '" AND url~"' + s + '"' }).selector);
  for (const [verb, idx] of cliVerbs) { const args = ['a1', 'a2', 'a3']; args[idx] = s; chk('cli.' + verb + '[' + idx + ']', H.redactCliArgs(verb, args)); }
  const line = H.buildHistoryLine({ ts: 't', sessionId: 's', cwd: 'C:/w', home: 'C:/Users/me', verb: 'click', args: [], exitCode: 1, durationMs: 1, error: s, actionsUnavailable: s, actions: [{ ...base, actionType: 'click', selector: s, target: s, url: s, error: s, tabId: 't1', seq: 1, verification: v }] });
  chk('line.error', line.error); chk('line.unavail', line.actionsUnavailable); chk('line.actions', line.actions);
  const raw = { v: 1, type: 'command', ts: '2026-10-01T00:00:00Z', sessionId: 's', cwd: '~', verb: 'nav', args: [s, s], exitCode: 1, durationMs: 1, error: s, actionsUnavailable: s, actions: [{ actionType: 'click', selector: s, target: s, error: s, success: false, tabId: 't', seq: 1 }] };
  chk('human', H.formatHistoryHuman({ lines: [{ raw: J(raw), parsed: raw }], skipped: 0, rotatedExists: false }, { file: 'f' }));
  // cwd: judged separately (cwd-probe), the rule keeps ~/<every dir under home> by design
  rows.push({ cls, family, k, s: s.length > 240 ? s.slice(0, 80) + ELL + s.slice(-120) : s, where });
}
const fam = {};
for (const r of rows) { const f = (fam[r.cls + ' | ' + r.family] ??= { cls: r.cls, family: r.family, cells: 0, leakCells: 0, where: new Set(), ex: null }); f.cells++; if (r.where.length) { f.leakCells++; r.where.forEach((w) => f.where.add(w)); f.ex ??= r; } }
const summary = Object.values(fam).map((f) => ({ cls: f.cls, family: f.family, cells: f.cells, leakCells: f.leakCells, where: [...f.where], example: f.ex && { s: f.ex.s, where: f.ex.where } }));
const claim = rows.filter((r) => r.cls === 'CLAIM'), lim = rows.filter((r) => r.cls === 'LIMIT');
console.log('cells=' + rows.length + ' CLAIM=' + claim.length + ' claimLeaks=' + claim.filter((r) => r.where.length).length + ' LIMIT=' + lim.length + ' limitLeaks=' + lim.filter((r) => r.where.length).length);
for (const f of summary) if (f.leakCells) console.log(f.cls + ' ' + f.family.padEnd(34) + ' ' + f.leakCells + '/' + f.cells + ' ' + f.where.join(',') + '\n    ex: ' + J(f.example.s).slice(0, 220) + ' -> ' + f.example.where.join(','));
if (outFile) writeFileSync(outFile, J({ root, seed: '0xa3a3f11', total: rows.length, summary }, null, 1));
