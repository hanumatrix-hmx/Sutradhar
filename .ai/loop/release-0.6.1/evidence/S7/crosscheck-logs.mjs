// Independent re-derivation from the RAW on-disk CLI logs (not from the harness's in-memory checks):
// for each nav/close pair, the dir the CLI says it created must be the dir the CLI says it removed, and the close
// log must show phase kill -> state-cleared -> phase cleanup in that order. Usage: node crosscheck-logs.mjs <logsDir>
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase();
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.stderr'));
const pathsOf = (txt, ev) => txt.split('\n').filter((l) => l.startsWith('[cleanup] ' + ev + ' path=')).map((l) => norm(l.split('path="')[1].split('"')[0]));
let rows = 0, bad = 0;
for (const tag of ['L1', 'L1s', 'L2', 'L7']) {
  // file names are <tag>-nav<i>-<callNo>.stderr (L7: <tag>-nav-<callNo>) and the matching close is call number callNo+1
  for (const nf of files.filter((f) => f.startsWith(tag + '-nav'))) {
    const parts = nf.slice(0, -'.stderr'.length).split('-'); // [tag, nav<i>, n]
    const navPart = parts[1].slice(3); const n = Number(parts[2]);
    const cf = tag + '-close' + navPart + '-' + (n + 1) + '.stderr';
    if (!files.includes(cf)) { console.log('BAD  no close log for', nf); bad++; rows++; continue; }
    const nt = fs.readFileSync(path.join(dir, nf), 'utf-8'), ct = fs.readFileSync(path.join(dir, cf), 'utf-8');
    const created = pathsOf(nt, 'created'), removedByClose = pathsOf(ct, 'removed');
    const o = [ct.indexOf('[cleanup] phase kill'), ct.indexOf('[cleanup] state-cleared'), ct.indexOf('[cleanup] phase cleanup')];
    const order = o[0] >= 0 && o[1] > o[0] && o[2] > o[1];
    const same = created.length === 1 && removedByClose.includes(created[0]);
    const mutant = tag === 'L7';
    const ok = mutant ? created.length === 1 && removedByClose.length === 0 && o[2] < 0 : same && order;
    rows++; if (!ok) bad++;
    console.log((ok ? 'OK   ' : 'BAD  ') + nf + ' -> ' + cf + ': created=' + created.length + ' removed-by-close-same-path=' + same + ' order(kill<cleared<cleanup)=' + order + (mutant ? ' [L7 mutant: expected NOT removed, no cleanup phase]' : ''));
  }
}
console.log('pairs=' + rows + ' bad=' + bad); process.exit(bad || rows === 0 ? 1 : 0);
