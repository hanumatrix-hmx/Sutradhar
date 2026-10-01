// AUDIT-1 privacy canary probe, MCP surface (real Chrome). Usage: node privacy-mcp.mjs <mcp-server-js> <label>
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { here, startServer, mcpClient, canariesIn, delay } from './lib.mjs';
const [serverPath, label = 'mcp'] = process.argv.slice(2);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-audit-'));
const upDir = path.join(scratch, 'CNRYupdir'); await fs.mkdir(upDir, { recursive: true });
const upFile = path.join(upDir, 'CNRYupname.txt'); await fs.writeFile(upFile, 'hello');
const dlRoot = path.join(scratch, 'CNRYdldir'); await fs.mkdir(dlRoot, { recursive: true });
const srv = await startServer();
const O = srv.origin;
const c = mcpClient(serverPath, { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: dlRoot });
const steps = [];
const step = async (name, args, t) => { const r = await c.tool(name, args, t); steps.push({ name, isError: r.isError, text: r.text.slice(0, 400) }); return r; };
try {
  await c.init();
  const L = await step('browser.launch', { headless: true });
  const sid = L.json.sessionId;
  const base = { sessionId: sid };
  await step('browser.navigate', { ...base, url: `http://aud:CNRYuserpass@127.0.0.1:${srv.port}/p?token=CNRYquery&x=1#CNRYfrag`, expect: { url: '/p' } });
  await step('browser.set_cookie', { ...base, name: 'c', value: 'CNRYcookie' });
  await step('browser.set_local_storage_item', { ...base, key: 'k', value: 'CNRYlsval' });
  await step('browser.set_local_storage_item', { ...base, key: 'k2', value: 'CNRYlsthrown' });
  await step('browser.set_session_storage_item', { ...base, key: 's', value: 'CNRYssval' });
  await step('browser.type', { ...base, target: '#pw', value: 'CNRYtype' });
  await step('browser.type', { ...base, target: '#mangle', value: 'CNRYmangle' });
  await step('browser.fill_form', { ...base, fields: { '#a': 'CNRYfillA', '#b': 'CNRYfillB' } });
  await step('browser.select_option', { ...base, target: '#sel', value: 'CNRYselval' });
  await step('browser.select_option', { ...base, target: '#sel', value: 'CNRYselmissing' });
  await step('browser.set_clipboard', { ...base, text: 'CNRYclip' });
  await step('browser.get_clipboard', { ...base });
  await step('browser.eval', { ...base, code: "localStorage.getItem('k') + '|' + sessionStorage.getItem('s') + '|' + document.cookie + '|' + document.getElementById('pw').value" });
  await step('browser.eval', { ...base, code: "throw new Error('E-' + localStorage.getItem('k2'))" });
  await step('browser.eval', { ...base, code: "/* CNRYevalcode */ fetch('http://127.0.0.1:1/x?token=CNRYevalurl').catch(()=>0), 1" });
  await step('browser.click', { ...base, target: '#btn', expect: { text: 'CNRYexptext' } });
  await step('browser.wait_for', { ...base, text: 'CNRYwaittext', timeoutMs: 0 });
  await step('browser.upload_file', { ...base, target: '#file', filePath: upFile });
  await delay(1200); await step('browser.upload_file', { ...base, target: '#file', filePath: path.join(scratch, 'CNRYupmissdir', 'x.txt') });
  await step('browser.type', { ...base, target: '#nosuch', value: 'CNRYtypemiss' });
  await step('browser.type_by_label', { ...base, label: 'A', value: 'CNRYbylabel' });
  await step('browser.select_options', { ...base, target: '#sel', values: ['CNRYselmulti'] });
  await step('browser.upload_file_via_trigger', { ...base, target: '#trig', filePath: upFile });
  await step('browser.download_file', { ...base, target: '#dl' });
  await step('browser.route', { ...base, pattern: 'CNRYroutepat', action: 'mock', mockBody: 'CNRYmockbody' });
  await step('browser.click', { ...base, target: '#prompt' });
  await delay(300);
  await step('browser.handle_dialog', { ...base, action: 'accept', promptText: 'CNRYprompt' });
  await step('browser.click', { ...base, target: '#p2' }); // navigates to /p2?token=CNRYlinkq (url field)
  await step('browser.navigate', { ...base, url: `${O}/p?token=CNRYq2#CNRYfrag2` });
  await step('browser.go_back', { ...base });
  await step('browser.go_forward', { ...base });
  await step('browser.reload', { ...base });
  await step('browser.navigate', { ...base, url: 'http://127.0.0.1:1/x?token=CNRYnavfail' });
  await step('browser.navigate', { ...base, url: 'data:text/html,<title>CNRYdataurl</title>' });
  const nt = await step('browser.new_tab', { ...base, url: `${O}/p?token=CNRYnewtab` });
  const t2 = nt.json?.tabId ?? nt.json?.id;
  if (t2) { await step('browser.type', { ...base, tabId: t2, target: '#pw', value: 'CNRYtab2type' }); await step('browser.close_tab', { ...base, tabId: t2 }); }
  const tab = await step('browser.get_action_history', { ...base });
  const ses = await step('browser.get_action_history', { ...base, scope: 'session' });
  const MUST_NOT = ['CNRYuserpass', 'CNRYquery', 'CNRYfrag', 'CNRYcookie', 'CNRYlsval', 'CNRYssval', 'CNRYtype', 'CNRYmangle', 'CNRYMANGLE', 'CNRYfillA', 'CNRYfillB', 'CNRYselval', 'CNRYsellabel', 'CNRYselmissing', 'CNRYclip', 'CNRYevalurl', 'CNRYupdir', 'CNRYupmissdir', 'CNRYdldir', 'CNRYroutepat', 'CNRYmockbody', 'CNRYprompt', 'CNRYlinkq', 'CNRYq2', 'CNRYfrag2', 'CNRYnavfail', 'CNRYdataurl', 'CNRYnewtab', 'CNRYtab2type', 'CNRYtypemiss', 'CNRYbylabel', 'CNRYselmulti'];
  const DOCUMENTED = ['CNRYevalcode', 'CNRYexptext', 'CNRYwaittext', 'CNRYupname', 'CNRYlsthrown', 'CNRYdlname'];
  const found = { tab: canariesIn(tab.text), session: canariesIn(ses.text) };
  const all = [...new Set([...found.tab, ...found.session])];
  const matrix = Object.fromEntries([...MUST_NOT, ...DOCUMENTED].map((k) => [k, { cls: MUST_NOT.includes(k) ? 'MUST-NOT' : 'DOCUMENTED', tab: found.tab.some((f) => f.startsWith(k)), session: found.session.some((f) => f.startsWith(k)) }]));
  const unexpected = all.filter((f) => !DOCUMENTED.some((d) => f.startsWith(d)));
  const summary = { label, sessionEntries: ses.json?.entries?.length, tabEntries: tab.json?.entries?.length, actionTypes: ses.json?.entries?.map((e) => e.actionType), found, unexpectedLeaks: unexpected, matrix };
  await fs.writeFile(path.join(here, `privacy-${label}.json`), JSON.stringify({ summary, steps, sessionHistory: ses.json, tabHistory: tab.json }, null, 1));
  console.log(JSON.stringify(summary.unexpectedLeaks), JSON.stringify(found));
  console.log('actionTypes', JSON.stringify(summary.actionTypes));
  // self-test: the probe CAN see a leak (the MCP action responses themselves carry the typed-value canaries? check raw transcript)
  console.log('selftest canaries in raw transcript:', canariesIn(c.raw.map((r) => JSON.stringify(r.args)).join('')).length);
  await step('browser.shutdown_all', {});
} finally {
  c.kill(); await srv.close();
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}
