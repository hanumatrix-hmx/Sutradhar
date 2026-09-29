// Auditor SDK probes against the BUILT bundle packages/sutradhar/dist/index.js (real Chrome).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { startAuditServer } from './audit-server.mjs';
const repoRoot = process.argv[2];
const outFile = process.argv[3];
const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')).href);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const DEADLINE = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 10 * 60 * 1000);
const rec = (id, exp, ok, data) => { rows.push({ id, exp, pass: !!ok, ...data }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} :: ${exp} :: ${JSON.stringify(data).slice(0, 500)}`); };
const t = (r) => r?.verification?.evidence?.tier;
const srv = await startAuditServer();
const dlRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-audit-sdkdl-'));
const browser = await sdk.launch({ headless: true, allowedDownloadRoots: [dlRoot] });
let n = 0;
const safe = async (id, fn) => { try { await fn(); } catch (e) { rec(id, 'probe ran', false, { error: String(e?.stack ?? e).slice(0, 400) }); } };
try {
  const page = await browser.newPage(`${srv.origin}/p.html?n=${++n}`);
  await delay(800);
  rec('SDK.exports', 'ActionFailedError and ExpectationFailedError exported', typeof sdk.ActionFailedError === 'function' && typeof sdk.ExpectationFailedError === 'function', {});
  await safe('SDK.click-missing', async () => {
    let err; try { await page.click('#definitely-missing'); } catch (e) { err = e; }
    rec('SDK.click-missing', 'rejects ActionFailedError, tier action-failed', err instanceof sdk.ActionFailedError && t(err.result) === 'action-failed', { name: err?.name, tier: t(err?.result) });
  });
  await delay(1100);
  await safe('SDK.click-expect-hidden', async () => {
    let err; try { await page.click('#noop', { expect: { text: 'DISPLAY-NONE-TEXT' } }); } catch (e) { err = e; }
    rec('SDK.click-expect-hidden-NEG', 'rejects ExpectationFailedError failed=[text]', err instanceof sdk.ExpectationFailedError && JSON.stringify(err.failed) === '["text"]' && err.result.success === true, { name: err?.name, failed: err?.failed });
  });
  await delay(1100);
  await safe('SDK.click-ok', async () => {
    const r = await page.click('#real', { expect: { text: 'plain div' } });
    rec('SDK.click-ok', 'returns result, verified', r?.verification?.verified === true && page.lastResult === r, { tier: t(r) });
  });
  await safe('SDK.press-body', async () => {
    const r = await page.press('q');
    rec('SDK.press-body-NEG', 'press with no text focus -> not verified, no throw', r.success && r.verification.verified === false, { tier: t(r), reason: r.verification.reason });
  });
  await safe('SDK.type-then-press', async () => {
    await page.type('#txt', 'ab');
    const r = await page.press('c');
    rec('SDK.press-typed', 'press after type -> verified (focus on #txt)', r.verification.verified === true, { tier: t(r), reason: r.verification.reason });
  });
  await safe('SDK.wait', async () => {
    const r = await page.waitForSelector('#txt');
    rec('SDK.waitForSelector', 'resolves (void) and lastResult verified', r === undefined && t(page.lastResult) === 'verified', { ret: r, tier: t(page.lastResult) });
  });
  await safe('SDK.screenshot', async () => {
    const b = await page.screenshot();
    rec('SDK.screenshot', 'string, lastResult unverifiable', typeof b === 'string' && t(page.lastResult) === 'unverifiable', { tier: t(page.lastResult) });
  });
  await safe('SDK.goto404', async () => {
    const r = await page.goto(`${srv.origin}/status/404?n=${++n}`);
    rec('SDK.goto404-NEG', 'returns Page, lastResult contradicted', r === page && t(page.lastResult) === 'contradicted', { tier: t(page.lastResult), reason: page.lastResult?.verification?.reason });
  });
  await safe('SDK.goto-expect', async () => {
    let err; try { await page.goto(`${srv.origin}/redirect?n=${++n}`, { expect: { url: '/b' } }); } catch (e) { err = e; }
    rec('SDK.goto-expect-NEG', 'rejects ExpectationFailedError, result.url ends /a?from=redirect', err instanceof sdk.ExpectationFailedError && /\/a\?from=redirect$/.test(err.result.url), { name: err?.name, url: err?.result?.url });
  });
  await safe('SDK.download0', async () => {
    await page.goto(`${srv.origin}/dlpage?n=${++n}`);
    const d = await page.download('#dl0', { downloadDir: dlRoot });
    const st = await fs.stat(d.path);
    rec('SDK.download0-NEG', 'returns with verification contradicted (no expect -> no throw); fs size 0', t(d) === 'contradicted' && st.size === 0, { tier: t(d), size: st.size });
    await delay(1100);
    const d2 = await page.download('#dl', { downloadDir: dlRoot });
    const st2 = await fs.stat(d2.path);
    rec('SDK.download', 'verified, fs size 4321', t(d2) === 'verified' && st2.size === 4321, { tier: t(d2), size: st2.size });
  });
} finally {
  await fs.writeFile(outFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('SUMMARY', rows.filter((r) => r.pass).length, '/', rows.length);
  await browser.close().catch(() => {});
  await srv.close();
  await fs.rm(dlRoot, { recursive: true, force: true }).catch(() => {});
  clearTimeout(DEADLINE);
}
