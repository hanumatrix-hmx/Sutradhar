// S2 live check: SutradharRuntime from a built bundle against the fixture server, headless Chrome.
// Env: BUNDLE (abs path of index.js; default HEAD build), SP, WT, OUT (json result path). Run under the isolation preamble.
// Works against both HEAD and NEG061: the mode is detected from `typeof runtime.readTextWindow`.
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !WT) { console.error('needs SP and WT'); process.exit(2); }
const tmp = norm(os.tmpdir());
if (!tmp.startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (harness)'); process.exit(97); }
const ISO = os.tmpdir();
if (ISO.length + 1 + 35 > 200) { console.error('ISO too long for the Chrome profile path'); process.exit(2); }
const BUNDLE = process.env.BUNDLE ?? `${WT}/packages/sutradhar/dist/index.js`;
const OUT = process.env.OUT;
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.error(`[harness] BUNDLE=${BUNDLE} sha256=${sha(BUNDLE)} tmpdir=${tmp}`);

const { SutradharRuntime } = await import(pathToFileURL(BUNDLE).href);
const { start } = await import(pathToFileURL(`${WT}/.ai/loop/release-0.6.2/evidence/fixtures/fixture-server.mjs`).href);
const f = await start();
const rt = new SutradharRuntime();
const res = await rt.launch({ launch: { headless: true } });
const sid = res.sessionId;
const out = { bundle: BUNDLE, bundleSha256: sha(BUNDLE), hasReadTextWindow: typeof rt.readTextWindow !== 'undefined', checks: {} };
const check = (k, ok, detail) => { out.checks[k] = { ok: !!ok, detail }; console.error(`${ok ? 'PASS' : 'FAIL'} ${k} ${detail !== undefined ? JSON.stringify(detail) : ''}`); };
try {
  if (!res.hasRealBrowser) throw new Error('no real browser');
  // ---- /long
  await rt.navigate(sid, `${f.url}/long?n=10000`);
  const FULL = await rt.eval(sid, 'document.body.innerText'); // independent channel
  out.fullLength = FULL.length;
  check('FULL.length >= 10000', FULL.length >= 10000, FULL.length);
  const snapLong = await rt.snapshot(sid);
  out.snapLong = { pageTextLength: snapLong.pageText.length, pageTextTotalChars: snapLong.pageTextTotalChars, pageTextTruncated: snapLong.pageTextTruncated, hasPageTextError: 'pageTextError' in snapLong };
  if (out.hasReadTextWindow) {
    const r = await rt.readTextWindow(sid);
    check('S2-1 default window length 4000', r.text.length === 4000, r.text.length);
    check('S2-1 totalChars == FULL.length', r.totalChars === FULL.length, { totalChars: r.totalChars, full: FULL.length });
    check('S2-1 truncated', r.truncated === true && r.source === 'dom' && r.offset === 0);
    let acc = ''; const wins = [];
    for (let off = 0; off < r.totalChars; ) {
      const w = await rt.readTextWindow(sid, undefined, { offset: off });
      wins.push(w.text); acc += w.text; off += w.returnedChars;
      if (w.returnedChars === 0) throw new Error('zero-length window');
    }
    check('S2-1 windows concatenate to FULL exactly', acc === FULL, { windows: wins.length, accLen: acc.length });
    check('S2-1 windows differ (>= 3 distinct)', new Set(wins).size >= 3 && wins.length >= 3, wins.length);
    check('S2-1 snapshot() carries the first window + totals', snapLong.pageText === FULL.slice(0, 4000) && snapLong.pageTextTotalChars === FULL.length && snapLong.pageTextTruncated === true, out.snapLong);
    const big = await rt.readTextWindow(sid, undefined, { maxChars: 100000 });
    check('maxChars 100000 returns FULL, not truncated', big.text === FULL && big.truncated === false);
    const past = await rt.readTextWindow(sid, undefined, { offset: FULL.length + 5 });
    check('offset past end: empty, truncated, totals', past.text === '' && past.truncated === true && past.totalChars === FULL.length, past);
    let te; try { await rt.readTextWindow(sid, undefined, { maxChars: 0 }); } catch (e) { te = e; }
    check('maxChars 0 -> TypeError', te instanceof TypeError, te && te.message);
  } else {
    // NEG061 control: genuinely absent things only
    check('S2-5 typeof readTextWindow === undefined', typeof rt.readTextWindow === 'undefined');
    check('S2-5 snapshot().pageTextTotalChars === undefined', snapLong.pageTextTotalChars === undefined, snapLong.pageTextTotalChars);
    check('S2-5 snapshot().pageText.length === 4000', snapLong.pageText.length === 4000, snapLong.pageText.length);
  }
  // ---- /short
  await rt.navigate(sid, `${f.url}/short`);
  const snapShort = await rt.snapshot(sid);
  out.shortPageText = snapShort.pageText;
  out.shortPageTextSha256 = createHash('sha256').update(snapShort.pageText).digest('hex');
  out.shortLength = snapShort.pageText.length;
  check('short pageText length > 200', snapShort.pageText.length > 200, snapShort.pageText.length);
  if (out.hasReadTextWindow) check('short: pageTextTruncated false, total == length', snapShort.pageTextTruncated === false && snapShort.pageTextTotalChars === snapShort.pageText.length, { t: snapShort.pageTextTruncated, n: snapShort.pageTextTotalChars });
} catch (e) {
  out.fatal = String(e?.stack ?? e); console.error('FATAL', out.fatal);
} finally {
  await rt.shutdown(sid).catch((e) => { out.shutdownErr = String(e); });
  await f.close();
}
out.allPass = !out.fatal && Object.values(out.checks).every((c) => c.ok);
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
console.error(out.allPass ? 'LIVE-RUNTIME OK' : 'LIVE-RUNTIME FAILED');
process.exitCode = out.allPass ? 0 : 1;
