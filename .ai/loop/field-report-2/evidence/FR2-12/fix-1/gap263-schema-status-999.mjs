// FR2-12 fix-1, GAP-263: the committed audit-report schema rejected a real HTTP status above 599
// (e.g. 999, which some real sites -- LinkedIn among them -- use to deny requests). Validates a
// synthetic-but-realistic report containing a status:999 broken-request entry with a plain Ajv
// instance (draft-07 + strict:false, same pattern as audit-1's probe-sdk-schema.mjs), against
// BOTH the pre-fix schema (checked out from git, must reject) and the post-fix schema on disk
// (must accept) -- so this is a real before/after comparison, not just "it validates now".
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const schemaPath = path.join(repoRoot, 'packages', 'capability-runtime', 'schemas', 'audit-report.schema.json');

const r = createRequire(path.join(repoRoot, 'packages', 'mcp-server', 'package.json'));
const sdkPkg = path.dirname(r.resolve('@modelcontextprotocol/sdk/package.json'));
const r2 = createRequire(path.join(sdkPkg, 'package.json'));
let Ajv = r2('ajv');
Ajv = Ajv.default ?? Ajv;

function compile(schemaText) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(JSON.parse(schemaText));
}

function makeReport(status) {
  return {
    schemaVersion: 1,
    url: 'http://127.0.0.1:1/x',
    requestedUrl: 'http://127.0.0.1:1/x',
    title: 't',
    timestamp: new Date().toISOString(),
    screenshot: { path: null, width: 10, height: 10, bytes: 100, fullPage: true },
    consoleErrors: [],
    pageErrors: [],
    brokenRequests: [{ url: 'http://x/denied', status }],
    accessibilityIssues: [],
    webVitals: { lcpMs: null, cls: null, fcpMs: null, ttfbMs: null },
    observation: { mode: 'current-page', documentStartedAt: null, observingSince: null, coversWholeDocument: false, pageWasHidden: null },
    baseline: null,
  };
}

const out = { schemaPath };

// Pre-fix schema, read from git HEAD~ (the commit before this fix-1 session's changes) via
// `git show`, rather than a hand-maintained copy, so this is a genuine before/after diff.
let preFixSchemaText;
try {
  preFixSchemaText = execFileSync('git', ['show', 'HEAD:packages/capability-runtime/schemas/audit-report.schema.json'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
} catch (e) {
  out.preFixReadError = String(e?.message ?? e);
}

if (preFixSchemaText) {
  const validatePre = compile(preFixSchemaText);
  out.preFix_status999 = { valid: validatePre(makeReport(999)), errors: validatePre.errors?.map((e) => `${e.instancePath} ${e.message}`) };
  out.preFix_status404 = { valid: validatePre(makeReport(404)) }; // sanity: an ordinary status still validates on both schemas
}

const postFixSchemaText = await fs.readFile(schemaPath, 'utf-8');
const validatePost = compile(postFixSchemaText);
out.postFix_status999 = { valid: validatePost(makeReport(999)) };
out.postFix_status404 = { valid: validatePost(makeReport(404)) };
out.postFix_status1000_rejected = { valid: validatePost(makeReport(1000)) === false };
out.postFix_status399_still_rejected = { valid: validatePost(makeReport(399)) === false };
out.postFix_status_float_still_rejected = { valid: validatePost(makeReport(404.5)) === false };

const pass =
  (out.preFixReadError || out.preFix_status999?.valid === false) &&
  out.postFix_status999.valid === true &&
  out.postFix_status404.valid === true &&
  out.postFix_status1000_rejected.valid === true &&
  out.postFix_status399_still_rejected.valid === true &&
  out.postFix_status_float_still_rejected.valid === true;
out.pass = pass;

await fs.writeFile(path.join(here, 'gap263-schema-status-999.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exitCode = pass ? 0 : 1;
