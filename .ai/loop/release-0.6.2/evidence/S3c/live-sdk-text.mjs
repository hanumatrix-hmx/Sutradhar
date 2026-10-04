// S3c live check: the SDK (`launch()` from a built index.js) against the fixture server. Run under the isolation preamble.
// Env: BUNDLE (abs index.js; default HEAD build), SP, WT, OUT. RUNS/NO_MUTANTS/CLI/MCP: unused here (nothing repeats, no mutants).
// Mode is detected from `typeof page.text` ('function' = HEAD, 'undefined' = NEG061).
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (harness)'); process.exit(97); }
const ISO = os.tmpdir();
if (ISO.length + 1 + 35 > 200) { console.error('ISO too long'); process.exit(2); }
const BUNDLE = process.env.BUNDLE ?? `${WT}/packages/sutradhar/dist/index.js`;
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.error(`[harness] BUNDLE=${BUNDLE} sha256=${sha(BUNDLE)} tmpdir=${norm(ISO)}`);
const sdk = await import(pathToFileURL(BUNDLE).href);
const { start } = await import(pathToFileURL(`${WT}/.ai/loop/release-0.6.2/evidence/fixtures/fixture-server.mjs`).href);
const { EMOJI_PAIR_HIGH_INDICES } = await import(pathToFileURL(`${WT}/.ai/loop/release-0.6.2/evidence/fixtures/fixture-server.mjs`).href);
const f = await start();
const out = { bundle: BUNDLE, bundleSha256: sha(BUNDLE), checks: {} };
const check = (k, ok, detail) => { out.checks[k] = { ok: !!ok, detail }; console.error(`${ok ? 'PASS' : 'FAIL'} ${k}${detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 300) : ''}`); };
const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;
const browser = await sdk.launch({ headless: true });
try {
  const page = await browser.newPage();
  out.hasText = typeof page.text;
  await page.goto(`${f.url}/long?n=10000`);
  const FULL = await page.evaluate('document.body.innerText');
  out.L = FULL.length;
  check('FULL via page.evaluate, L >= 10000', FULL.length >= 10000, FULL.length);
  if (typeof page.text === 'function') {
    const r = await page.text();
    check('S3c-1 page.text() fields', r.text === FULL.slice(0, 4000) && r.offset === 0 && r.returnedChars === 4000 && r.totalChars === FULL.length && r.truncated === true && r.source === 'dom' && typeof r.url === 'string' && r.tabId === page.tabId, { keys: Object.keys(r) });
    check('S3c-1 result text never contains the marker', !r.text.includes('[page text'));
    let acc = ''; const wins = []; let off = 0;
    for (let i = 0; i < 40 && off < r.totalChars; i++) { const w = await page.text({ offset: off }); wins.push(w.text); acc += w.text; off += w.returnedChars; if (!w.returnedChars) break; }
    check('S3c-1 paging concatenation == page.evaluate FULL, windows differ', acc === FULL && wins.length >= 3 && new Set(wins).size === wins.length, { windows: wins.length });
    const snap = await page.snapshot();
    check('S3c-2 page.snapshot() additive fields', snap.pageText === FULL.slice(0, 4000) && snap.pageTextTotalChars === FULL.length && snap.pageTextTruncated === true && !('pageTextError' in snap), { total: snap.pageTextTotalChars, trunc: snap.pageTextTruncated });
    // emoji
    await page.goto(`${f.url}/long-emoji`);
    const EM = await page.evaluate('document.body.innerText');
    let bad = []; let accE = ''; let offE = 0; let n = 0;
    for (const max of [4000, 1, 1000, 3999]) {
      accE = ''; offE = 0;
      while (offE < EM.length && n++ < 20000) {
        const w = await page.text({ offset: offE, maxChars: max });
        if (!w.returnedChars) { bad.push('zero-length window at ' + offE); break; }
        if (isLow(w.text.charCodeAt(0))) bad.push(`window at ${offE} starts on a lone low surrogate`);
        if (isHigh(w.text.charCodeAt(w.text.length - 1))) bad.push(`window at ${offE} ends on a lone high surrogate`);
        accE += w.text; offE += w.returnedChars;
      }
      if (accE !== EM) bad.push(`maxChars ${max}: concatenation != full text`);
    }
    // requested offsets landing exactly on a low surrogate
    for (const hi of EMOJI_PAIR_HIGH_INDICES) {
      const w = await page.text({ offset: hi + 1, maxChars: 5 });
      if (w.offset !== hi || isLow(w.text.charCodeAt(0))) bad.push(`offset ${hi + 1} not backed up to ${hi} (got ${w.offset})`);
      const w2 = await page.text({ offset: hi, maxChars: 1 });
      if (w2.returnedChars !== 2) bad.push(`maxChars:1 at pair ${hi} returned ${w2.returnedChars}`);
    }
    out.emojiLength = EM.length;
    check('S3c-3 /long-emoji: no window ends on a lone high or starts on a lone low surrogate; paging at 4 sizes reproduces the text', bad.length === 0 && EM.length >= 12000, bad.slice(0, 5));
    let te; try { await page.text({ maxChars: 0 }); } catch (e) { te = e; }
    check('S3c-4 {maxChars:0} -> TypeError', te instanceof TypeError, te?.message);
  } else {
    check('S3c-4 NEG061: typeof page.text === undefined', typeof page.text === 'undefined', typeof page.text);
    const snap = await page.snapshot();
    check('NEG061 snapshot: no pageTextTotalChars, pageText 4000', snap.pageTextTotalChars === undefined && snap.pageText.length === 4000, { len: snap.pageText.length });
  }
} catch (e) { check('noException', false, String(e?.stack ?? e)); }
finally { await browser.close().catch((e) => { out.closeErr = String(e); }); await f.close(); }
const q = spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' -and $_.CommandLine -like ('*' + $env:ISO_BASE + '*') } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8', env: { ...process.env, ISO_BASE: path.basename(ISO) } });
const left = (q.stdout ?? '').split(/\r?\n/).filter(Boolean);
check('attribution query: no Chrome with the ISO basename after browser.close()', left.length === 0, left);
out.allPass = Object.values(out.checks).every((c) => c.ok);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
console.error(out.allPass ? 'LIVE-SDK-TEXT OK' : 'LIVE-SDK-TEXT FAILED');
process.exitCode = out.allPass ? 0 : 1;
