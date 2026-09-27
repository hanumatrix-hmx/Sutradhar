// FR2-12 audit-1: SDK surface probes + independent JSON-schema validation with a plain Ajv
// instance (draft-07 + ajv-formats, strict formats) -- not the MCP SDK wrapper the executor used.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..', '..');
const OUT = path.join(here, 'probe-sdk-schema.json');
const sdkReq = createRequire(path.join(repoRoot, 'node_modules', '.pnpm', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'));
let Ajv, addFormats;
{
  const r = createRequire(path.join(repoRoot, 'packages', 'mcp-server', 'package.json'));
  const sdkPkg = path.dirname(r.resolve('@modelcontextprotocol/sdk/package.json'));
  const r2 = createRequire(path.join(sdkPkg, 'package.json'));
  Ajv = r2('ajv'); Ajv = Ajv.default ?? Ajv;
  addFormats = r2('ajv-formats'); addFormats = addFormats.default ?? addFormats;
}
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'packages', 'capability-runtime', 'schemas', 'audit-report.schema.json'), 'utf8'));
const validate = ajv.compile(schema);
const check = (obj) => ({ valid: validate(obj), errors: validate.errors?.map((e) => `${e.instancePath} ${e.message}`) });

const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')));
const TMP = path.join(os.tmpdir(), `fr212-audit1-sdk-${Date.now()}`);
await fs.mkdir(TMP, { recursive: true });

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (u.pathname === '/findings') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<html><head><title>f</title></head><body><img src="/nope.png"><input><button></button><script>console.error('sdk-err');setTimeout(()=>{throw new Error('sdk-pe')},0)</script></body></html>`);
  }
  if (u.pathname === '/clean') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><head><title>c</title></head><body><h1>c</h1></body></html>'); }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = { origin, cases: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));

const browser = await sdk.launch({ headless: true });
try {
  const page = (await browser.pages())[0];
  // real reports from the SDK surface
  const a = await page.audit({ url: `${origin}/findings`, outDir: path.join(TMP, 'a', 'b'), baselineUrl: `${origin}/clean` });
  out.cases.sdkWithBaseline = { ...check(a.report), counts: { ce: a.report.consoleErrors.length, pe: a.report.pageErrors.length, br: a.report.brokenRequests.length, a11y: a.report.accessibilityIssues.map((x) => x.rule) }, diffPath: a.report.baseline?.diffPath, hasDiffB64: typeof a.baselineDiffBase64 === 'string' };
  const b = await page.audit();
  out.cases.sdkCurrentPage = { ...check(b.report), path: b.report.screenshot.path, mode: b.report.observation.mode };
  const realFromExecutor = JSON.parse(await fs.readFile(path.join(here, '..', '..', 'run-1', 'report-L2.json'), 'utf8'));
  out.cases.executorCliReportL2 = check(realFromExecutor);

  // outDir is an existing file -> reject before runtime.audit
  const f = path.join(TMP, 'afile');
  await fs.writeFile(f, 'x');
  try { await page.audit({ url: `${origin}/clean`, outDir: f }); out.cases.sdkOutDirFile = { threw: false }; }
  catch (e) { out.cases.sdkOutDirFile = { threw: true, msg: e.message }; }

  // concurrent SDK audits on two pages of one browser
  const p2 = await browser.newPage();
  const [r1, r2] = await Promise.allSettled([page.audit({ url: `${origin}/findings` }), p2.audit({ url: `${origin}/clean` })]);
  out.cases.sdkConcurrent = [r1, r2].map((r) => r.status === 'fulfilled' ? { ok: true, url: r.value.report.url, ce: r.value.report.consoleErrors.length, br: r.value.report.brokenRequests.length, valid: validate(r.value.report) } : { ok: false, err: String(r.reason?.message ?? r.reason) });

  // Negative mutations of a REAL report (independent list, beyond the spec's M8 list)
  const base = a.report;
  const clone = () => JSON.parse(JSON.stringify(base));
  const muts = {
    missingRequired_url: (r) => { delete r.url; },
    missingRequired_observation: (r) => { delete r.observation; },
    missingNested_screenshot_bytes: (r) => { delete r.screenshot.bytes; },
    wrongType_title_number: (r) => { r.title = 42; },
    wrongType_cls_string: (r) => { r.webVitals.cls = '0.1'; },
    negative_lcp: (r) => { r.webVitals.lcpMs = -5; },
    extraKey_top: (r) => { r.extra = 1; },
    extraKey_nested_observation: (r) => { r.observation.foo = true; },
    fullPage_false: (r) => { r.screenshot.fullPage = false; },
    status_399: (r) => { r.brokenRequests = [{ url: 'u', status: 399 }]; },
    status_float: (r) => { r.brokenRequests = [{ url: 'u', status: 404.5 }]; },
    baseline_both_shapes: (r) => { r.baseline = { ...r.baseline, error: 'x' }; },
    baseline_diffPct_101: (r) => { r.baseline.diffPercentage = 101; },
    rule_uppercase: (r) => { r.accessibilityIssues = [{ rule: 'IMG', description: 'd', count: 1 }]; },
    timestamp_no_tz: (r) => { r.timestamp = '2026-01-01T00:00:00'; },
    coversWholeDocument_string: (r) => { r.observation.coversWholeDocument = 'true'; },
    screenshotBase64_added: (r) => { r.screenshotBase64 = 'AAAA'; },
    schemaVersion_2: (r) => { r.schemaVersion = 2; },
  };
  out.cases.mutations = {};
  for (const [k, fn] of Object.entries(muts)) { const r = clone(); fn(r); out.cases.mutations[k] = validate(r) === false ? 'rejected' : 'ACCEPTED'; }
  out.cases.unmutatedValid = validate(clone());
  // optional keys present with plausible values (the D2.4 keys) should validate
  const withDialog = clone(); withDialog.dialogPending = null; withDialog.dialogsHandled = [{ type: 'alert' }];
  out.cases.dialogKeysAccepted = validate(withDialog);
} catch (e) {
  out.fatal = String(e?.stack ?? e);
} finally {
  await save();
  await browser.close().catch(() => {});
  server.close();
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
}
console.log('done');
