import { readFileSync, writeFileSync } from 'node:fs';
export function rep(file, find, repl, count = 1) {
  const orig = readFileSync(file, 'utf8');
  const crlf = orig.includes('\r\n');
  const t = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  const n = t.split(find).length - 1;
  if (n !== count) throw new Error(`${file}: expected ${count} matches, got ${n} for ${find.slice(0, 60)}`);
  let out = t.split(find).join(repl);
  if (crlf) out = out.replace(/\n/g, '\r\n');
  writeFileSync(file, out);
}
