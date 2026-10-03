// AUDIT-2 SDK child (runs with cwd = the case's directory). argv: <sdk index.js> <spec json file>
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [, , SDK, SPECF] = process.argv;
const spec = JSON.parse(fs.readFileSync(SPECF, 'utf8'));
const { launch } = await import(pathToFileURL(SDK).href);
const out = { warns: [], steps: {} };
const ow = console.warn; console.warn = (...a) => out.warns.push(a.join(' ').slice(0, 400));
const opts = spec.opts; if (spec.nullKeys) for (const k of spec.nullKeys) opts[k] = null;
let b;
try {
  b = await launch(opts);
  const page = (await b.pages())[0] ?? (await b.newPage());
  for (const [k, u] of Object.entries(spec.navs || {})) { try { await page.goto(u); out.steps['nav:' + k] = 'ok'; } catch (e) { out.steps['nav:' + k] = 'ERR ' + String(e.message).slice(0, 120); } }
  if (spec.main) {
    await page.goto(spec.main).catch((e) => (out.steps.mainErr = String(e.message).slice(0, 120)));
    if (spec.clickPrompt) { try { await Promise.race([page.click('#pq'), new Promise((_, r) => setTimeout(() => r(new Error('click>30s')), 30000))]); out.steps.click = 'ok'; } catch (e) { out.steps.click = 'ERR ' + String(e.message).slice(0, 100); } }
    if (spec.download) { try { const d = await page.download('#dl'); out.steps.download = JSON.stringify(d).slice(0, 300); } catch (e) { out.steps.download = 'ERR ' + String(e.message).slice(0, 200); } }
    for (const f of spec.uploads || []) { await new Promise((r) => setTimeout(r, 1300)); try { const r = await page.uploadFile('#up', f); out.steps['up:' + f.slice(-5)] = r && r.success === false ? 'REFUSED' : 'ok'; } catch (e) { out.steps['up:' + f.slice(-5)] = 'ERR ' + String(e.message).slice(0, 100); } }
  }
} catch (e) { out.error = (e.name || '') + ': ' + String(e.message).slice(0, 600); }
finally { try { await b?.close(); } catch {} }
console.warn = ow;
console.log('RESULT ' + JSON.stringify(out));
process.exit(0);
