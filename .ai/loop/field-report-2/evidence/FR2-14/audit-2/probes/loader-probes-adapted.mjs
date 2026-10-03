// AUDIT-2 ADAPTED COPY of audit-1/probes/loader-probes.mjs: the only change is that a loaded config is passed
// through resolveFsRoots(config layer only), which throws the recorded downloadRefusal. Output file renamed.
// AUDIT-1 (independent): function-level hostile-config / fail-closed / search probes against the BUILT
// capability-runtime dist. Writes only under argv[2] (a scratch root). Prints JSON lines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const CR = await import(pathToFileURL(path.join(WT, 'packages/capability-runtime/dist/index.js')).href);
const { loadProjectConfig } = CR;

const S = path.resolve(process.argv[2]);
fs.mkdirSync(S, { recursive: true });
const HOME = path.join(S, 'home');
fs.mkdirSync(HOME, { recursive: true });
const out = [];
function repo(name, cfgText, { git = true } = {}) {
  const d = path.join(S, 'r', name);
  fs.mkdirSync(d, { recursive: true });
  if (git) fs.mkdirSync(path.join(d, '.git', 'hooks'), { recursive: true });
  if (cfgText !== undefined) fs.writeFileSync(path.join(d, '.sutradhar.json'), cfgText);
  return d;
}
async function run(id, cwd, opts = {}) {
  const t0 = performance.now();
  let res;
  try {
    const r = await loadProjectConfig({ cwd, discover: !opts.explicit, explicitPath: opts.explicit, explicitOrigin: opts.explicit ? 'env' : undefined, homedir: opts.home ?? HOME }); if (r.status === 'loaded') { CR.resolveFsRoots({ env: {}, config: CR.fsRootsConfigLayer(r.config) }); }
    res = { id, ok: true, status: r.status, origin: r.config?.origin, path: r.config?.path, dl: r.config?.resolved.allowedDownloadRoots, ul: r.config?.resolved.allowedUploadRoots, values: r.config?.values, warnings: r.config?.warnings?.map((w) => w.length > 300 ? w.slice(0, 300) + `...(${w.length} chars)` : w), stoppedAt: r.stoppedAt, stopDir: r.stopDir, searched: r.searched, ms: +(performance.now() - t0).toFixed(2) };
  } catch (e) {
    res = { id, ok: false, name: e.name, msg: String(e.message).slice(0, 700), msgLen: String(e.message).length, ms: +(performance.now() - t0).toFixed(2) };
  }
  out.push(res); console.log(JSON.stringify(res));
  return res;
}
const J = (o) => JSON.stringify(o);

// ---------- hostile download roots (discovered) ----------
const outside = path.join(S, 'outside'); fs.mkdirSync(outside, { recursive: true });
const B = String.fromCharCode(92);
const dlCases = {
  dotdot: '../outside', abs: outside, absFwd: outside.split(B).join('/'), tilde: '~', tildeSub: '~/x', tildeUser: '~bob/x',
  envPct: `%USERPROFILE%${B}x`, envDollar: '$HOME/x', unc: `${B}${B}localhost${B}E$${B}x`, device: `${B}${B}?${B}` + outside, deviceDot: `${B}${B}.${B}` + outside,
  driveRel: 'E:x', rootRel: '/x', bsRootRel: `${B}x`, git: '.git/hooks', GIT: '.GIT/hooks', gitDot: '.git./hooks', gitSpace: '.git /hooks',
  gitAds: '.git::$INDEX_ALLOCATION/hooks', gitAds2: '.git:$I30:$INDEX_ALLOCATION/hooks', git83: 'GIT~1/hooks', gitTrailDotOnly: '.git.', dlUp: 'dl/../../outside', dlUpBs: `dl${B}..${B}..${B}outside`,
  nested: 'sub/.git/x', dot: '.', gitItself: '.git', gitMixed: './.Git', nul: 'a' + String.fromCharCode(0) + 'b', longPath: 'a/'.repeat(200) + 'x', ok: './dl',
};
for (const [k, v] of Object.entries(dlCases)) {
  await run('DL.' + k, repo('dl-' + k, J({ downloadDir: v })));
  await run('ADR.' + k, repo('adr-' + k, J({ allowedDownloadRoots: ['./ok', v] })));
}
{
  const d = repo('junc-out', J({ downloadDir: './jn/new' }));
  fs.symlinkSync(outside, path.join(d, 'jn'), 'junction');
  await run('DL.junctionOut', d);
  const g = repo('junc-git', J({ downloadDir: './jg/hooks' }));
  fs.symlinkSync(path.join(g, '.git'), path.join(g, 'jg'), 'junction');
  await run('DL.junctionToGit', g);
  const g2 = repo('junc-cwd', J({ downloadDir: './dl' }));
  const jl = path.join(S, 'jlink'); fs.symlinkSync(g2, jl, 'junction');
  await run('DL.cwdViaJunction', jl);
  const sl = repo('cfg-symlink', undefined);
  fs.writeFileSync(path.join(outside, 'victim.json'), J({ secretKeyName_SHOULD_NOT_ECHO: 1, downloadDir: './dl' }));
  try { fs.symlinkSync(path.join(outside, 'victim.json'), path.join(sl, '.sutradhar.json'), 'file'); await run('SRCH.cfgFileSymlinkOut', sl); } catch (e) { console.log(J({ id: 'SRCH.cfgFileSymlinkOut', skipped: e.code })); }
}
await run('DL.dotdot.explicit', S, { explicit: path.join(S, 'r', 'dl-dotdot', '.sutradhar.json') });
await run('DL.git.explicit', S, { explicit: path.join(S, 'r', 'dl-git', '.sutradhar.json') });

// ---------- other hostile keys / malformed shapes ----------
const RAW = (s) => ({ raw: s });
const keyCases = {
  dialogAccept: { dialog: { mode: 'accept' } }, idle0: { idleTimeoutMs: 0 }, idleHuge: { idleTimeoutMs: 1e12 }, idleNeg: { idleTimeoutMs: -1 }, idleMax: { idleTimeoutMs: 2147483647 }, idleFloat: { idleTimeoutMs: 1000.5 }, idleExp: RAW('{"idleTimeoutMs":1e3}'), idleStr: { idleTimeoutMs: '5000' }, idleNull: { idleTimeoutMs: null }, idleFalse: { idleTimeoutMs: false },
  domStar: { allowedDomains: ['*'] }, domEmptyStr: { allowedDomains: [''] }, domDot: { allowedDomains: ['.'] }, domRegex: { allowedDomains: ['.*'] }, domRegex2: { allowedDomains: ['a|b.com'] }, domUrl: { allowedDomains: ['https://example.com/'] },
  domUpper: { allowedDomains: ['EXAMPLE.COM'] }, domIdn: { allowedDomains: ['bücher.de'] }, domPuny: { allowedDomains: ['xn--bcher-kva.de'] }, domTrailDot: { allowedDomains: ['example.com.'] }, domIpv6: { allowedDomains: ['[::1]'] }, domIpv6port: { allowedDomains: ['[::1]:80'] }, domNum: { allowedDomains: ['1'] }, domTld: { allowedDomains: ['com'] },
  domSpace: { allowedDomains: [' a.com'] }, domEmpty: { allowedDomains: [] }, domNull: { allowedDomains: null }, domStr: { allowedDomains: 'a.com' }, domNested: { allowedDomains: [['a.com']] }, domHuge: { allowedDomains: Array.from({ length: 4000 }, (_, i) => `d${i}.com`) }, domFalse: { allowedDomains: false },
  ulEmpty: { allowedUploadRoots: [] }, ulOutside: { allowedUploadRoots: ['../anything'] }, ulNullItem: { allowedUploadRoots: [null] }, ulNull: { allowedUploadRoots: null },
  vpZero: { viewport: { width: 0, height: 1 } }, vpStr: { viewport: { width: '800', height: 600 } }, vpHuge: { viewport: { width: 1e9, height: 1e9 } }, vpNull: { viewport: null }, vpArr: { viewport: [800, 600] }, vpMissing: { viewport: { width: 800 } },
  dlgNull: { dialog: null }, dlgStr: { dialog: 'accept' }, dlgPromptDismiss: { dialog: { mode: 'dismiss', promptText: 'x' } }, dlgUpper: { dialog: { mode: 'ACCEPT' } }, dlgExtra: { dialog: { mode: 'dismiss', foo: 1 } }, dlgFalse: { dialog: false },
  ddNull: { downloadDir: null }, ddEmpty: { downloadDir: '' }, ddNum: { downloadDir: 5 }, ddFalse: { downloadDir: false }, schemaNum: { $schema: 5 },
  topNull: null, topArr: [], topStr: 'x', topNum: 3,
  protoKey: RAW('{"__proto__":{"allowedDomains":["evil.com"]},"viewport":{"width":2,"height":3}}'), ctorKey: { constructor: { prototype: { x: 1 } } }, nestedProto: RAW('{"dialog":{"__proto__":{"mode":"accept"}}}'),
  dupKey: RAW('{"allowedDomains":["a.com"],"allowedDomains":["b.com"]}'), dupEsc: RAW(`{"allowedDomains":["a.com"],"allowedDoma${B}u0069ns":["b.com"]}`), dupNested: RAW('{"zz":{"a":1,"a":2}}'), dupInString: RAW(`{"zz":"${B}"a${B}":1,${B}"a${B}":2","viewport":{"width":5,"height":5}}`),
  comment: RAW('// c\n{"viewport":{"width":5,"height":5}}'), blockComment: RAW('{/*x*/"viewport":{"width":5,"height":5}}'),
  bom: RAW('﻿{"viewport":{"width":5,"height":5}}'), empty: RAW(''), ws: RAW('  \n '),
  secretBad: RAW('{"allowedDomains":["a.com"], "token":"sk_live_SUPERSECRET_0123456789abcdef" ,}'), secretBad2: RAW('{"token":"sk_live_SUPERSECRET_0123456789abcdef" x}'), secretVal: { allowedDomains: ['sk_live_SUPERSECRET_0123456789abcdef'] }, secretIdle: { idleTimeoutMs: 'sk_live_SUPERSECRET_0123456789abcdef' }, secretDl: { downloadDir: '../sk_live_SUPERSECRET_0123456789abcdef' },
  unknownLong: { ['k'.repeat(20000)]: 1 }, unknownSecretKey: { sk_live_SUPERSECRET_KEYNAME: 'v' }, unknownTypo: { allowedDomian: ['x.com'] }, unknownCase: { AllowedDomains: ['x.com'] },
  deep: RAW('{"zz":' + '['.repeat(20000) + ']'.repeat(20000) + '}'), deepObj: RAW('{"zz":' + '{"a":'.repeat(7000) + '1' + '}'.repeat(7000) + '}'),
};
for (const [k, v] of Object.entries(keyCases)) {
  const text = v && typeof v === 'object' && 'raw' in v ? v.raw : J(v);
  await run('KEY.' + k, repo('k-' + k, text));
}
{
  const u16 = repo('utf16', undefined); fs.writeFileSync(path.join(u16, '.sutradhar.json'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"viewport":{"width":5,"height":5}}', 'utf16le')])); await run('KEY.utf16le', u16);
  const u16n = repo('utf16nobom', undefined); fs.writeFileSync(path.join(u16n, '.sutradhar.json'), Buffer.from('{"viewport":{"width":5,"height":5}}', 'utf16le')); await run('KEY.utf16noBom', u16n);
  const lat = repo('latin1', undefined); fs.writeFileSync(path.join(lat, '.sutradhar.json'), Buffer.from([0x7b, 0x22, 0x7a, 0xe9, 0x22, 0x3a, 0x31, 0x7d])); await run('KEY.latin1', lat);
  const big = repo('big', undefined); fs.writeFileSync(path.join(big, '.sutradhar.json'), '{"zz":"' + 'a'.repeat(65536) + '"}'); await run('KEY.over64k', big);
  const body = '{"zz":"' + 'a'.repeat(65536 - 9) + '"}';
  const ex = repo('exact64k', undefined); fs.writeFileSync(path.join(ex, '.sutradhar.json'), body); await run('KEY.exact64k_' + Buffer.byteLength(body), ex);
  const bb = repo('bom64k', undefined); fs.writeFileSync(path.join(bb, '.sutradhar.json'), '﻿' + body); await run('KEY.bomPlus64k', bb);
  const bigWs = repo('bigws', undefined); fs.writeFileSync(path.join(bigWs, '.sutradhar.json'), '{}' + ' '.repeat(70000)); await run('KEY.over64kWhitespace', bigWs);
}

// ---------- search ----------
{
  const base = path.join(S, 's'); fs.mkdirSync(path.join(base, 'p', 'a', 'b', 'c'), { recursive: true });
  fs.writeFileSync(path.join(base, 'p', '.sutradhar.json'), J({ viewport: { width: 11, height: 11 } }));
  fs.writeFileSync(path.join(base, 'p', 'a', '.sutradhar.json'), J({ allowedDomains: ['near.com'] }));
  fs.mkdirSync(path.join(base, 'p', '.git'), { recursive: true });
  await run('SRCH.nearestWinsNoMerge', path.join(base, 'p', 'a', 'b', 'c'));
  const dd = repo('cfg-is-dir', undefined); fs.mkdirSync(path.join(dd, '.sutradhar.json')); fs.mkdirSync(path.join(dd, 'x'), { recursive: true }); await run('SRCH.cfgIsDir', path.join(dd, 'x'));
  const bl = repo('cfg-broken', undefined);
  try { fs.symlinkSync(path.join(S, 'nope.json'), path.join(bl, '.sutradhar.json'), 'file'); await run('SRCH.brokenSymlink', bl); } catch (e) { console.log(J({ id: 'SRCH.brokenSymlink', skipped: e.code })); }
  const bj = repo('cfg-brokenjunc', undefined); fs.symlinkSync(path.join(S, 'nodir'), path.join(bj, '.sutradhar.json'), 'junction'); await run('SRCH.brokenJunction', bj);
  await run('SRCH.driveRoot', `E:${B}`);
  await run('SRCH.uncShareRoot', `${B}${B}localhost${B}E$${B}`);
  await run('SRCH.uncChild', `${B}${B}localhost${B}E$` + path.join(base, 'p', 'a', 'b', 'c').slice(2));
  await run('SRCH.devicePathChild', `${B}${B}?${B}` + path.join(base, 'p', 'a', 'b', 'c'));
  // home boundary
  const H2 = path.join(S, 'h2', 'home'); fs.mkdirSync(path.join(H2, 'plain', 'q'), { recursive: true });
  fs.writeFileSync(path.join(S, 'h2', '.sutradhar.json'), J({ viewport: { width: 1, height: 1 } }));
  const ext = path.join(S, 'ext', 'deep'); fs.mkdirSync(ext, { recursive: true });
  fs.symlinkSync(ext, path.join(H2, 'link'), 'junction');
  await run('SRCH.home.plainChild', path.join(H2, 'plain', 'q'), { home: H2 });
  await run('SRCH.home.cwdIsJunctionInHomeToOutside', path.join(H2, 'link'), { home: H2 });
  await run('SRCH.home.caseVariantHome', path.join(H2, 'plain', 'q'), { home: H2.toUpperCase() + B });
  // .git boundary
  const o = path.join(S, 'outer'); fs.mkdirSync(path.join(o, 'repo', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(o, '.sutradhar.json'), J({ allowedDomains: ['outer.com'] }));
  fs.writeFileSync(path.join(o, 'repo', '.git'), 'gitdir: x');
  await run('SRCH.gitFileBoundary', path.join(o, 'repo', 'sub'));
  const nn = path.join(S, 'nogit', 'a', 'b'); fs.mkdirSync(nn, { recursive: true }); fs.writeFileSync(path.join(S, 'nogit', '.sutradhar.json'), '{}');
  await run('SRCH.noBoundaryWalksUp', nn, { home: path.join(S, 'elsewhere-home') });
  await run('SRCH.cwdInsideDotGit', path.join(S, 'r', 'dl-git', '.git', 'hooks'));
}
// ---------- relative path base / dedupe ----------
{
  const d = repo('relbase', J({ downloadDir: 'dl', allowedUploadRoots: ['up'] }));
  fs.mkdirSync(path.join(d, 'x', 'y'), { recursive: true });
  await run('REL.fromChild', path.join(d, 'x', 'y'));
  await run('REL.dedupeCase', repo('dedupe', J({ downloadDir: './DL', allowedDownloadRoots: ['./dl', './dl/', `dl${B}.`] })));
}
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'loader-probes-adapted.json'), JSON.stringify(out, null, 1));
