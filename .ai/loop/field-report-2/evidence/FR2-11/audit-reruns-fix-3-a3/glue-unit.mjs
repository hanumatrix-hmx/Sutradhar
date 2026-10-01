import * as B from 'file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/browser/dist/index.js';
const bs = String.fromCharCode(92);
const cases = [
  '["https://h/a","C:' + bs + bs + 'Users' + bs + bs + 'WvUser1' + bs + bs + 'doc.txt"]',
  'fetch("https://h/up",{body:JSON.stringify({f:"/home/WvUser2/secret/doc.txt"})})',
  'https://h/p,/home/WvUser3/f.txt',
  '["https://h/a","https://u:WvPass4@h2/p"]',
  'see:https://h/a|//srv/WvShare5/f.doc',
  'https://h/p' + String.fromCharCode(0x2028) + '/home/WvUser6/f.txt',
  'Failed:https://h/x(C:' + bs + 'Users' + bs + 'WvUser7' + bs + 'a.txt)',
  'x:https://h/a/b/WvPath8/c',
  'https://h/p' + String.fromCharCode(0x202a) + '/home/WvUser9/f.txt',
];
for (const c of cases) { const t = B.redactHistoryText(c); const e = B.sanitizeHistoryEntry({ actionType: 'eval', target: c, success: true, executionTimeMs: 1, timestamp: 't' }).target; console.log(JSON.stringify(c), '=>', JSON.stringify(t), '| eval:', JSON.stringify(e), /Wv(User|Pass|Share)/.test(t + e) ? 'LEAK' : 'clean'); }
