// FR2-11 fix-3: INDEPENDENT fuzz of the glued-token rule. Written separately from lib/fr2-11-glue.mjs (different PRNG, different grammar):
// a random SEQUENCE of atoms (clean URL, URL with secret(s), local path with secret, prose word, JSON-escaped variants) joined by RANDOM
// strings drawn from a hostile alphabet (quotes, backslashes, brackets, Cf, whitespace, `@`, `/`), then optionally JSON.stringify'd or
// wrapped. The oracle is by construction: a secret is only ever placed in a slot the rule claims to remove; it must be absent from every
// stored form of the string. Usage: node fuzz-fr2-11-fix3.mjs <path to browser dist/index.js | bundle> <seed> <count>
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [, , modPath, seedArg = '4242', countArg = '100000'] = process.argv;
const M = await import(pathToFileURL(path.resolve(modPath)).href);
const { redactHistoryText, redactHistorySelector, sanitizeHistoryEntry, evalCodePreview } = M;
// sfc32 PRNG (not the mulberry32 of the unit generators)
let [a, b, c, d] = [0x9e3779b9, 0x243f6a88, 0xb7e15162, Number(seedArg) >>> 0];
const rnd = () => {
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
  return (t >>> 0) / 4294967296;
};
for (let i = 0; i < 20; i++) rnd();
const int = (n) => Math.floor(rnd() * n);
const pick = (x) => x[int(x.length)];
const BS = String.fromCharCode(92);
const HOSTILE = ["'", '"', '`', BS, ',', '(', ')', '[', ']', '{', '}', '<', '>', '|', '^', '/', '@', ':', '­', '​', '‪', '‮', '﻿', '⁦', '󠁁', BS + '"', BS + "'", BS + '/', ' ', '	', '+', '!', '*', '$', '~'];
// glue between atoms: delimiter-class characters, whitespace and escapes only. URL-legal characters (/ @ : + ! * $ ~) between a URL and a path make the
// path part of the URL path (FR2-09 D5 keeps URL paths): a documented limit, not a glue the rule can split.
const GLUE = HOSTILE.filter((x) => !/^[/@:+!*$~]$/.test(x) && x !== BS + '/'); // BS + '/' is a JSON-escaped slash: part of a JSON URL
const glue = () => { let s = ''; const n = 1 + int(3); for (let i = 0; i < n; i++) s += pick(GLUE); return s.endsWith(BS) ? s + ',' : s; };
const cfs = [];
for (let cp = 0; cp < 0x110000; cp++) { if (cp >= 0xd800 && cp <= 0xdfff) continue; if (/^\p{Cf}$/u.test(String.fromCodePoint(cp))) cfs.push(String.fromCodePoint(cp)); }
const host = () => pick(['h.test', 'a.b.c', 'db:5432', '127.0.0.1:80', '[::1]:9', '[2001:db8::7]', 'b\u00fccher.de', '\u4e2d\u6587.cn', 'x', 'LOCALHOST', 'xn--bcher-kva.de']);
const scheme = () => pick(['http', 'https', 'ftp', 'ws', 'postgres', 'redis', 'amqp', 'x-app', 'HTTPS', 'file']);
let n = 0;
const sec = (tag) => `FZ${seedArg}n${n}${tag}`;
const bits = [];
function atom() {
  const k = int(12);
  const s1 = sec('a' + bits.length), s2 = sec('b' + bits.length);
  const pw = () => { // a password that may itself hold hostile characters (not whitespace, not `/`, not `@`)
    let x = s1; const m = int(3);
    for (let i = 0; i < m; i++) x += pick(["'", '"', '(', ')', ',', '|', '[', ']', '{', '}', '<', '>', '`', '^', '!', '*', '+', '$', '~', pick(cfs), '\\"', ':']) + s2;
    bits.push(s1, s2); return x;
  };
  switch (k) {
    case 0: return `${scheme()}://${host()}${pick(['', '/', '/p', '/a/b.html'])}`;
    case 1: return `${scheme()}://${pick(['u:', '', 'x%40y:'])}${pw()}@${host()}${pick(['', '/p', '/q/r'])}`;
    case 2: { bits.push(s1); return `${scheme()}://${host()}/p${pick(['?k=', '?', '#', ';', ';k=', '?a=1&b=', '#/r?t=', '%3Fk%3D', '%23', '%253F'])}${s1}`; }
    case 3: { bits.push(s1); return pick([`C:${BS}Users${BS}${s1}${BS}f.txt`, `C:/Users/${s1}/f.txt`, `${BS}${BS}srv${BS}sh${BS}${s1}${BS}f.txt`, `//srv/sh/${s1}/f.txt`, `/home/${s1}/f.txt`, `~/${s1}/f.txt`, `/home/${s1}`]); }
    case 4: return pick(['hello', 'done', 'Error:', 'at', 'failed', '12', 'x=', 'ok.']).replace('x=', 'x'); // prose (no secret, no rule char)
    case 5: { bits.push(s1, s2); return `${scheme()}://u:${s1}@${host()}/a@${s2}@${host()}/b`; }
    case 6: return `${scheme()}://[${pick(['::1', 'fe80::1%25eth0', '2001:db8::1'])}]${pick([':9', ''])}/p`;
    case 7: { bits.push(s1); return `${scheme()}:${BS}/${BS}/u:${s1}@${host()}${BS}/p`; }
    case 8: { bits.push(s1); return `postgres://admin:${s1}@db:5432/app`; }
    case 9: { bits.push(s1); return `${s1}@${host()}`; }
    case 10: { bits.push(s1); return `file:///C:/Users/${s1}/doc.txt`; }
    default: { bits.push(s1); return `data:text/plain,${s1}`; }
  }
}
const stored = (t) => JSON.stringify([
  redactHistoryText(t), redactHistorySelector(t), evalCodePreview(t), evalCodePreview('fetch(' + JSON.stringify(t) + ')'),
  sanitizeHistoryEntry({ actionType: 'click', selector: t, target: t, error: t, success: false, executionTimeMs: 1, timestamp: 't', verification: { verified: false, urlChanged: false, elementFound: false, confidence: 0, reason: 'Action failed: ' + t, evidence: { tier: 'contradicted', checks: [{ check: 'c', outcome: 'fail', expected: t, observed: t, detail: t }] } } }),
]);
const count = Number(countArg);
let leaks = 0, idem = 0; const examples = [];
for (n = 0; n < count; n++) {
  bits.length = 0;
  const parts = []; const k = 1 + int(4);
  for (let i = 0; i < k; i++) parts.push(atom());
  let text = parts[0]; for (let i = 1; i < parts.length; i++) text += glue() + parts[i];
  const w = int(6);
  if (w === 1) text = JSON.stringify(text); else if (w === 2) text = JSON.stringify({ u: text }); else if (w === 3) text = `[${parts.map((p) => `'${p}'`).join(',')}]`; else if (w === 4) text = 'Error: ' + text + ' (after 3 tries)';
  // secrets that are in a slot the rule claims to remove; `FZ..` ids are unique per string
  const st = stored(text);
  const miss = bits.filter((s) => st.includes(s));
  if (miss.length) { leaks++; if (examples.length < 8) examples.push({ text, secret: miss[0], out: redactHistoryText(text) }); }
  const once = redactHistoryText(text);
  if (redactHistoryText(once) !== once) { idem++; if (examples.length < 8) examples.push({ idempotency: text }); }
}
console.log(JSON.stringify({ module: modPath, seed: Number(seedArg), count, leaks, idempotencyFailures: idem, examples }, null, 1));
process.exit(leaks || idem ? 1 : 0);
