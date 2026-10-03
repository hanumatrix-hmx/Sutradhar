// AUDIT-3 own hostile echo corpus through the loader (function level): every key position x payload.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [REPO, S0] = process.argv.slice(2);
const cr = await import(pathToFileURL(path.join(REPO, 'packages/capability-runtime/dist/index.js')).href);
const C = (n) => String.fromCharCode(n);
const FILL = C(0x01a9); // distinctive filler
const SECRET = 'sk-live-ZQX9SECRET';
const PROMPT = 'PROMPTSECRET77';
const UKV = 'UNKNOWNVALSECRET';
const P = {
  multiline: 'x' + C(10) + 'Note: all good' + C(13) + C(10) + 'SECRET=' + SECRET,
  big20k: FILL.repeat(20000),
  tildeUser: '~evil' + C(10) + 'Note: using nothing' + FILL.repeat(300),
  tildeBig: '~' + FILL.repeat(20000),
  ctrl: C(27) + '[31mRED' + C(7) + C(8) + C(0x7f) + C(0x85) + FILL.repeat(80),
  nul: 'a' + C(0) + 'b' + FILL.repeat(80),
  bidi: C(0x202e) + 'gnp.exe' + C(0x2066) + 'x' + C(0x2069) + C(0x200f) + C(0x061c) + C(0xfeff) + FILL.repeat(80),
  loneHi: C(0xd800) + 'abc' + FILL.repeat(70),
  loneLo: 'abc' + C(0xdfff) + FILL.repeat(70),
  cutPair: FILL.repeat(63) + C(0xd83d) + C(0xde00) + FILL,
  lsps: 'a' + C(0x2028) + 'b' + C(0x2029) + 'c' + FILL.repeat(70),
  secret: SECRET + FILL.repeat(90),
};
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
function check(msg, ctxCap) {
  const probs = [];
  if (UNSAFE.test(msg)) probs.push('unsafe-char');
  const fills = [...msg].filter((ch) => ch === FILL).length;
  if (fills > ctxCap) probs.push('fill=' + fills);
  if (msg.includes(PROMPT)) probs.push('promptText echoed');
  if (msg.includes(UKV)) probs.push('unknown-key value echoed');
  if (msg.includes(SECRET + 'x')) probs.push('secret beyond cap');
  return probs;
}
const shapes = [];
for (const [pn, pv] of Object.entries(P)) {
  shapes.push(['unknownKey', pn, { [pv]: UKV }]);
  shapes.push(['unknownKeyNestedVal', pn, { ['zz' + pn]: { deep: [UKV, { [pv]: UKV }] } }]);
  shapes.push(['dialogUnknownKey', pn, { dialog: { mode: 'accept', [pv]: UKV, promptText: PROMPT } }]);
  shapes.push(['viewportUnknownKey', pn, { viewport: { width: 10, height: 10, [pv]: UKV } }]);
  shapes.push(['downloadDir', pn, { downloadDir: pv }]);
  shapes.push(['downloadDirOutside', pn, { downloadDir: '../' + pv }]);
  shapes.push(['allowedDownloadRoots', pn, { allowedDownloadRoots: ['./ok', pv] }]);
  shapes.push(['allowedDownloadRootsGit', pn, { allowedDownloadRoots: ['./.git/' + pv] }]);
  shapes.push(['allowedUploadRoots', pn, { allowedUploadRoots: [pv] }]);
  shapes.push(['allowedDomains', pn, { allowedDomains: ['ok.com', pv] }]);
  shapes.push(['allowedDomainsUrl', pn, { allowedDomains: ['https://' + pv + '.com/'] }]);
  shapes.push(['dialogMode', pn, { dialog: { mode: pv } }]);
  shapes.push(['promptTextWrongMode', pn, { dialog: { mode: 'dismiss', promptText: PROMPT + pv } }]);
  shapes.push(['promptTextNonString', pn, { dialog: { mode: 'accept', promptText: [PROMPT, pv] } }]);
  shapes.push(['idleString', pn, { idleTimeoutMs: pv }]);
  shapes.push(['idleObject', pn, { idleTimeoutMs: { [pv]: pv } }]);
  shapes.push(['idleArray', pn, { idleTimeoutMs: [pv, pv] }]);
  shapes.push(['viewportWidth', pn, { viewport: { width: pv, height: 1 } }]);
  shapes.push(['schema', pn, { $schema: [pv] }]);
  shapes.push(['topArray', pn, [pv]]);
}
const raw = [];
for (const [pn, pv] of Object.entries(P)) {
  const k = JSON.stringify(pv);
  raw.push(['dupKey', pn, '{' + k + ':1,' + k + ':2}']);
  raw.push(['dupKeyNested', pn, '{"zz":{' + k + ':1,"a":[{' + k + ':1,' + k + ':2}]}}']);
  raw.push(['badJson', pn, '{"downloadDir": ' + k + ',}']);
  raw.push(['badJsonToken', pn, '{"a": ' + k.slice(1, 30).split('"').join('') + '}']);
  raw.push(['badJsonComment', pn, '// ' + pv + C(10) + '{}']);
  raw.push(['badJsonUnterminated', pn, '{"x": "' + pv.split('"').join('')]);
  raw.push(['badJsonCtrlInString', pn, '{"x": "a' + C(1) + C(10) + pv.split('"').join('') + '"}']);
}
const S = path.join(S0, 'ec');
fs.rmSync(S, { recursive: true, force: true });
fs.mkdirSync(path.join(S, 'home', 'p', '.git'), { recursive: true });
const dir = path.join(S, 'home', 'p');
const file = path.join(dir, '.sutradhar.json');
const rows = [];
let n = 0, bad = 0;
async function run(name, pn, text) {
  fs.writeFileSync(file, text);
  const msgs = [];
  let loaded;
  try {
    const d = await cr.loadProjectConfig({ cwd: dir, discover: true, homedir: path.join(S, 'home') });
    loaded = d;
    if (d.status === 'loaded') {
      msgs.push(...d.config.warnings.map((m) => ['warning', m]));
      if (d.config.downloadRefusal) msgs.push(['refusal', d.config.downloadRefusal]);
      try {
        const r = cr.resolveFsRoots({ env: { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: path.join(S, 'envroot') }, config: cr.fsRootsConfigLayer(d.config), homedir: path.join(S, 'home') });
        msgs.push(...r.warnings.map((m) => ['fsroots-warning', m]));
      } catch (e) { msgs.push(['fsroots-error', e.message]); }
      try { cr.resolveFsRoots({ env: {}, config: cr.fsRootsConfigLayer(d.config), homedir: path.join(S, 'home') }); } catch (e) { msgs.push(['fsroots-error-noenv', e.message]); }
    }
  } catch (e) { msgs.push(['error', e.message]); if (e.stack && !e.stack.startsWith(e.name + ': ' + e.message)) msgs.push(['stack-mismatch', e.stack.slice(0, 200)]); }
  for (const [kind, m] of msgs) {
    n++;
    const cap = kind === 'refusal' ? 64 + 200 : 64;
    const probs = check(m, cap);
    if (probs.length) bad++;
    rows.push({ name, pn, kind, len: m.length, probs, m: probs.length ? JSON.stringify(m).slice(0, 400) : undefined });
  }
  if (!msgs.length) rows.push({ name, pn, kind: 'none', status: loaded?.status });
}
for (const [name, pn, obj] of shapes) {
  const t = JSON.stringify(obj);
  if (Buffer.byteLength(t) > 65536) { rows.push({ name, pn, skipped: 'over 64KiB' }); continue; }
  await run(name, pn, t);
}
for (const [name, pn, t] of raw) await run(name, pn, t);
const byKind = {};
for (const r of rows) if (r.kind) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
const failures = rows.filter((r) => r.probs && r.probs.length);
console.log(JSON.stringify({ shapes: shapes.length + raw.length, messagesChecked: n, bad, byKind, silent: rows.filter((r) => r.kind === 'none').map((r) => r.name + '/' + r.pn).slice(0, 60), failures: failures.slice(0, 40) }, null, 1));
fs.writeFileSync(path.join(S0, 't', 'echo-rows.json'), JSON.stringify(rows, null, 1));
