// GIT~1 on C: (8.3 names usually enabled on the system drive). Scratch dir: argv[2] (on C:), deleted by caller.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const CR = await import(pathToFileURL(path.join(WT, 'packages/capability-runtime/dist/index.js')).href);
const d = path.resolve(process.argv[2]); fs.mkdirSync(path.join(d, '.git', 'hooks'), { recursive: true });
const alias = fs.existsSync(path.join(d, 'GIT~1')) ? fs.realpathSync.native(path.join(d, 'GIT~1')) : null;
const out = { aliasResolvesTo: alias };
for (const v of ['GIT~1/hooks', 'GIT~1']) {
  fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify({ downloadDir: v }));
  const r = await CR.loadProjectConfig({ cwd: d, discover: true, homedir: path.join(d, 'nohome') });
  let comp; try { comp = CR.resolveFsRoots({ env: {}, config: CR.fsRootsConfigLayer(r.config) }).allowedDownloadRoots; } catch (e) { comp = 'REFUSED ' + e.message.slice(0, 120); }
  out[v] = comp;
}
console.log(JSON.stringify(out));
