// audit-5: clearStateFileIfUnchanged (the ONLY clearState executor) does
//   rm(state.json) -> readdir(dir) -> if empty: rm(dir, {recursive:true, force:true})
// The emptiness check and the recursive delete are two separate steps. Anything written into that
// session dir between them (a new session's writeState for the same cwd-hash, FR2-11's
// history.jsonl) is silently deleted by the RECURSIVE rm -- the spec's own promise is "removes the
// dir ONLY if it's now empty; a sibling history.jsonl must survive".
// Method: a separate writer process repeatedly creates a file in the session dir and checks, after a
// short pause, that it still exists (only the writer itself ever deletes its own files, so a
// vanished file can only have been removed by clearStateFileIfUnchanged's recursive rm). The main
// process calls the REAL clearStateFileIfUnchanged against a stale state in the same dir, N times.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const R = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a5-clearrace-')));
const D = path.join(R, 'sr', 'abcdef0123456789'); mkdirSync(D, { recursive: true });
const SF = path.join(D, 'state.json'); const STOP = path.join(R, 'stop'); const OUT = path.join(R, 'writer.json');
process.env.SUTRADHAR_CLI_STATE_ROOT = path.join(R, 'other-sr'); delete process.env.SUTRADHAR_CLI_STATE_DIR;
const st = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/state.js')).href);
const writerSrc = `
const fs=require('fs'),path=require('path');const D=${JSON.stringify(D)},STOP=${JSON.stringify(STOP)},OUT=${JSON.stringify(OUT)};
let k=0,vanished=0,written=0;const spin=(n)=>{const e=process.hrtime.bigint()+BigInt(n);while(process.hrtime.bigint()<e){}};
while(!fs.existsSync(STOP)){k++;const f=path.join(D,'history.jsonl.'+k);
 try{fs.mkdirSync(D,{recursive:true});fs.writeFileSync(f,'{"cmd":"nav"}\\n');written++;}catch{continue}
 spin(200000);
 if(!fs.existsSync(f))vanished++;else{try{fs.unlinkSync(f)}catch{}}
 spin(50000);}
fs.writeFileSync(OUT,JSON.stringify({written,vanished}));`;
const w = spawn(process.execPath, ['-e', writerSrc], { stdio: 'ignore', windowsHide: true });
const res = { R, D, N: 0, cleared: 0, changed: 0, absent: 0, errors: 0 };
const expect = { sessionId: 'stale-sess', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/stale' };
const t0 = Date.now();
while (Date.now() - t0 < 60_000) {
  res.N++;
  try { mkdirSync(D, { recursive: true }); writeFileSync(SF, JSON.stringify(expect)); } catch { continue; }
  try { const r = await st.clearStateFileIfUnchanged(SF, expect); res[r === 'cleared' ? 'cleared' : r === 'changed-concurrently' ? 'changed' : 'absent']++; } catch { res.errors++; }
}
writeFileSync(STOP, '');
await new Promise((r) => w.on('exit', r));
try { res.writer = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) { res.writerErr = String(e); }
res.verdict = res.writer?.vanished > 0
  ? `${res.writer.vanished} file(s) written into the session dir AFTER the emptiness check were deleted by the recursive rm`
  : 'no concurrently-written file was lost in this run';
try { rmSync(R, { recursive: true, force: true }); } catch (e) { res.cleanupError = String(e); }
res.cleanup = { rootExists: existsSync(R) };
writeFileSync(path.join(here, 'a5-clearstate-race.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
