// AUDIT-4 idempotency + readability of stored text (fix-3 side effects): &lt;dir&gt;, IPv6 URLs, selectors, wait_for selectors,
// upload targets, eval preview (BOM), spaced paths (A3-F3). Each value is sanitized twice; the second pass must change nothing.
import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { writeFileSync } from 'node:fs';
import { here, repo } from './lib4.mjs';
const B = await import(pathToFileURL(path.join(repo, 'packages/browser/dist/index.js')).href);
const D = '<' + 'dir>';
const E = (o) => B.sanitizeHistoryEntry({ success: true, executionTimeMs: 1, timestamp: 't', ...o });
const cases = [
  ['text', { actionType: 'click', error: '&lt;dir&gt; and ' + D + ' and a' + D + 'b' }],
  ['ipv6 url', { actionType: 'navigate', target: 'http://[::1]:8080/api/v1?x=1', url: 'http://[2001:db8::1]/p#f' }],
  ['ipv6 text', { actionType: 'click', error: 'failed at http://[::1]:8080/api/v1 and https://[fe80::1%25eth0]/x' }],
  ['selector id/attr', { actionType: 'click', selector: 'form#login button[type=submit]:nth-child(2) > a[href="/x"]' }],
  ['selector xpath', { actionType: 'click', selector: '//div[@id="main"]/a' }],
  ['selector text=', { actionType: 'click', selector: 'text=Sign in' }],
  ['wait_for', { actionType: 'wait_for', selector: 'text="Saved successfully" AND url~"/done" AND textGone="Loading…"' }],
  ['wait_for js', { actionType: 'wait_for', selector: 'js(document.querySelector("#x") !== null)' }],
  ['wait_for_selector', { actionType: 'wait_for_selector', selector: '#results li', target: 'state=visible' }],
  ['upload', { actionType: 'upload_file', target: 'report-2026.pdf', selector: 'input[type=file]' }],
  ['upload no ext', { actionType: 'upload_file', target: 'Makefile' }],
  ['eval BOM', { actionType: 'eval', target: 'a' + String.fromCharCode(0xfeff) + 'https://h/x?t=1' }],
  ['eval multiline', { actionType: 'eval', target: '  const x =\n  1;\n fetch("https://t.test/p?k=S") ' }],
  ['spaced path', { actionType: 'click', error: "open 'E:/x/Acme Secret Project/s.png'" }],
  ['press_key', { actionType: 'press_key', target: 'Control+Shift+ArrowRight' }],
  ['click_by_role', { actionType: 'click_by_role', target: 'button "Save"' }],
];
const rows = cases.map(([name, e]) => { const a = E(e); const b = B.sanitizeHistoryEntry(a); return { name, stored: a, idempotent: JSON.stringify(a) === JSON.stringify(b) }; });
writeFileSync(path.join(here, 'idem4.json'), JSON.stringify(rows, null, 1));
for (const r of rows) { const { success, executionTimeMs, timestamp, actionType, ...rest } = r.stored; console.log(r.idempotent ? 'IDEM ' : 'NOT-IDEM', r.name.padEnd(18), JSON.stringify(rest)); }
