// path-normalized diff of audit-1 loader-probes.json vs audit-2 loader-probes-adapted.json
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const a = req('../../audit-1/loader-probes.json'), b = req('../loader-probes-adapted.json');
const B = String.fromCharCode(92);
const rootOf = (arr) => { const r = arr.find((x) => x.id === 'DL.ok').dl[0]; return r.slice(0, r.indexOf(B + 'r' + B + 'dl-ok')); };
const ra = rootOf(a), rb = rootOf(b);
const N = (o, root) => JSON.stringify(o).split(root.split(B).join(B + B)).join('<S>').split(root).join('<S>').split(root.split(B).join('/')).join('<S>');
const A = Object.fromEntries(a.map((r) => [r.id, r])), Bm = Object.fromEntries(b.map((r) => [r.id, r]));
const diffs = [];
for (const id of Object.keys(A)) { const x = { ...A[id] }, y = { ...Bm[id] }; for (const k of ['ms', 'msgLen']) { delete x[k]; delete y[k]; } const nx = N(x, ra), ny = N(y, rb); if (nx !== ny) diffs.push({ id, a: nx.slice(0, 500), b: ny.slice(0, 500) }); }
console.log('roots', ra, '|', rb);
console.log('normalized diffs', diffs.length);
for (const d of diffs) console.log('\n' + d.id + '\n A1 ' + d.a + '\n A2 ' + d.b);
// verdict-level diff: ok flag, and for accepted cases the loaded VALUES (paths normalized); warnings ignored here
const vd = [];
for (const id of Object.keys(A)) {
  const x = A[id], y = Bm[id];
  if (x.ok !== y.ok) { vd.push(id + ': ok ' + x.ok + ' -> ' + y.ok + (y.ok ? '' : ' | ' + N(y.msg, rb).slice(0, 160))); continue; }
  if (x.ok) { const f = (r, root) => N([r.dl, r.ul, r.values, r.stoppedAt, r.stopDir, r.path, r.origin, r.status], root); if (f(x, ra) !== f(y, rb)) vd.push(id + ': VALUES ' + f(x, ra).slice(0, 200) + ' -> ' + f(y, rb).slice(0, 200)); }
}
console.log('\n=== VERDICT-LEVEL DIFFS: ' + vd.length); for (const l of vd) console.log(l);
