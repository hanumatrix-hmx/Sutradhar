import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const rt = await import(pathToFileURL(path.join(root, 'packages/capability-runtime/dist/index.js')).href);
const r = new rt.SutradharRuntime();
try { await r.click('no-such-session', 'text=Sign in'); console.log('NO THROW'); }
catch (e) { console.log('click(text=...) threw:', e.name); }
try { await r.click('no-such-session', '#ok'); console.log('NO THROW'); }
catch (e) { console.log('click(#ok) (negative control) threw:', e.name, '-', String(e.message).slice(0, 60)); }
