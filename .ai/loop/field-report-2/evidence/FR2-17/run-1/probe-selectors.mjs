import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const b = await import(pathToFileURL(path.join(root, 'packages/browser/dist/index.js')).href);
for (const s of ['text=Sign in', 'role=button', 'div >> span', 'button:has-text("x")', 'getByRole("button")', 'internal:text="x"', 'xpath=//a', 'pierce/.x', 'xpath//a', 'aria/Submit', 'text/Sign in', '#ok', '12']) {
  try { b.assertSupportedSelectorDialect(s); console.log(JSON.stringify(s), '=> accepted'); }
  catch (e) { console.log(JSON.stringify(s), '=> REJECTED', e.name, '|', String(e.message).slice(0, 160)); }
}
