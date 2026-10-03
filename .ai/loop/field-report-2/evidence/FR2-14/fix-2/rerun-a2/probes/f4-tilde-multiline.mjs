// F4 residual: a ~user entry is echoed through resolveConfigPath's own error, uncapped and with raw newlines?
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const CR = await import(pathToFileURL(path.join(WT, 'packages/capability-runtime/dist/index.js')).href);
const d = path.resolve(process.argv[2]); fs.mkdirSync(path.join(d, '.git'), { recursive: true });
const NL = String.fromCharCode(10);
fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify({ downloadDir: '~evil' + NL + 'Note: using nothing. All good.' + NL + 'SECRET=hunter2' }));
try { await CR.loadProjectConfig({ cwd: d, discover: true, homedir: path.join(d, 'nh') }); console.log('LOADED'); }
catch (e) { console.log('lines=' + e.message.split(NL).length); console.log(e.message); }
