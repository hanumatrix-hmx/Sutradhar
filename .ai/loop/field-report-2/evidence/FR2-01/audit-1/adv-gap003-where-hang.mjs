import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const FIX = pathToFileURL(path.join(here, 'adv-singleframe.html')).href;
const rt = new SutradharRuntime();
const { sessionId, activeTabId } = await rt.launch({ launch: { headless: true } });
const T0 = Date.now(); const log = (m) => console.log(`+${Date.now() - T0}ms ${m}`);
try {
  await rt.navigate(sessionId, FIX + '?x=1', activeTabId);
  const tabB = await rt.createTab(sessionId, 'data:text/html,B');
  const session = rt.sessionManager.getSession(sessionId);
  const tab = session.getTab(activeTabId);
  const page = tab.page;
  for (const m of ['screenshot', '$$eval', 'evaluate']) {
    const orig = page[m].bind(page); page[m] = async (...a) => { log(`page.${m} start`); try { return await orig(...a); } finally { log(`page.${m} end`); } };
  }
  const eng = rt.actionEngine; const ov = eng.verifier.verifyAction.bind(eng.verifier);
  eng.verifier.verifyAction = async (...a) => { log('verify start'); try { return await ov(...a); } finally { log('verify end'); } };
  const mf = page.mainFrame(); for (const m of ['waitForSelector', '$$eval', '$']) { const o = mf[m].bind(mf); mf[m] = async (...a) => { log(`frame.${m} start ${JSON.stringify(a[1] ?? '').slice(0,60)}`); try { return await o(...a); } catch (e) { log(`frame.${m} threw ${e.message.slice(0,80)}`); throw e; } finally { log(`frame.${m} end`); } }; }
  log('visibility=' + await page.evaluate('document.visibilityState'));
  await page.evaluate(`setTimeout(() => window.__fx.reveal('toast'), 6000)`);
  log('wait start');
  const r = await rt.waitForSelector(sessionId, '#toast', 2000, activeTabId);
  log('wait end success=' + r.success + ' err=' + r.error);
} finally { await rt.shutdown(sessionId).catch(() => {}); log('shutdown'); }
process.exit(0);
