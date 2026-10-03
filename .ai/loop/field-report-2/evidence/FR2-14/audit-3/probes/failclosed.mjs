// AUDIT-3 fail-closed shapes: every malformed file must be a load ERROR (never unset/unrestricted).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [REPO, S0] = process.argv.slice(2);
const cr = await import(pathToFileURL(path.join(REPO, 'packages/capability-runtime/dist/index.js')).href);
const S = path.join(S0, 'fc');
fs.rmSync(S, { recursive: true, force: true });
const D = path.join(S, 'home', 'p');
fs.mkdirSync(path.join(D, '.git'), { recursive: true });
const FILE = path.join(D, '.sutradhar.json');
const J = (o) => JSON.stringify(o);
const deep = (n) => '['.repeat(n) + ']'.repeat(n);
const cases = [];
const add = (name, content, expect = 'error') => cases.push({ name, content, expect });
const keys = ['downloadDir', 'allowedDownloadRoots', 'allowedUploadRoots', 'allowedDomains', 'dialog', 'idleTimeoutMs', 'viewport', '$schema'];
for (const k of keys) for (const [vn, v] of [['null', null], ['emptyStr', ''], ['zero', 0], ['false', false], ['emptyArr', []], ['emptyObj', {}], ['true', true], ['num', 7], ['str', 'x'], ['arrNull', [null]], ['arrNum', [1]], ['arrEmptyStr', ['']], ['nestedArr', [['a']]]]) {
  let exp = 'error';
  if (k === 'idleTimeoutMs' && vn === 'zero') exp = 'ok';
  if (k === '$schema' && vn === 'str') exp = 'ok';
  if (k === '$schema' && vn === 'emptyStr') exp = 'ok';
  if (k === 'downloadDir' && vn === 'str') exp = 'ok';
  if (['allowedDownloadRoots', 'allowedUploadRoots'].includes(k) && vn === 'nestedArr') exp = 'error';
  add(k + '=' + vn, J({ [k]: v }), exp);
}
for (const d of ['', ' ', '*.x.com', '.x.com', 'https://x.com', 'x.com:80', 'x.com/', 'x..com', '-x.com', 'x_y.com', 'x.com.', 'localhost:3000', '[::1', 'a b.com', 'x.com?q', 'xn--?']) add('allowedDomains=[' + d + ']', J({ allowedDomains: [d] }));
for (const [n, v] of [['dialogBadMode', { mode: 'ACCEPT' }], ['dialogNoMode', {}], ['dialogPromptNum', { mode: 'accept', promptText: 5 }], ['dialogPromptWrongMode', { mode: 'report', promptText: 'x' }]]) add(n, J({ dialog: v }));
for (const [n, v] of [['vpStr', { width: '1', height: 1 }], ['vpFloat', { width: 1.5, height: 1 }], ['vpZero', { width: 0, height: 1 }], ['vpNoH', { width: 1 }], ['vpOver', { width: 10000001, height: 1 }], ['vpNeg', { width: -1, height: 1 }]]) add(n, J({ viewport: v }));
add('vpInfinity(1e400)', '{"viewport":{"width":1e400,"height":1}}');
add('idleInfinity', '{"idleTimeoutMs":1e400}');
for (const v of [999, 2147483648, 1.5, -1, '1000']) add('idle=' + J(v), J({ idleTimeoutMs: v }));
add('idle=-0 (is 0)', '{"idleTimeoutMs":-0}', 'ok');
add('dupTop', '{"allowedDomains":["a.com"],"allowedDomains":["b.com"]}');
add('dupNested', '{"dialog":{"mode":"accept","mode":"dismiss"}}');
add('dupEscaped', '{"allowedDomains":["a.com"],"allowed' + String.fromCharCode(92) + 'u0044omains":["b.com"]}');
add('dupInUnknown', '{"zz":{"q":1,"q":2}}');
add('lineComment', '// c' + String.fromCharCode(10) + '{}');
add('blockComment', '{/* c */}');
add('trailingComma', '{"allowedDomains":["a.com"],}');
add('empty', '');
add('whitespace', '   ' + String.fromCharCode(10));
add('topArray', '[]');
add('topNull', 'null');
add('topString', '"x"');
add('topNumber', '5');
add('__proto__ smuggle', '{"__proto__":{"allowedDomains":["evil.com"]}}', 'ok-noproto');
add('constructor smuggle', '{"constructor":{"prototype":{"allowedDomains":["evil.com"]}}}', 'ok-noproto');
add('deep nesting unknown key', '{"zz":' + deep(30000) + '}', 'ok-or-error');
add('deep nesting idle', '{"idleTimeoutMs":' + deep(30000) + '}');
add('over 64KiB', '{"zz":"' + 'a'.repeat(65536) + '"}');
const bytes = [];
const u8 = (s) => Buffer.from(s, 'utf8');
bytes.push(['utf8 BOM (accepted)', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), u8('{"allowedDomains":["a.com"]}')]), 'ok']);
bytes.push(['utf16le BOM', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"allowedDomains":["a.com"]}', 'utf16le')]), 'error']);
bytes.push(['utf16be BOM', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('{"allowedDomains":["a.com"]}', 'utf16le').swap16()]), 'error']);
bytes.push(['utf16le no BOM', Buffer.from('{"allowedDomains":["a.com"]}', 'utf16le'), 'error']);
bytes.push(['invalid utf8', Buffer.concat([u8('{"allowedDomains":["a'), Buffer.from([0xc3, 0x28]), u8('.com"]}')]), 'error']);
const pad = (n) => { const head = '{"zz":"'; const tail = '"}'; return u8(head + 'a'.repeat(n - head.length - tail.length) + tail); };
bytes.push(['exactly 65536 bytes', pad(65536), 'ok']);
bytes.push(['65537 bytes', pad(65537), 'error']);
bytes.push(['BOM + 65536 bytes', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), pad(65536)]), 'ok']);
bytes.push(['BOM + 65537 bytes', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), pad(65537)]), 'error']);
const rows = []; let pass = 0, fail = 0;
async function load(fsInject) { return cr.loadProjectConfig({ cwd: D, discover: true, homedir: path.join(S, 'home'), ...(fsInject ? { fs: fsInject } : {}) }); }
function judge(name, expect, outcome, extra = {}) {
  let ok;
  if (expect === 'error') ok = outcome.kind === 'error';
  else if (expect === 'ok') ok = outcome.kind === 'loaded';
  else if (expect === 'ok-noproto') ok = outcome.kind === 'loaded' && outcome.values.allowedDomains === undefined && ({}).allowedDomains === undefined && Object.prototype.allowedDomains === undefined;
  else ok = outcome.kind === 'error' || outcome.kind === 'loaded';
  ok ? pass++ : fail++;
  rows.push({ name, expect, ok, outcome: outcome.kind, msg: outcome.msg?.slice(0, 160), ...extra });
}
async function tryLoad(fsInject) {
  try { const d = await load(fsInject); return d.status === 'loaded' ? { kind: 'loaded', values: d.config.values } : { kind: 'none' }; }
  catch (e) { return { kind: e.name === 'ProjectConfigError' ? 'error' : 'crash:' + e.name, msg: e.message }; }
}
for (const c of cases) { fs.writeFileSync(FILE, c.content); judge(c.name, c.expect, await tryLoad()); }
for (const [n, b, e] of bytes) { fs.writeFileSync(FILE, b); judge(n, e, await tryLoad()); }
fs.writeFileSync(FILE, '{"allowedDomains":["a.com"]}');
const real = { stat: (p) => fs.promises.stat(p), lstat: (p) => fs.promises.lstat(p), readFile: (p) => fs.promises.readFile(p) };
judge('changes during read: stat small, readFile 70 KiB', 'error', await tryLoad({ ...real, readFile: async () => pad(70000) }));
judge('changes during read: readFile returns malformed', 'error', await tryLoad({ ...real, readFile: async () => u8('{"allowedDomains":[]}') }));
judge('changes during read: file vanishes (ENOENT on read)', 'error', await tryLoad({ ...real, readFile: async () => { const e = new Error('gone'); e.code = 'ENOENT'; throw e; } }));
judge('changes during read: becomes a directory', 'error', await tryLoad({ ...real, stat: async (p) => (p.endsWith('.sutradhar.json') ? { isFile: () => false, size: 0, uid: 0, mode: 0 } : fs.promises.stat(p)) }));
judge('EACCES on stat', 'error', await tryLoad({ ...real, stat: async (p) => { if (p.endsWith('.sutradhar.json')) { const e = new Error('acc'); e.code = 'EACCES'; throw e; } return fs.promises.stat(p); } }));
console.log(JSON.stringify({ total: pass + fail, pass, fail, failures: rows.filter((r) => !r.ok), sample: rows.slice(0, 5) }, null, 1));
fs.writeFileSync(path.join(S0, 't', 'failclosed-rows.json'), JSON.stringify(rows, null, 1));
