// FR2-06 fix-1 live-verify: reproduce audit-1's exact case list from
// evidence/FR2-06/audit-1/engine-prefix-reason-text.txt against the FIXED dist build.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd());
const mod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'actions', 'selector-dialect.js')).href);

const cases = [
  'xpath=//button',
  'aria=Submit',
  'pierce=#x',
  'id=main',
  'data-testid=go',
  'DATA-TESTID=go',
  'Xpath = //a',
  'css=button',
  'text=Submit',
  'role=button',
];

for (const c of cases) {
  const m = mod.detectForeignSelectorDialect(c);
  console.log(`${JSON.stringify(c)} => ${JSON.stringify(m?.reason ?? null)}`);
}
