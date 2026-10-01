// AUDIT-4 explicit seam table: IPv6 exemption, <dir> protection, GAP-372 connectors, GAP-373 password delimiters,
// the @-before-cut class (F1), the structured-URL userinfo class (F2), over-redaction and idempotency. Runs on the built dist.
import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { writeFileSync } from 'node:fs';
import { here, repo } from './lib4.mjs';
const B = await import(pathToFileURL(path.join(repo, 'packages/browser/dist/index.js')).href);
const H = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/history-file.js')).href);
const D = '<' + 'dir>';
const rows = [];
const T = (group, s, secrets, note = '') => {
  const text = B.redactHistoryText(s), sel = B.redactHistorySelector(s);
  const nav = B.sanitizeHistoryEntry({ actionType: 'navigate', target: s, url: s, success: true, executionTimeMs: 1, timestamp: 't' });
  const navArg = H.redactCliArgs('nav', [s])[0];
  const out = { text, sel, navTarget: nav.target, url: nav.url, cliNav: navArg };
  const leaked = Object.entries(out).filter(([, v]) => secrets.some((k) => String(v).toLowerCase().includes(k.toLowerCase()))).map(([k]) => k);
  const idem = B.redactHistoryText(text) === text && B.redactHistorySelector(sel) === sel;
  rows.push({ group, in: s, ...out, leakedOn: leaked, idempotent: idem, note });
};
// IPv6 exemption
T('ipv6', 'https://[dead:beef]@SECa1/x', ['SECa1'], 'host after userinfo-looking bracket: hostname = D5 origin (limit)');
T('ipv6', 'x@[abc]/s3cretA2', ['s3cretA2'], 'path last segment without dot -> <dir> expected');
T('ipv6', '//[::1]:S3cretA3@h.test/p', ['S3cretA3']);
T('ipv6', 'https://h/a//[a]b[c]/S3cretA4/x', ['S3cretA4'], 'URL path (D5 keeps path; limit)');
T('ipv6', 'https://[::1%25en0]/p?t=S3cretA5', ['S3cretA5']);
T('ipv6', 'https://u:S3cretA6@[2001:db8::1]:8443/p', ['S3cretA6']);
T('ipv6', "['https://[::1]/a','https://u:S3cretA7@[::2]/b']", ['S3cretA7']);
T('ipv6', '@[dead]C:/Users/S3cretA8/proj/f.txt', ['S3cretA8'], 'hex group then a local path');
T('ipv6', '//[beef]/home/S3cretA9/x/f.txt', ['S3cretA9'], 'scheme-less // + hex group: is it a URL?');
T('ipv6', 'https://h.test/p@[cafe]C:/Users/S3cretA10/f.txt', ['S3cretA10'], 'GAP-372 shape with an @ + hex group');
T('ipv6', 'https://[::1]/ok' + "'" + ',C:/Users/S3cretA11/f.txt', ['S3cretA11']);
T('ipv6', '//[nothex:S3cretA12]/p', ['S3cretA12'], 'non-hex bracket after // splits');
// <dir>
T('dir', 'a' + D + 'b', [], 'readability');
T('dir', D + 'https://u:S3cretB1@h/p', ['S3cretB1']);
T('dir', D + 'C:/Users/S3cretB2/x/f.txt', ['S3cretB2']);
T('dir', 'https://h/x' + D + 'C:/Users/S3cretB3/y/f.txt', ['S3cretB3'], 'joins URL and path through <dir> (GAP-372-like)');
T('dir', D + '?t=S3cretB4', ['S3cretB4']);
T('dir', D + 'https://h/p' + D + "'https://u:S3cretB5@h2/'" + D, ['S3cretB5']);
T('dir', '&lt;dir&gt;https://u:S3cretB6@h/', ['S3cretB6']);
T('dir', "'C:/Users/S3cretB7/a.txt'" + D + "'C:/Users/S3cretB8/b.txt'", ['S3cretB7', 'S3cretB8']);
// GAP-372 connectors (credential vs path)
for (const c of ['/', '@', ':', '+', '!', '*', '$', '~', '&', '=', '%', '.']) {
  T('372-cred', 'https://h.test/a' + c + 'https://u:S3cretC' + c.charCodeAt(0) + '@h2.test/p', ['S3cretC' + c.charCodeAt(0)], 'credential behind a connector');
  T('372-query', 'https://h.test/a' + c + 'https://h2.test/p?token=S3cretQ' + c.charCodeAt(0), ['S3cretQ' + c.charCodeAt(0)], 'query behind a connector');
  T('372-path', 'https://h.test/a' + c + 'C:/Users/S3cretP' + c.charCodeAt(0) + '/d/f.txt', ['S3cretP' + c.charCodeAt(0)], 'local path behind a connector (GAP-372 documented)');
}
// GAP-373 password delimiters
for (const [n, d] of [['space', ' '], ['slash', '/'], ['pct2F', '%2F'], ['pct252F', '%252F'], ['nbsp', String.fromCharCode(0xa0)], ['ideo', String.fromCharCode(0x3000)], ['tab', String.fromCharCode(9)]]) {
  T('373', 'postgres://admin:Pw1' + n + 'X' + d + 'Pw2' + n + 'Y@db.internal:5432/app', ['Pw1' + n + 'X', 'Pw2' + n + 'Y', 'admin']);
}
// F1: @ inside a value after a cut char or =
T('F1', 'https://h.test/login?user=bob&pw=P@ssS3cretF1', ['S3cretF1']);
T('F1', 'https://h.test/p?pw=P%40ssS3cretF2', ['S3cretF2']);
T('F1', 'https://h.test/cb#access_token=a@S3cretF3', ['S3cretF3']);
T('F1', 'Current URL http://127.0.0.1:5000/x?next=bob@S3cretF4 does not contain y', ['S3cretF4']);
T('F1', 'PGPASSWORD=hunter@S3cretF5', ['S3cretF5']);
T('F1', '--password=Tr0ub@dorS3cretF6', ['S3cretF6']);
T('F1', 'https://h.test/p;jsessionid=a@S3cretF7', ['S3cretF7']);
T('F1', 'https://h.test/p?email=alice@corp.example', ['corp.example'], 'email domain only');
// F2: structured URL fields, password with an ENCODED ? # ; (a valid URL)
for (const [n, d] of [['q', '%3F'], ['h', '%23'], ['s', '%3B'], ['q2', '%253F']]) T('F2', 'https://admin:pa' + d + 'S3cretU' + n + '@h.test/p', ['S3cretU' + n, 'admin:pa']);
// over-redaction: origin + pathname must remain
T('readable', 'https://h.test/app/settings?tab=1', []);
T('readable', 'http://[::1]:8080/api/v1/items', []);
T('readable', 'wss://h.test/socket', []);
writeFileSync(path.join(here, 'explicit4.json'), JSON.stringify(rows, null, 1));
for (const r of rows) console.log([r.group, r.leakedOn.join('+') || '-', r.idempotent ? 'idem' : 'NOT-IDEM', JSON.stringify(r.in).slice(0, 70), '=>', JSON.stringify(r.text).slice(0, 70), '| nav:', JSON.stringify(r.navTarget).slice(0, 50)].join(' '));
