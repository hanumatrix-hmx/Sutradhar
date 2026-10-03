import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const rows = fs.readFileSync(path.join(HERE, '..', 'mutants.jsonl'), 'utf8').trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
for (const o of rows) {
  const unitFails = o.unit ? Object.entries(o.unit).filter(([, v]) => v.code !== 0).map(([k, v]) => k + '(' + v.tests + ')').join(', ') || 'all pass' : 'n/a';
  console.log([o.id, 'occ=' + o.occurrences, 'build=' + (o.build ? o.build.pkg + '/' + o.build.bundle : 'n/a'), 'unit: ' + unitFails, 'f1attack: ' + (o.f1attack ? o.f1attack.fail + ' fail' : 'n/a'), 'liveCli: ' + (o.liveCliF1 ? o.liveCliF1.fail + ' fail ' + JSON.stringify(o.liveCliF1.fails) : '-'), 'liveSdk: ' + (o.liveSdkF1 ? o.liveSdkF1.fail + ' fail' : '-'), 'f8kill: ' + (o.f8kill ? JSON.stringify(o.f8kill) : '-'), 'restored=' + o.restored, 'rebuild=' + (o.rebuild ? o.rebuild.pkg + '/' + o.rebuild.bundle : '?'), 'CAUGHT=' + JSON.stringify(o.caught), o.error ? 'ERR ' + o.error : ''].join(' | '));
}
