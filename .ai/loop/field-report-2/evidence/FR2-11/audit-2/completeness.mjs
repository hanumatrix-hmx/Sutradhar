// AUDIT-1 completeness: every MCP action verb gives exactly N new session-history entries; verification deep-equal to the result verification.
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os'; import http from 'node:http';
import { here, mcpClient, delay } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const serverPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repo, 'packages/mcp-server/dist/cli.js');
const PAGE = '<!doctype html><title>C</title><style>#cv{width:200px;height:100px;display:block}</style>' +
  '<input id="t" aria-label="T"><input id="u" aria-label="U"><select id="s" multiple><option value="a">A</option><option value="b">B</option></select>' +
  '<button id="b" onclick="document.getElementById(&quot;o&quot;).textContent=&quot;done&quot;">Go</button><div id="o"></div><div role="button" aria-label="Role">r</div>' +
  '<div id="src" draggable="true">src</div><div id="dst">dst</div><canvas id="cv"></canvas><input id="f" type="file"><button id="trig" onclick="document.getElementById(&quot;f&quot;).click()">trig</button>' +
  '<a id="dl" href="/dl">dl</a><button id="al" onclick="alert(1)">al</button><a id="l2" href="/p2">p2</a><div style="height:3000px"></div>';
const srv = http.createServer((q, r) => { const p = q.url.split('?')[0]; if (p === '/dl') return r.writeHead(200, { 'content-disposition': 'attachment; filename="c.bin"' }).end('zz'); r.writeHead(200, { 'content-type': 'text/html' }).end(PAGE.replace('<title>C', '<title>C' + p)); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const O = 'http://127.0.0.1:' + srv.address().port;
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-audit-comp-'));
const up = path.join(scratch, 'u.txt'); await fs.writeFile(up, 'u');
const c = mcpClient(serverPath, { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: scratch });
const rows = [];
const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true })).json.sessionId;
  const hist = async () => (await c.tool('browser.get_action_history', { sessionId: sid, scope: 'session' })).json.entries;
  let prev = (await hist()).length;
  const S = async (label, name, args, expectN = 1) => {
    await delay(1100);
    const r = await c.tool(name, { sessionId: sid, ...args }, 60000);
    const h = await hist();
    const added = h.slice(prev); prev = h.length;
    const e = added.at(-1);
    const resV = r.json?.verification;
    const row = { label, tool: name, isError: r.isError, added: added.length, types: added.map((x) => x.actionType + (x.success ? '' : '(FAIL)')), expectN, countOk: added.length === expectN,
      verifInResult: !!resV, verifInEntry: !!e?.verification, verifEqual: resV ? deep(resV, e?.verification) : !e?.verification, tier: e?.verification?.evidence?.tier, errText: r.isError ? r.text.slice(0, 120) : undefined };
    rows.push(row);
    console.log((row.countOk ? 'OK  ' : 'BAD ') + label.padEnd(28) + ' added=' + added.length + '/' + expectN + ' ' + row.types.join(',') + ' verifEq=' + row.verifEqual + ' tier=' + (row.tier ?? '-') + (r.isError ? ' isError' : ''));
    return r;
  };
  await S('navigate', 'browser.navigate', { url: O + '/p' });
  await S('navigate+settle', 'browser.navigate', { url: O + '/p?x=1', settle: 'network' });
  await S('eval', 'browser.eval', { code: '1+1' });
  await S('eval throws', 'browser.eval', { code: 'throw new Error("x")' });
  await S('click', 'browser.click', { target: '#b' });
  await S('click+settle', 'browser.click', { target: '#b', settle: 'dom' });
  await S('click fails (retries)', 'browser.click', { target: '#missing' });
  await S('click rejected pre-dispatch', 'browser.click', { target: 'text=Go' });
  await S('type', 'browser.type', { target: '#t', value: 'hello' });
  await S('press_key', 'browser.press_key', { key: 'Enter' });
  await S('focus', 'browser.focus', { target: '#u' });
  await S('scroll', 'browser.scroll', { direction: 'down', amount: 100 });
  await S('hover', 'browser.hover', { target: '#b' });
  await S('select_option', 'browser.select_option', { target: '#s', value: 'a' });
  await S('select_options', 'browser.select_options', { target: '#s', values: ['a', 'b'] });
  await S('wait_for_selector', 'browser.wait_for_selector', { target: '#b' });
  await S('wait_for met', 'browser.wait_for', { text: 'done', timeoutMs: 2000 });
  await S('wait_for timeout', 'browser.wait_for', { text: 'never-there', timeoutMs: 0 });
  await S('click_by_text', 'browser.click_by_text', { text: 'Go' });
  await S('click_by_role', 'browser.click_by_role', { role: 'button', name: 'Role' });
  await S('type_by_label', 'browser.type_by_label', { label: 'U', value: 'x1' });
  await S('fill_form 2 fields', 'browser.fill_form', { fields: { '#t': 'a1', '#u': 'b1' } }, 2);
  await S('upload_file', 'browser.upload_file', { target: '#f', filePath: up });
  await S('upload_file_via_trigger', 'browser.upload_file_via_trigger', { target: '#trig', filePath: up });
  await S('right_click', 'browser.right_click', { target: '#b' });
  await S('drag_and_drop', 'browser.drag_and_drop', { source: '#src', target: '#dst' });
  await S('touch_tap', 'browser.touch_tap', { target: '#b' });
  await S('click_at_point', 'browser.click_at_point', { x: 50, y: 50 });
  await S('drag_at_points', 'browser.drag_at_points', { fromX: 10, fromY: 10, toX: 60, toY: 60 });
  await S('set_clipboard', 'browser.set_clipboard', { text: 'abc' });
  await S('download_file', 'browser.download_file', { target: '#dl' });
  await S('click -> nav link', 'browser.click', { target: '#l2' });
  await S('go_back', 'browser.go_back', {});
  await S('go_forward', 'browser.go_forward', {});
  await S('reload', 'browser.reload', {});
  await S('click opens alert', 'browser.click', { target: '#al' });
  await S('handle_dialog (not by spec)', 'browser.handle_dialog', { action: 'accept' }, 0);
  await S('screenshot (read)', 'browser.screenshot', {}, 0);
  await S('snapshot (read)', 'browser.snapshot', {}, 0);
  await S('new_tab (G-C)', 'browser.new_tab', { url: O + '/p' }, 0);
  await S('set_cookie (G-C)', 'browser.set_cookie', { name: 'a', value: 'b' }, 0);
  await S('audit (navigates)', 'browser.audit', { url: O + '/p' }, 1);
  await S('navigate bad url', 'browser.navigate', { url: 'http://127.0.0.1:1/' });
  await delay(1100);
  const before = prev;
  await Promise.all([c.tool('browser.click', { sessionId: sid, target: '#b' }), c.tool('browser.click', { sessionId: sid, target: '#b' })]);
  const h = await hist(); const dup = h.slice(before); prev = h.length;
  rows.push({ label: 'duplicate pair', added: dup.length, types: dup.map((x) => x.actionType + (x.success ? '' : '(FAIL)')), expectN: 2, countOk: dup.length === 2, dupErr: dup.map((x) => (x.error ?? '').slice(0, 60)) });
  console.log('duplicate pair', dup.length, JSON.stringify(dup.map((x) => x.success + ':' + (x.error ?? '').slice(0, 50))));
  const seqs = h.map((x) => x.seq); console.log('seq contiguous', seqs.every((x, i) => i === 0 || x === seqs[i - 1] + 1));
  await c.tool('browser.shutdown_all', {});
} finally {
  await fs.writeFile(path.join(here, 'completeness.json'), JSON.stringify(rows, null, 1));
  c.kill(); srv.close(); await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}
