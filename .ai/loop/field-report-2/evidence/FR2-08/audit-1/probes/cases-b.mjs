export default async function ({ srv, browser, m, W, nav, ev, frameAnswers, C, label, rec, delay }) {
  await C('A4-hung-xo-frame', async (id) => {
    const pg = await nav('/hung-xo?main=main%20text%20only&fr=frame%20visible');
    let hung = false; let checks = 0;
    for (; checks < 20 && !hung; checks++) { await delay(300); const fs_ = pg.frames().filter((f) => f !== pg.mainFrame()); const st = await Promise.all(fs_.map((f) => frameAnswers(f, 1000))); hung = st.includes('hung'); }
    const t1 = await W({ text: 'Nowhere token', timeoutMs: 2000 });
    const t2 = await W({ textGone: 'Nowhere token', timeoutMs: 2000 });
    const t3 = await W({ text: 'main text only', timeoutMs: 2000 });
    const t4 = await W({ textGone: 'frame visible', timeoutMs: 2000 });
    const t5 = await W({ textGone: 'Nowhere token', timeoutMs: 0 });
    srv.releaseHeld();
    const ok = hung && t1.json?.success === false && t2.json?.success === false && t2.json?.output?.last?.textGone === 'unavailable' && t3.json?.success === true && t4.json?.success === false && t5.json?.success === false && t2.ms <= 2000 + 1500 + 600;
    rec(`${label}:${id}`, ok, { premiseHung: hung, checks, textNowhere: [t1.json?.success, t1.json?.output?.last?.text], textGoneNowhere: [t2.json?.success, t2.json?.output?.last?.textGone, t2.ms, t2.json?.error?.slice(0, 160)], textMain: [t3.json?.success, t3.ms], textGoneFrame: [t4.json?.success, t4.json?.output?.last?.textGone], textGoneT0: [t5.json?.success, t5.ms] });
  });
  await C('A5-hung-main', async (id) => {
    const pg = await nav('/hung-main?d=300');
    await delay(800);
    const hung = (await frameAnswers(pg.mainFrame(), 1500)) === 'hung';
    const a = await W({ textGone: 'Absent word', timeoutMs: 3000 }, 30000);
    const b = await W({ text: 'Present text', timeoutMs: 3000 }, 30000);
    const c = await W({ js: 'true', timeoutMs: 3000 }, 30000);
    const d = await W({ url: 'hung-main', timeoutMs: 3000 }, 30000);
    const e = await W({ textGone: 'Absent word', timeoutMs: 0 }, 30000);
    srv.releaseHeld();
    const bound = (r, t) => r.ms <= t + 1500 + 2200;
    const ok = hung && a.json?.success === false && b.json?.success === false && c.json?.success === false && d.json?.success === true && e.json?.success === false && bound(a, 3000) && bound(b, 3000) && bound(e, 0);
    rec(`${label}:${id}`, ok, { premiseHung: hung, textGone: [a.json?.success, a.ms, a.json?.output?.last?.textGone], text: [b.json?.success, b.ms], js: [c.json?.success, c.ms, c.json?.error?.slice(0, 100)], url: [d.json?.success, d.ms], textGoneT0: [e.json?.success, e.ms] });
  });
  await C('A6-background', async (id) => {
    const pg = await nav('/toast?d=3000&bg=1');
    const other = await browser.newPage();
    await other.bringToFront();
    const vis = await pg.evaluate(() => document.visibilityState);
    const r = await W({ text: 'Probe toast shown', timeoutMs: 12000 });
    const e = (await ev(pg)).find((x) => x.w === 'shown');
    const t = await W({ text: 'Never appears', timeoutMs: 3000 });
    const tj = await W({ js: 'window.__never === 1', timeoutMs: 3000 });
    await other.close();
    rec(`${label}:${id}`, vis === 'hidden' && r.json?.success === true && e && r.recvAt - e.at <= 700 && t.json?.success === false && t.ms >= 3000 && t.ms <= 3000 + 1500 + 1800 && tj.ms <= 3000 + 1500 + 1800, { vis, lat: e && r.recvAt - e.at, timeoutMs3000Elapsed: t.ms, jsTimeoutElapsed: tj.ms });
  });
  await C('A7-flicker', async (id) => {
    const out = {};
    for (const on of [30, 60, 400]) {
      await nav(`/flicker?on=${on}&d=1500`);
      const r = await W({ text: 'Blinkword', timeoutMs: 4000 });
      out[`on${on}`] = { success: r.json?.success, polls: r.json?.output?.polls, ms: r.ms };
    }
    rec(`${label}:${id}`, out.on400.success === true, { ...out, note: 'informational: a condition true for less than one poll interval may be missed' });
  });
  await C('A8-detach', async (id) => {
    const pg = await nav('/detach?d=1500');
    const r = await W({ textGone: 'InFrameWord', timeoutMs: 6000 });
    const e = (await ev(pg)).find((x) => x.w === 'removed');
    rec(`${label}:${id}`, r.json?.success === true && r.json.output.presentAtStart === true && e && r.recvAt >= e.at, { ms: r.ms, presentAtStart: r.json?.output?.presentAtStart, afterRemoveBy: e && r.recvAt - e.at });
  });
}
