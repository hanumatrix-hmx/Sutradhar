// F1 / F2 attribution: the same inputs through the fix-2 (78087d7) and HEAD (552f9dd) rule, text surface + navigate target.
const H = await import('./head.mjs'); const F = await import('./fix2.mjs');
const rows = [
  ['F1a', 'https://h.test/login?user=bob&pw=P@ssS3cretF1', 'S3cretF1'], ['F1a', 'https://h.test/p?pw=P%40ssS3cretF2', 'S3cretF2'],
  ['F1a', 'https://h.test/cb#access_token=a@S3cretF3', 'S3cretF3'], ['F1a', "'navigate' verified: a new document committed at http://127.0.0.1:5/p?email=bob@S3cretF4", 'S3cretF4'],
  ['F1a', 'https://h.test/p;jsessionid=a@S3cretF7', 'S3cretF7'], ['F1b', 'PGPASSWORD=hunter@S3cretF5', 'S3cretF5'], ['F1b', '--password=Tr0ub@dorS3cretF6', 'S3cretF6'],
  ['F2', 'https://admin:pa%3FS3cretUq@h.test/p', 'admin'], ['F2', 'https://admin:pa%23S3cretUh@h.test/p', 'admin'],
];
for (const [k, s, sec] of rows) {
  const nav = (M) => M.sanitizeHistoryEntry({ actionType: 'navigate', target: s, success: true, executionTimeMs: 1, timestamp: 't' }).target;
  const lk = (x) => x.includes(sec) ? 'LEAK' : 'ok';
  console.log(k, '| fix2 text', lk(F.redactHistoryText(s)), 'nav', lk(nav(F)), '| head text', lk(H.redactHistoryText(s)), 'nav', lk(nav(H)), '|', JSON.stringify(s).slice(0, 60));
}
