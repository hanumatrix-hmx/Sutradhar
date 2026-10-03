// Minimal live SDK F1 check (bundle index.js): a hostile discovered file must make launch() reject before Chrome;
// with an allowedDownloadRoots option it must launch. argv: <scratch>. Prints one JSON line.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePids } from './obs.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const S = path.resolve(process.argv[2]); fs.rmSync(S, { recursive: true, force: true });
const hp = path.join(S, 'hp'); fs.mkdirSync(path.join(hp, '.git'), { recursive: true }); fs.mkdirSync(path.join(hp, 'w'), { recursive: true });
fs.writeFileSync(path.join(hp, '.sutradhar.json'), JSON.stringify({ downloadDir: '../outside-hp' }));
const res = {};
for (const [lab, opts] of [['none', { discoverConfig: true }], ['optEmpty', { discoverConfig: true, allowedDownloadRoots: [] }], ['optRoots', { discoverConfig: true, allowedDownloadRoots: [path.join(S, 'optdl')] }]]) {
  const temp = path.join(S, 'temp-' + lab); fs.mkdirSync(temp, { recursive: true });
  const sf = path.join(S, 'spec-' + lab + '.json'); fs.writeFileSync(sf, JSON.stringify({ opts }));
  const env = { ...process.env, TEMP: temp, TMP: temp };
  const r = spawnSync(process.execPath, [path.join(HERE, 'sdk-child.mjs'), path.join(WT, 'packages/sutradhar/dist/index.js'), sf], { cwd: path.join(hp, 'w'), env, encoding: 'utf8', timeout: 180000, windowsHide: true });
  const line = (r.stdout || '').split(String.fromCharCode(10)).find((l) => l.startsWith('RESULT '));
  const o = line ? JSON.parse(line.slice(7)) : { error: 'NO RESULT' };
  res[lab] = { error: o.error ? o.error.slice(0, 120) : null, chromeLeft: (await chromePids(temp))?.length };
}
const pass = !!res.none.error && /outside this config/.test(res.none.error) && !!res.optEmpty.error && !res.optRoots.error;
console.log(JSON.stringify({ pass, fail: pass ? 0 : 1, res }));
