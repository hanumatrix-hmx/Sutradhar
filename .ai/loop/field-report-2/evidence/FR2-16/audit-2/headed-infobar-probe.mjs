// Launch HEADED Chrome via Sutradhar's real BrowserLauncher (DEFAULT_LAUNCH_ARGS), keep it open
// 12s so an OS-level screenshot can capture Chrome's own UI (infobars are not in page screenshots).
import { pathToFileURL } from 'node:url';
const br = await import(pathToFileURL(process.argv[2] + '/packages/browser/dist/index.js').href);
const inst = await new br.BrowserLauncher().launch({ headless: false, executablePath: process.argv[3] });
const b = inst.browser ?? inst.getBrowser?.() ?? inst;
console.log('launched headed; instance keys:', Object.keys(inst));
await new Promise((r) => setTimeout(r, 12000));
try { await (inst.close?.() ?? b.close()); } catch (e) { console.log('close err', e.message); }
console.log('closed');
