export default async function ({ srv, browser, m, W, nav, C, label, rec, delay, pageFor }) {
  await C('A9-nav-mid-wait-textGone', async (id) => {
    const res = [];
    for (let i = 0; i < 5; i++) {
      await nav(`/nav-a?d=800&slow=1500&i=${i}`);
      const r = await W({ textGone: 'OldMarker', timeoutMs: 6000 });
      res.push({ success: r.json?.success, ms: r.ms, polls: r.json?.output?.polls, url: r.json?.currentUrl?.replace(srv.origin, ''), presentAtStart: r.json?.output?.presentAtStart });
    }
    const falseMet = res.filter((x) => x.success).length;
    rec(`${label}:${id}`, falseMet === 0, { falseMet, res, note: 'OldMarker is in page A and in page B HTML; any met = a transient navigation state read as gone' });
  });
  await C('A9b-nav-and', async (id) => {
    await nav('/nav-a?d=500&slow=300&and=1');
    const r = await W({ url: 'nav-b', text: 'page b', timeoutMs: 8000 });
    rec(`${label}:${id}`, r.json?.success === true && r.json.output.polls >= 2, { ms: r.ms, polls: r.json?.output?.polls });
  });
  await C('A10-shadow', async (id) => {
    await nav('/shadow-late');
    const a = await W({ text: 'ShadowOpenWord', timeoutMs: 5000 });
    const b = await W({ text: 'ShadowClosedWord', timeoutMs: 1500 });
    rec(`${label}:${id}`, a.json?.success === true, { open: [a.json?.success, a.ms], closed: [b.json?.success, b.ms] });
  });
  await C('A11-iframes', async (id) => {
    await nav('/iframe-late');
    const a = await W({ text: 'SameOriginLate', timeoutMs: 6000 });
    const b = await W({ text: 'CrossOriginLate', timeoutMs: 6000 });
    rec(`${label}:${id}`, a.json?.success === true && b.json?.success === true, { same: [a.json?.success, a.ms], cross: [b.json?.success, b.ms, b.json?.error?.slice(0, 160)] });
  });
  await C('A12-js-url', async (id) => {
    const pg = await nav('/js');
    const a = await W({ js: 'window.__v === 1', timeoutMs: 5000 });
    const at = await pg.evaluate(() => window.__at);
    const pg2 = await nav('/push?x=1');
    const b = await W({ url: 'stage=pushed', timeoutMs: 5000 });
    const at2 = await pg2.evaluate(() => window.__at);
    rec(`${label}:${id}`, a.json?.success === true && a.recvAt >= at && a.recvAt - at <= 700 && b.json?.success === true && b.recvAt >= at2 && b.recvAt - at2 <= 700, { jsLat: a.recvAt - at, urlLat: b.recvAt - at2 });
  });
  await C('A13-gap329-331-parity', async (id) => {
    await nav('/svg');
    const w = {}; const x = {};
    for (const t of ['SvgDefsWord', 'AreaWord', 'HiddenWord', 'ValueWord']) {
      const r = await W({ text: t, timeoutMs: 0 });
      w[t] = r.json?.success;
      const e = await m.tool('browser.navigate', { url: srv.origin + '/svg?e=' + t, expect: { text: t } });
      x[t] = e.json?.verification?.verified;
    }
    const parity = Object.keys(w).every((k) => w[k] === x[k]);
    rec(`${label}:${id}`, parity && w.HiddenWord === false && w.ValueWord === false, { waitFor: w, expectText: x, parity });
  });
  await C('A14-js-errors', async (id) => {
    await nav('/blank');
    const a = await W({ js: 'window.__nope.ready', timeoutMs: 8000 });
    const b = await W({ js: 'new Promise(() => {})', timeoutMs: 2500 });
    const c = await W({ js: 'window.__x ===', timeoutMs: 5000 });
    rec(`${label}:${id}`, a.json?.success === false && a.ms < 1500 && /js condition threw/.test(a.json?.error) && b.json?.success === false && b.ms <= 2500 + 1500 + 700 && /did not settle/.test(b.json?.error) && c.json?.success === false && c.ms < 1500, { throw: [a.ms, a.json?.error?.slice(0, 120)], never: [b.ms, b.json?.error?.slice(0, 160)], syntax: [c.ms, c.json?.error?.slice(0, 100)] });
  });
  await C('A15-tab-closed', async (id) => {
    const nt = await m.tool('browser.new_tab', { url: srv.origin + '/blank?closeme=1' });
    const tabId = nt.json?.tabId ?? nt.json?.id;
    const pg = await pageFor(browser, srv.origin + '/blank?closeme=1');
    const wp = W({ text: 'Never', timeoutMs: 10000, tabId });
    await delay(600);
    const closedAt = Date.now();
    await pg.close();
    const r = await wp;
    const lt = await m.tool('browser.list_tabs', {});
    rec(`${label}:${id}`, r.json?.success === false && /closed/.test(r.json?.error ?? r.text) && r.recvAt - closedAt < 2500 && !lt.isError, { tabId, afterClose: r.recvAt - closedAt, err: (r.json?.error ?? r.text).slice(0, 160), listTabsOk: !lt.isError });
  });
  await C('A16-validation', async (id) => {
    const a = await W({});
    const b = await W({ text: '' });
    const c = await W({ text: 'X', textGone: 'X' });
    const d = await W({ text: 'x', timeoutMs: 300001 });
    const e = await W({ text: 'x', timeoutMs: -1 });
    rec(`${label}:${id}`, a.isError && /at least one/.test(a.text) && b.isError && c.isError && /never be satisfied/.test(c.text) && d.isError && e.isError, { a: a.text.slice(0, 90), b: b.text.slice(0, 90), c: c.text.slice(0, 90), d: d.text.slice(0, 60), e: e.text.slice(0, 60) });
  });
}
