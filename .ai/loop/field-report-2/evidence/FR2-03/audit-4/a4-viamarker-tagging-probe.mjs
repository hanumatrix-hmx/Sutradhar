// audit-4: probes the viaMarker TAGGING logic (scanStateFiles) directly against the real built module + real files:
//  (a) can a marker-sourced path be mis-tagged viaMarker:false? try aliases of a TRUSTED path (case, slashes, trailing
//      sep, 8.3 short name, \\?\ prefix, `..` segments, a junction into stateRoot) and of a FOREIGN path
//  (c) two markers (different carriers) naming the same foreign file, in different textual forms -> tagged consistently?
//  (e) GAP-188 errno coverage: a regular FILE directly in stateRoot (stat of '<file>/state.json'), and a state.json that
//      is a directory (EISDIR, fix-3's own case) -- which errno does Windows actually return, and what's the outcome?
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const { scanStateFiles } = await import(path.join(repo, 'packages/cli/dist/sessions.js').replace(/\\/g, '/').replace(/^/, 'file:///'));
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a4-tag-')); const SR = path.join(R, 'sr'); mkdirSync(SR);
const good = JSON.stringify({ sessionId: 's', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/x', profileDir: path.join(R, 'p'), profileDirOwned: true });
mkdirSync(path.join(SR, 'trusted1')); const trusted = path.join(SR, 'trusted1', 'state.json'); writeFileSync(trusted, good);
mkdirSync(path.join(R, 'foreign')); const foreign = path.join(R, 'foreign', 'state.json'); writeFileSync(foreign, good);
let short = null; try { short = execFileSync('cmd', ['/c', `for %I in ("${trusted}") do @echo %~sI`], { encoding: 'utf8' }).trim(); } catch {}
let junction = null; try { execFileSync('cmd', ['/c', 'mklink', '/J', path.join(R, 'jn'), path.join(SR, 'trusted1')]); junction = path.join(R, 'jn', 'state.json'); } catch (e) { junction = 'mklink-failed: ' + e.message; }
const aliases = {
  upper: trusted.toUpperCase(), fwdSlashes: trusted.replace(/\\/g, '/'), dotdot: path.join(SR, 'trusted1', '..', 'trusted1', 'state.json').replace('trusted1\\state.json', 'x\\..\\trusted1\\state.json'),
  shortName: short, extendedPrefix: '\\\\?\\' + trusted, junctionIntoStateRoot: junction,
};
const out = { R, trusted, foreign, aliasTagging: {}, foreignDup: null, errno: {} };
for (const [k, a] of Object.entries(aliases)) {
  if (!a || a.startsWith('mklink-failed')) { out.aliasTagging[k] = { alias: a, skipped: true }; continue; }
  const scanned = await scanStateFiles(SR, path.join(R, 'none.json'), [], [a]);
  out.aliasTagging[k] = { alias: a, entries: scanned.map((s) => ({ stateFile: s.stateFile, viaMarker: s.viaMarker, parseOk: s.parseOk })) };
}
// (c) same foreign file named by two different carriers in two textual forms
const scannedDup = await scanStateFiles(SR, path.join(R, 'none.json'), [], [foreign, foreign.toUpperCase(), foreign.replace(/\\/g, '/')]);
out.foreignDup = scannedDup.map((s) => ({ stateFile: s.stateFile, viaMarker: s.viaMarker }));
// (e) errno coverage
writeFileSync(path.join(SR, 'stray-regular-file.txt'), 'not a session dir');
try { await stat(path.join(SR, 'stray-regular-file.txt', 'state.json')); out.errno.fileAsParent = 'stat-succeeded?'; } catch (e) { out.errno.fileAsParent = e.code; }
mkdirSync(path.join(SR, 'isdir', 'state.json'), { recursive: true });
try { await stat(path.join(SR, 'isdir', 'state.json')); out.errno.stateJsonIsDir_stat = 'ok'; } catch (e) { out.errno.stateJsonIsDir_stat = e.code; }
const scannedE = await scanStateFiles(SR, path.join(R, 'none.json'), [], []);
out.errno.scan = scannedE.map((s) => ({ stateFile: path.relative(SR, s.stateFile), parseOk: s.parseOk, viaMarker: s.viaMarker }));
writeFileSync(path.join(here, 'a4-viamarker-tagging-probe.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 2));
try { rmSync(path.join(R, 'jn')); } catch {}
