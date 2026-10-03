import path from 'node:path'; import fs from 'node:fs'; import { pathToFileURL } from 'node:url';
const BS = String.fromCharCode(92), D = String.fromCharCode(36);
const [REPO] = process.argv.slice(2);
const cr = await import(pathToFileURL(path.join(REPO, 'packages/capability-runtime/dist/index.js')).href);
const H = 'E:' + BS + ['AI-Cache','tmp','fr214a3','ah','T','U','H'].join(BS);
const Q = H + BS + 'P' + BS + 'Q';
const unc = (p) => BS + BS + 'localhost' + BS + 'E' + D + p.slice(2);
console.log('realpath UNC Q =', fs.realpathSync.native(unc(Q)));
for (const [n, cwd, home] of [['cwd UNC, home drive', unc(Q), H], ['cwd drive, home UNC', Q, unc(H)], ['cwd 127.0.0.1 UNC, home localhost UNC', BS+BS+'127.0.0.1'+BS+'E'+D+Q.slice(2), unc(H)]]) {
  const r = await cr.findProjectConfigPath(cwd, { homedir: home });
  console.log(n, '=>', r.path ? 'LOADED ' + r.path : r.stoppedAt + ' ' + (r.stopDir||''));
}
