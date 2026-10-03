// AUDIT-2 function-level re-verification of F3 (home boundary under links), F4 (echo caps), F5 (TOCTOU doc claim).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const imp = (p) => import(pathToFileURL(path.join(WT, p)).href);
const CR = await imp('packages/capability-runtime/dist/index.js');
const BR = await imp('packages/browser/dist/index.js');
const S = path.resolve(process.argv[2]); fs.rmSync(S, { recursive: true, force: true }); fs.mkdirSync(S, { recursive: true });
const OUT = process.argv[3];
const res = {};
const J = (o) => JSON.stringify(o);
const load = (cwd, home) => CR.loadProjectConfig({ cwd, discover: true, homedir: home }).then((r) => ({ status: r.status, path: r.config?.path ?? null, stoppedAt: r.stoppedAt ?? null, stopDir: r.stopDir ?? null }), (e) => ({ err: e.message.slice(0, 200) }));
// ---- F3 ----
{
  const top = path.join(S, 'f3'); const home = path.join(top, 'home'); const far = path.join(S, 'far', 'proj');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(far, { recursive: true });
  fs.writeFileSync(path.join(top, '.sutradhar.json'), J({ allowedDomains: ['above-home.test'] }));
  fs.symlinkSync(far, path.join(home, 'jn'), 'junction');
  res.F3_cwdJunctionInHomeToOutside = await load(path.join(home, 'jn'), home);
  let sym = 'n/a'; try { fs.symlinkSync(far, path.join(home, 'sl'), 'dir'); sym = await load(path.join(home, 'sl'), home); } catch (e) { sym = 'symlink not permitted: ' + e.code; }
  res.F3_cwdSymlinkInHomeToOutside = sym;
  // home given via a junction; cwd by real path
  fs.symlinkSync(home, path.join(top, 'homelink'), 'junction'); fs.mkdirSync(path.join(home, 'p'), { recursive: true });
  res.F3_homeViaJunction = await load(path.join(home, 'p'), path.join(top, 'homelink'));
  res.F3_homeCaseUpper = await load(path.join(home, 'p'), home.toUpperCase());
  res.F3_homeTrailingSep = await load(path.join(home, 'p'), home + path.sep);
  // REVERSE: cwd literal OUTSIDE home (a junction in a dir ABOVE home) pointing INTO home: literal ancestors are above home
  fs.symlinkSync(path.join(home, 'p'), path.join(top, 'intohome'), 'junction');
  res.F3_reverse_junctionAboveHomeIntoHome = await load(path.join(top, 'intohome'), home);
  // control: no home involved at all -> walks to top
  res.F3_control_noHome = await load(path.join(home, 'p'), path.join(S, 'otherhome'));
}
// ---- F4 ---- every key with a secret-looking / 20 KB / multi-line value
{
  const SECRET = 'sk_live_' + 'S'.repeat(30) + '_TAILSECRET_' + 'x'.repeat(20000);
  const ML = 'line1' + String.fromCharCode(10) + 'INJECTED: fake line' + String.fromCharCode(13) + String.fromCharCode(10) + 'x';
  const cases = {
    unknownKeyName: { [SECRET]: 1 },
    unknownKeyMultiline: { [ML]: 1 },
    unknownNestedDialogKey: { dialog: { mode: 'dismiss', [SECRET]: 1 } },
    unknownNestedViewportKey: { viewport: { width: 5, height: 5, [SECRET]: 1 } },
    allowedDomains: { allowedDomains: [SECRET] },
    allowedDomainsMultiline: { allowedDomains: [ML] },
    idleTimeoutMs: { idleTimeoutMs: SECRET },
    downloadDirOutside: { downloadDir: '../' + SECRET.slice(0, 200) },
    downloadDirTildeUser: { downloadDir: '~' + SECRET },
    allowedDownloadRootsTildeUser: { allowedDownloadRoots: ['~' + SECRET] },
    allowedUploadRootsTildeUser: { allowedUploadRoots: ['~' + SECRET] },
    downloadDirMultilineOutside: { downloadDir: '../' + ML },
    promptText: { dialog: { mode: 'dismiss', promptText: SECRET } },
    dialogMode: { dialog: { mode: SECRET } },
    viewportWidth: { viewport: { width: SECRET, height: 5 } },
    schema: { $schema: 5, x: SECRET },
    duplicateKeyName: null,
  };
  let i = 0;
  for (const [k, v] of Object.entries(cases)) {
    const d = path.join(S, 'f4', 'c' + i++); fs.mkdirSync(path.join(d, '.git'), { recursive: true });
    const text = v === null ? '{"' + SECRET + '":1,"' + SECRET + '":2}' : J(v);
    fs.writeFileSync(path.join(d, '.sutradhar.json'), text);
    let msgs = [];
    try { const r = await CR.loadProjectConfig({ cwd: d, discover: true, homedir: path.join(S, 'nh') }); msgs = [...r.config.warnings]; if (r.config.downloadRefusal) msgs.push(r.config.downloadRefusal); }
    catch (e) { msgs = [e.message]; }
    const all = msgs.join(' || ');
    const maxRunOfS = Math.max(0, ...(all.match(/S+/g) ?? ['']).map((m) => m.length));
    res['F4_' + k] = { echoedLen: all.length, hasTail: all.includes('TAILSECRET'), longestSRun: maxRunOfS, xRun: Math.max(0, ...(all.match(/x{10,}/g) ?? ['']).map((m) => m.length)), hasNewline: /[\r\n]/.test(all), sample: all.slice(0, 260) };
  }
}
// ---- F5 ---- root swapped for a junction after load: does the runtime check still pass?
{
  const repo = path.join(S, 'f5', 'repo'); const outside = path.join(S, 'f5', 'outside');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true }); fs.mkdirSync(path.join(repo, 'cdl'), { recursive: true }); fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(repo, '.sutradhar.json'), J({ downloadDir: './cdl' }));
  const r = await CR.loadProjectConfig({ cwd: repo, discover: true, homedir: path.join(S, 'nh') });
  const roots = CR.resolveFsRoots({ env: {}, config: CR.fsRootsConfigLayer(r.config) }).allowedDownloadRoots;
  const before = await BR.findContainingRoot(path.join(repo, 'cdl', 'f.bin'), roots);
  fs.rmSync(path.join(repo, 'cdl'), { recursive: true }); fs.symlinkSync(outside, path.join(repo, 'cdl'), 'junction');
  const after = await BR.findContainingRoot(path.join(repo, 'cdl', 'f.bin'), roots);
  res.F5 = { loadedRefusal: r.config.downloadRefusal ?? null, roots, before: before ?? null, afterSwap: after ?? null, afterSwapPasses: after !== undefined };
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
