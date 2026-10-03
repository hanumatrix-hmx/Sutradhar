// S3a AC checks. usage: node ac-check.mjs <statusTxt> <movedKeysTxt> <distMarkersTxt> <auditProdJson> <inventoryNewTxt> <inventoryOldTxt>
import { readFileSync } from 'node:fs';
const [status, moved, markers, auditProd, invNew] = process.argv.slice(2);
const r = (f) => readFileSync(f, 'utf-8');
const res = {}; const fail = (k, why) => { res[k] = 'FAIL: ' + why; };
const pass = (k, extra = '') => { res[k] = 'PASS' + (extra ? ' ' + extra : ''); };
// S3a-1: only the lockfile (and evidence) changed
const bad = r(status).split(/\r?\n/).filter(Boolean).filter((l) => !/pnpm-lock\.yaml$/.test(l) && !/\.ai\/loop\/release-0\.6\.1\/evidence\//.test(l));
bad.length ? fail('S3a-1', 'unexpected paths: ' + bad.join(' | ')) : pass('S3a-1');
// S3a-2: moved keys are exactly the 5 packages
const names = new Set(r(moved).split(/\r?\n/).filter(Boolean).map((l) => l.replace(/^[-+]\s+'?/, '').replace(/@[0-9].*$/, '')));
const want = ['@hono/node-server', 'fast-uri', 'hono', 'ip-address', 'qs'];
(names.size === 5 && want.every((w) => names.has(w))) ? pass('S3a-2', [...names].sort().join(',')) : fail('S3a-2', 'moved: ' + [...names].sort().join(','));
// S3a-3: prod audit 0
const a = JSON.parse(r(auditProd)); const n = Object.keys(a.advisories ?? {}).length;
(n === 0 && a.metadata?.totalDependencies > 100 && !a.error) ? pass('S3a-3', `advisories=0 totalDependencies=${a.metadata.totalDependencies}`) : fail('S3a-3', `advisories=${n} total=${a.metadata?.totalDependencies}`);
// S3a-4: exactly one fast-uri version >= 3.1.8 in the dist, new inventory reports 0
const vs = [...new Set([...r(markers).matchAll(/fast-uri@(\d+\.\d+\.\d+)/g)].map((m) => m[1]))];
const ge = (v) => { const [x, y, z] = v.split('.').map(Number); return x > 3 || (x === 3 && (y > 1 || (y === 1 && z >= 8))); };
const inv0 = /shipped advisories: 0/.test(r(invNew));
(vs.length === 1 && ge(vs[0]) && inv0) ? pass('S3a-4', `fast-uri=${vs[0]} inventory0`) : fail('S3a-4', `versions=${vs.join(',')} inv0=${inv0}`);
console.log(JSON.stringify(res, null, 1)); process.exit(Object.values(res).every((v) => v.startsWith('PASS')) ? 0 : 1);
