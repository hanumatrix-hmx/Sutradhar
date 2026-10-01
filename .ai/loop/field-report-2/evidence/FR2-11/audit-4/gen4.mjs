// AUDIT-4 independent privacy generator. Own seed (0x4D17A4F5), own structure: a recipe grammar
// (credential shape x placement x glue x escape layer x wrapper x surface). Not derived from the builder's or audit-1/2/3's generators.
// Every secret is TWO halves (A,B) separated by an attacker-chosen character; a leak = either half (case-insensitive) in output.
// Usage: node gen4.mjs <root> [out.json]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = process.argv[2];
const outFile = process.argv[3];
const B = await import(pathToFileURL(path.join(root, 'packages/browser/dist/index.js')).href);
const H = await import(pathToFileURL(path.join(root, 'packages/cli/dist/history-file.js')).href);
// xoshiro128** seeded by splitmix32 of 0x4D17A4F5
let s0, s1, s2, s3; { let x = 0x4d17a4f5; const sm = () => { x = (x + 0x9e3779b9) >>> 0; let z = x; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0; z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0; return (z ^ (z >>> 16)) >>> 0; }; s0 = sm(); s1 = sm(); s2 = sm(); s3 = sm(); }
const rotl = (v, k) => ((v * (2 ** k)) | (v >>> (32 - k))) >>> 0;
const rnd = () => { const r = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0; const t = (s1 * 512) >>> 0; s2 = (s2 ^ s0) >>> 0; s3 = (s3 ^ s1) >>> 0; s1 = (s1 ^ s2) >>> 0; s0 = (s0 ^ s3) >>> 0; s2 = (s2 ^ t) >>> 0; s3 = rotl(s3, 11); return r / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const C = (...c) => String.fromCodePoint(...c);
const BS = C(92);
const LT = '<';
let ctr = 0;
const half = (p) => { const al = 'bcdfghjkmnpqrstvwxz'; let s = p; for (let i = 0; i < 6; i++) s += al[Math.floor(rnd() * al.length)]; return s + (++ctr).toString(36); };
const AT = ['@', '%40', '%2540', C(0xff20), C(0xfe6b), BS + 'u0040', BS + 'x40'];
const PW_DELIM_CLAIM = ['?', '#', ';', "'", '"', '(', ')', '[', ']', '{', '}', '|', '^', ',', LT, '>', '`', '!', '*', '$', '~', '+', ':', '&', '=', '%3F', '%23', '%3B', '%26', '%3D', C(0x200b), C(0xad), C(0x202e), C(0xfeff), C(0x2060), C(0xe0041), BS + '"', '@'];
const PW_DELIM_373 = [' ', '/', '%2F', '%252F', BS + 'u002f', C(0xff0f), C(0x3000), C(0xa0)];
const SCHEMES = ['https://', 'http://', 'postgres://', 'mongodb+srv://', 'redis://', 'amqp://', 'ftp://', 'wss://', '//', 'git+ssh://', 'jdbc:mysql://', 'https:' + BS + '/' + BS + '/'];
const HOSTS = ['db.internal:5432', 'h.test', '127.0.0.1:9', '[::1]:6379', '[2001:db8::7]', 'x.y.z'];
const URLS = ['https://h.test/a', 'http://127.0.0.1:5000/p/q', 'wss://w.test/s', 'ftp://f.test/', 'https://[::1]:8443/v1'];
const CUTS = ['?', '#', ';', '%3F', '%253F', BS + 'u0023', C(0xff1f), C(0xfe54)];
const KEYS = ['pw', 'password', 'token', 'access_token', 'code', 'sig', 'apiKey', ''];
const EQS = ['=', '%3D', C(0xff1d), BS + 'u003d'];
const GLUE_CLAIM = ["'", '"', ',', '(', ')', '[', ']', '{', '}', LT, '>', '|', '^', '`', C(0x200b), C(0x202a), C(0xad), C(0x2063)];
const GLUE_URLLEGAL = ['/', '@', ':', '+', '!', '*', '$', '~', '&', '=', '%', '.'];
const WRAPS = [
  (s) => s,
  (s) => 'Current URL ' + s + ' does not contain "/done"',
  (s) => 'net::ERR_CONNECTION_REFUSED at ' + s,
  (s) => 'fetch(' + JSON.stringify(s) + ')',
  (s) => JSON.stringify({ cfg: s }),
  (s) => JSON.stringify(JSON.stringify([s])),
  (s) => '`' + s + '`',
  (s) => "console.log('" + s + "')",
];
const ESCAPES = {
  none: (s) => s,
  json: (s) => JSON.stringify(s).slice(1, -1),
  json2: (s) => JSON.stringify(JSON.stringify(s)).slice(1, -1),
  uri: (s) => encodeURIComponent(s),
  uri2: (s) => encodeURIComponent(encodeURIComponent(s)),
  uEsc: (s) => s.replace(/@/g, BS + 'u0040').replace(/\//g, BS + 'u002f'),
  slashEsc: (s) => s.replace(/\//g, BS + '/'),
};
const fam = {
  userinfo(cls) {
    const A = half('Ua'), Bh = half('Pb');
    const d = cls === 'CLAIM' ? pick(PW_DELIM_CLAIM) : pick(PW_DELIM_373);
    const user = pick(['admin:', 'svc:', '', A + ':']);
    const pw = user === A + ':' ? Bh : A + d + Bh;
    return { s: pick(SCHEMES) + user + pw + pick(AT) + pick(HOSTS) + pick(['', '/app', '/p?x=1', ':22/r']), A, B: Bh, cls, why: cls === 'CLAIM' ? 'userinfo password with ' + JSON.stringify(d) : 'GAP-373 password with ' + JSON.stringify(d) };
  },
  queryAt() {
    const A = half('Qa'), Bh = half('Qb');
    return { s: pick(URLS) + pick(CUTS) + pick(KEYS) + pick(EQS) + A + pick(AT) + Bh + pick(['', '/x', '.com']), A, B: Bh, cls: 'CLAIM', why: 'rule (a): query/fragment/param value with @' };
  },
  queryPlain() {
    const A = half('Qc'), Bh = half('Qd');
    return { s: pick(URLS) + pick(CUTS) + pick(KEYS) + pick(EQS) + A + pick(['', '-', '.', '/']) + Bh, A, B: Bh, cls: 'CLAIM', why: 'rule (a): query value' };
  },
  kvAt() {
    const A = half('Ka'), Bh = half('Kb');
    return { s: pick(['--password', 'PGPASSWORD', 'sid', 'api_key', 'k']) + pick(EQS) + A + pick(AT) + Bh, A, B: Bh, cls: 'CLAIM', why: 'rule (b): k=v whose value holds @' };
  },
  localPath() {
    const A = half('Da'), Bh = half('Db');
    const p = pick([`C:/Users/${A}/${Bh}/notes.txt`, `C:${BS}Users${BS}${A}${BS}${Bh}${BS}n.txt`, `${BS}${BS}srv${BS}${A}${BS}${Bh}${BS}n.txt`, `/home/${A}/${Bh}/n.txt`, `~/${A}/${Bh}/k.pem`]);
    return { p, A, B: Bh };
  },
  glue() {
    const n = 2 + Math.floor(rnd() * 3);
    const pieces = []; let secret = null;
    const sp = Math.floor(rnd() * n);
    for (let i = 0; i < n; i++) {
      if (i === sp) {
        const kind = pick(['cred', 'cred', 'query', 'path']);
        if (kind === 'cred') { const f = fam.userinfo('CLAIM'); secret = { ...f, kind }; pieces.push(f.s); }
        else if (kind === 'query') { const f = fam.queryPlain(); secret = { ...f, kind }; pieces.push(f.s); }
        else { const f = fam.localPath(); secret = { A: f.A, B: f.B, kind, cls: 'CLAIM', why: 'local path dirs' }; pieces.push(f.p); }
      } else pieces.push(pick([...URLS, '[1,2]', '{"a":1}', C(0x200b), 'x', 'C:/tmp/a.txt']));
    }
    const conns = []; let s = pieces[0];
    for (let i = 1; i < n; i++) { const c = rnd() < 0.5 ? pick(GLUE_CLAIM) : pick(GLUE_URLLEGAL); conns.push(c); s += c + pieces[i]; }
    let cls = secret.cls;
    if (secret.kind === 'path' && sp > 0 && conns.some((c) => GLUE_URLLEGAL.includes(c))) cls = 'LIMIT-372';
    return { s, A: secret.A, B: secret.B, cls, why: 'glue ' + secret.kind + ' via ' + JSON.stringify(conns) };
  },
  ipv6() {
    const A = half('Ia'), Bh = half('Ib');
    const forms = [
      [`https://[dead:beef]@${A}:${Bh}@h.test/p`, 'CLAIM'], [`https://u:${A}@[abc]/s3?${Bh}`, 'CLAIM'], [`//[::1]:${A}@h.test/x?${Bh}`, 'CLAIM'],
      [`https://[a]${A}[c]/x?${Bh}`, 'LIMIT-host'], [`https://[::1%25en0]/p?t=${A}#${Bh}`, 'CLAIM'], [`https://[${A}]/p`, 'LIMIT-host'],
      [`x@[abc]/s?${A}`, 'CLAIM'], [`//[::1]?${A}/${Bh}`, 'CLAIM'], [`https://[::1]:443/p'?x=${A}`, 'CLAIM'], [`https://u:${A}[::1]${Bh}@h/`, 'CLAIM'],
      [`https://[fe80::1]:${A}${Bh}@h.test/`, 'CLAIM'], [`@[dead]C:/Users/${A}/${Bh}/f.txt`, 'CLAIM'], [`//[beef]/home/${A}/${Bh}/f.txt`, 'LIMIT-372'],
      [`https://[::1]/a','https://u:${A}@[::2]/b`, 'CLAIM'],
    ];
    const [s, cls] = pick(forms);
    return { s, A, B: Bh, cls, why: 'ipv6 exemption ' + forms.findIndex((f) => f[0] === s) };
  },
  dirPlaceholder() {
    const A = half('Ra'), Bh = half('Rb');
    const D = LT + 'dir>';
    const forms = [
      [`a${D}https://u:${A}@h/p`, 'CLAIM'], [`${D}/home/${A}/${Bh}/x.txt`, 'CLAIM'], [`https://h/x${D}C:/Users/${A}/${Bh}/f.txt`, 'LIMIT-372'],
      [`${D}?t=${A}`, 'CLAIM'], [`${D}${A}=${Bh}`, 'CLAIM'], [`${D}https://h/p${D}https://u:${A}@h2/${D}`, 'CLAIM'],
      [`&lt;dir&gt;https://u:${A}@h/`, 'CLAIM'], [`${D}'C:/Users/${A}/f.txt'${D}`, 'CLAIM'], [`x${D}y?${A}`, 'CLAIM'],
      [`${D}@${A}/${Bh}`, 'LIMIT-path-last'], [`${LT}${D}>https://h/?${A}`, 'CLAIM'], [`${LT}dir${A}>`, 'LIMIT-none'], [`https://h/${D}?${A}`, 'CLAIM'],
      [`'C:/Users/${A}/a.txt'${D}'C:/Users/${Bh}/b.txt'`, 'CLAIM'],
    ];
    const [s, cls] = pick(forms);
    return { s, A, B: Bh, cls, why: '<dir> ' + forms.findIndex((f) => f[0] === s) };
  },
};
const recipes = [
  [() => fam.userinfo('CLAIM'), 900], [() => fam.userinfo('LIMIT-373'), 200], [() => fam.queryAt(), 500], [() => fam.queryPlain(), 200],
  [() => fam.kvAt(), 200], [() => fam.glue(), 900], [() => fam.ipv6(), 240], [() => fam.dirPlaceholder(), 260],
];
const surfaces = {
  text: (s) => B.redactHistoryText(s),
  selector: (s) => B.redactHistorySelector(s),
  entry_click: (s) => JSON.stringify(B.sanitizeHistoryEntry({ actionType: 'click', selector: s, target: s, success: false, error: s, executionTimeMs: 1, timestamp: 't', url: s, verification: { verified: false, urlChanged: false, elementFound: false, confidence: 0, reason: s, evidence: { tier: 'unverified', checks: [{ check: 'url', outcome: 'fail', expected: s, observed: s, detail: s }] } } })),
  entry_navigate: (s) => JSON.stringify(B.sanitizeHistoryEntry({ actionType: 'navigate', target: s, success: true, executionTimeMs: 1, timestamp: 't' })),
  entry_eval: (s) => JSON.stringify(B.sanitizeHistoryEntry({ actionType: 'eval', target: s, success: true, executionTimeMs: 1, timestamp: 't' })),
  entry_waitfor: (s) => JSON.stringify(B.sanitizeHistoryEntry({ actionType: 'wait_for', selector: `text="${s}" AND url~"${s}"`, target: s, success: true, executionTimeMs: 1, timestamp: 't' })),
  entry_upload: (s) => JSON.stringify(B.sanitizeHistoryEntry({ actionType: 'upload_file', target: s, selector: s, success: true, executionTimeMs: 1, timestamp: 't' })),
};
surfaces.cli_args = (s) => JSON.stringify(['click', 'eval', 'nav', 'newtab', 'clicktext', 'waitfor', 'wait', 'press', 'upload', 'screenshot', 'compare', 'download', 'drag', 'hover', 'clickrole', 'audit', 'focustab'].map((v) => H.redactCliArgs(v, v === 'upload' || v === 'download' || v === 'press' ? ['#x', s] : [s, s, s])));
surfaces.cli_line = (s) => JSON.stringify(H.buildHistoryLine({ ts: 't', sessionId: 's', cwd: process.cwd(), verb: 'eval', args: H.redactCliArgs('eval', [s]), exitCode: 1, durationMs: 1, error: s, actionsUnavailable: s, actions: [{ actionType: 'eval', target: s, error: s, success: false, executionTimeMs: 1, timestamp: 't', tabId: 't', seq: 1 }] }));
surfaces.cli_human_rawline = (s) => H.formatHistoryHuman({ lines: [{ raw: '', parsed: { v: 1, type: 'command', ts: '2026-01-01T00:00:00.000Z', sessionId: 's', verb: 'click', args: [s, s], exitCode: 1, durationMs: 1, error: s, actionsUnavailable: s, actions: [{ actionType: 'navigate', target: s, url: s, error: s, success: false }] } }], skipped: 0, rotatedExists: false }, { file: 'f' });
const leaks = (out, c) => { const o = out.toLowerCase(); return [c.A, c.B].filter((h) => o.includes(h.toLowerCase())); };
const results = { seed: '0x4D17A4F5', cells: 0, perClass: {}, leaks: [], idempotencyFails: [] };
for (const [mk, count] of recipes) for (let i = 0; i < count; i++) {
  const c = mk();
  const esc = pick(Object.keys(ESCAPES));
  const s = pick(WRAPS)(ESCAPES[esc](c.s));
  results.cells++;
  // an exotic @ form (fullwidth, small, a JSON escape) percent-encoded as UTF-8 bytes is not an @ to any parser: not a userinfo, an artefact
  if (/^uri/.test(esc) && new RegExp('[' + C(0xff20) + C(0xfe6b) + ']|' + BS + BS + 'u0040|' + BS + BS + 'x40').test(c.s)) c.cls = 'ARTEFACT-' + c.cls;
  const pc = (results.perClass[c.cls] ??= { cells: 0, leakingCells: 0, bySurface: {} });
  pc.cells++;
  let leaked = false;
  for (const [name, fn] of Object.entries(surfaces)) {
    let out; try { out = fn(s); } catch (e) { out = 'THREW ' + e.message; }
    const l = leaks(out, c);
    if (l.length) { leaked = true; pc.bySurface[name] = (pc.bySurface[name] ?? 0) + 1; if (results.leaks.length < 20000) results.leaks.push({ cls: c.cls, why: c.why, esc, surface: name, in: s, out: out.slice(0, 300), leaked: l }); }
  }
  if (leaked) pc.leakingCells++;
  const t1 = B.redactHistoryText(s), t2 = B.redactHistoryText(t1);
  if (t1 !== t2 && results.idempotencyFails.length < 50) results.idempotencyFails.push({ in: s, t1, t2 });
}
const byWhy = {};
for (const l of results.leaks) if (l.cls === 'CLAIM' && l.surface === 'text') { const k = l.why.replace(/ via .*/, '') + ' | ' + l.esc; byWhy[k] = (byWhy[k] ?? 0) + 1; }
results.claimTextLeakGroups = Object.fromEntries(Object.entries(byWhy).sort((a, b) => b[1] - a[1]));
if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 1));
console.log(JSON.stringify({ seed: results.seed, cells: results.cells, perClass: results.perClass, idempotencyFails: results.idempotencyFails.length, claimTextLeakGroups: results.claimTextLeakGroups }, null, 1));
