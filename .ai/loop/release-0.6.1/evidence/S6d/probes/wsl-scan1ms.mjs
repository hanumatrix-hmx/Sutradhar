import os from 'node:os'; import path from 'node:path';
const ROOT = process.env.PROBE_ROOT ?? ''; const chk = (p) => { const r = path.resolve(p); return r.startsWith('/mnt/') || !(ROOT && (r === ROOT || r.startsWith(ROOT + '/'))) || !ROOT.startsWith('/tmp/'); };
for (const p of [os.tmpdir(), ROOT, ...(process.env.PROBE_TMPROOTS ?? '').split(':').filter(Boolean)]) if (!p || chk(p)) { console.error(`WSL GUARD: refusing ${p}`); process.exit(97); }
console.error(`[wsl-guard] root=${ROOT}`);
import { pathToFileURL } from 'node:url';
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
console.log(`== wsl-scan1ms node=${process.version} platform=${process.platform} tmpdir=${os.tmpdir()}`);
console.log('[cleanup] probe root path="' + ROOT + '"');
let nulls = 0, arrays = 0; const N = 300;
for (let i = 0; i < N; i++) { const r = await TP.scanCommandLines(1); if (r === null) nulls++; else arrays++; }
console.log(`INFO scanCommandLines(1) x${N}: null=${nulls} array=${arrays}`);
const full = await TP.scanCommandLines(8000);
console.log(`INFO scanCommandLines(8000): ${Array.isArray(full) ? 'array(' + full.length + ')' : full}`);
console.log(`${nulls === N ? 'PASS' : 'FAIL'} scan1ms: every 1 ms scan is null (fail closed) :: null=${nulls}/${N}`);
console.log(`${Array.isArray(full) ? 'PASS' : 'FAIL'} scan8000: a generous timeout completes (array)`);
process.exitCode = nulls === N && Array.isArray(full) ? 0 : 1;
