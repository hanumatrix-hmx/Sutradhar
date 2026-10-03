const fs = require('fs'), path = require('path'), crypto = require('crypto');
const M = 'E:/AI-Cache/tmp/fr211-master';
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
const blob = (b) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + b.length + String.fromCharCode(0)), b])).digest('hex');
let same = 0, sameCrlf = 0, diff = [], missing = [];
for (const l of lines) {
  const sp = l.indexOf(' '); const h = l.slice(0, sp), p = l.slice(sp + 1);
  const f = path.join(M, p);
  if (!fs.existsSync(f)) { missing.push(p); continue; }
  const b = fs.readFileSync(f);
  if (blob(b) === h) { same++; continue; }
  const lf = Buffer.from(b.toString('latin1').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)), 'latin1');
  if (blob(lf) === h) { sameCrlf++; continue; }
  diff.push(p);
}
console.log(JSON.stringify({ tracked: lines.length, same, sameAfterCRLF: sameCrlf, differ: diff.length, missing: missing.length, diffFiles: diff.slice(0, 40), missingFiles: missing.slice(0, 20) }, null, 1));
