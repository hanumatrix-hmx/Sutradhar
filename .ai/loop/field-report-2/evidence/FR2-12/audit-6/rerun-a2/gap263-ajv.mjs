// FR2-12 audit-2: GAP-263 -- plain Ajv (draft-07) + ajv-formats against the committed schema.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..', '..');
const req = createRequire(path.join(root, 'package.json'));
const ajvDir = path.join(root, 'node_modules', '.pnpm', 'ajv@8.20.0', 'node_modules', 'ajv');
const fmtDir = path.join(root, 'node_modules', '.pnpm', 'ajv-formats@3.0.1_ajv@8.20.0', 'node_modules', 'ajv-formats');
let Ajv = req(ajvDir); Ajv = Ajv.default ?? Ajv;
let addFormats = req(fmtDir); addFormats = addFormats.default ?? addFormats;
const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
const schema = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'capability-runtime', 'schemas', 'audit-report.schema.json'), 'utf8'));
const validate = ajv.compile(schema);
// a real report produced by this audit's own CLI control run
const base = JSON.parse(fs.readFileSync(path.join(here, 'sample-report.json'), 'utf8'));
const out = { baseValid: validate(base), cases: {} };
for (const status of [400, 404, 599, 600, 999, 1000, 399, 404.5, -1, '404']) {
  const r = structuredClone(base);
  r.brokenRequests = [{ url: 'http://x/y', status }];
  const ok = validate(r);
  out.cases[String(status) + (typeof status === 'string' ? '(string)' : '')] = { valid: ok, errors: ok ? undefined : validate.errors.map((e) => `${e.instancePath} ${e.message}`) };
}
fs.writeFileSync(path.join(here, 'gap263-ajv.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
