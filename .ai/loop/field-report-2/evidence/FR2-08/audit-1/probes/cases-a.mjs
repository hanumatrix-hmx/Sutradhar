export default async function ({ srv, browser, m, W, nav, ev, waitDialog, C, label, rec, delay }) {
  await C('A1-toast', async (id) => {
    const pg = await nav('/toast?d=2000');
    const r = await W({ text: 'Probe toast shown', timeoutMs: 8000 });
    const e = (await ev(pg)).find((x) => x.w === 'shown');
    rec(`${label}:${id}`, r.json?.success === true && e && r.recvAt >= e.at && r.recvAt - e.at <= 700 && r.json.output.polls >= 10, { ms: r.ms, lat: e && r.recvAt - e.at, polls: r.json?.output?.polls, tier: r.json?.verification?.evidence?.tier });
  });
  await C('A2-settle-vs-timer', async (id) => {
    const pg = await nav('/click-toast');
    const c = await m.tool('browser.click', { target: '#b', settle: true });
    const shown1 = (await ev(pg)).find((x) => x.w === 'shown');
    const r = await W({ text: 'Late toast', timeoutMs: 8000 });
    const shown = (await ev(pg)).find((x) => x.w === 'shown');
    rec(`${label}:${id}`, c.json?.success === true && !shown1 && shown && c.recvAt < shown.at && r.json?.success === true && r.recvAt >= shown.at, { clickMs: c.ms, clickRecvBeforeShownBy: shown && shown.at - c.recvAt, waitLat: shown && r.recvAt - shown.at });
  });
  await C('A2b-concurrent-click', async (id) => {
    await nav('/click-toast?c=1');
    const wp = W({ text: 'Late toast', timeoutMs: 8000 });
    await delay(200);
    const c = await m.tool('browser.click', { target: '#b' });
    const r = await wp;
    rec(`${label}:${id}`, c.json?.success === true && c.ms < 4000 && r.json?.success === true, { clickMs: c.ms, waitMs: r.ms });
  });
  await C('A3-dialog-text-present', async (id) => {
    await nav('/alert-now?d=300&t=Hello%20visible');
    const open = await waitDialog();
    const a = await W({ text: 'Hello visible', timeoutMs: 8000 }, 30000);
    const b = await W({ textGone: 'Never here', timeoutMs: 8000 }, 30000);
    const c = await W({ js: 'true', timeoutMs: 8000 }, 30000);
    const d = await W({ url: 'alert-now', timeoutMs: 3000 }, 30000);
    const still = await m.tool('browser.get_pending_dialog', {});
    await m.tool('browser.handle_dialog', { action: 'accept' });
    const ok = open && a.json?.success === false && /blocked by an open alert/.test(a.json?.error) && a.ms < 3000 && b.json?.success === false && /blocked by an open alert/.test(b.json?.error) && c.json?.success === false && d.json?.success === true && !!still.json?.dialog;
    rec(`${label}:${id}`, ok, { open, text: [a.json?.success, a.ms, a.json?.error?.slice(0, 120), a.json?.dialogPending?.type], textGone: [b.json?.success, b.ms, b.json?.output?.presentAtStart], js: [c.json?.success, c.ms], url: [d.json?.success, d.ms], stillPending: !!still.json?.dialog });
  });
  await C('A3b-dialog-opens-mid-wait-textGone', async (id) => {
    await nav('/alert-now?d=1200&t=Hello%20visible');
    const r = await W({ textGone: 'Hello visible', timeoutMs: 10000 }, 30000);
    const u = await W({ textGone: 'Never was here', timeoutMs: 2000 }, 30000);
    await m.tool('browser.handle_dialog', { action: 'accept' }).catch(() => {});
    rec(`${label}:${id}`, r.json?.success === false && /blocked by an open alert/.test(r.json?.error ?? '') && r.ms < 4500 && u.json?.success === false, { ms: r.ms, err: r.json?.error?.slice(0, 140), vacuousUnderDialog: [u.json?.success, u.json?.error?.slice(0, 100)] });
  });
}
