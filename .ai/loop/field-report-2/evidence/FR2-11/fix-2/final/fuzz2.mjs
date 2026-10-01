import * as B from 'file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/browser/dist/index.js';
import { makeRng } from 'file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/tools/scenario-suite/lib/fr2-11-property.mjs';
// Oracle-based random fuzz (independent of the generator's forms): random strings over a hostile alphabet with a secret at a random position.
// Oracle (free-text mode): the secret must be absent when, in the DECODED text,
//   (1) a `?` or `;` occurs anywhere before it, or
//   (2) the token holding it also holds `=` or `&`, or
//   (3) a `#` followed by an identifier character or by anything, earlier in the SAME token, or a `#` that is not a bare `#id` token start earlier in the text.
const ALPHA = ['a', 'b', 'x', '1', '2', ':', '/', '\\', '.', '@', '?', '#', ';', '=', '&', '%', '(', ')', '[', ']', '{', '}', "'", '"', '<', '>', ',', '-', '_', '~', '*', '+', '$', '!', '|', '^', '`', '\u00fc', '\u4e2d', '\uff1f', '\uff03'];
const SEPS = [' ', ' ', ' ', '\t', '\u00a0', '\u200b', '\n', '\u3000'];
const ENC = ['%3F', '%3f', '%23', '%3B', '%253F', '%2523', '\\u003f', '\\x23'];
const seedN = Number(process.argv[2] ?? 5);
let total = 0, bad = 0; const shown = [];
for (let sd = 1; sd <= seedN; sd++) {
  const r = makeRng(77 + sd * 104729);
  for (let i = 0; i < 40000; i++) {
    const n = 2 + r.int(6);
    const toks = [];
    const secretAt = r.int(n);
    const k = `CNRYz${sd}x${i}X`;
    for (let t = 0; t < n; t++) {
      let s = '';
      const len = 1 + r.int(7);
      for (let c = 0; c < len; c++) s += r.bool(0.08) ? r.pick(ENC) : r.pick(ALPHA);
      if (t === secretAt) { const p = r.int(3); s = p === 0 ? s + k : p === 1 ? k + s : s + k + r.pick(ALPHA); }
      toks.push(s);
    }
    let text = ''; for (let t = 0; t < n; t++) text += toks[t] + (t < n - 1 ? r.pick(SEPS) : '');
    const out = B.redactHistoryText(text);
    total++;
    if (!out.includes(k)) continue;
    // the secret survived: is that allowed by the oracle?
    const dec = text.normalize('NFKC').replace(/\\u00(3f|23|3b|3d|26|40)|\\x(3f|23|3b|3d|26|40)/gi, (m, a, b) => String.fromCharCode(parseInt(a ?? b, 16)));
    let d2 = dec; for (let q = 0; q < 8; q++) { const nn = d2.replace(/%25(?=[0-9a-fA-F]{2})/g, '%'); if (nn === d2) break; d2 = nn; }
    d2 = d2.replace(/%(3[AFBDafbd]|23|26|2[Ff]|40|5[Cc])/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    const at = d2.indexOf(k);
    const before = d2.slice(0, at);
    const tokStart = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\t'), before.lastIndexOf('\u00a0'), before.lastIndexOf('\u200b'), before.lastIndexOf('\n'), before.lastIndexOf('\u3000'), -1) + 1;
    const tokText = d2.slice(tokStart).split(/[ \t\u00a0\u200b\n\u3000]/)[0].split(/[?;#]/)[0];
    const kIdx = tokText.indexOf(k);
    const atIdx = tokText.lastIndexOf('@', kIdx);
    const effTok = atIdx >= 0 && !tokText.slice(0, atIdx).includes('/') ? tokText.slice(atIdx + 1) : tokText; // userinfo before the secret is stripped first (rule c), so `=`/`&` inside it is gone
    const viol = /[?;]/.test(before) ? 'cut-before' : /[=&]/.test(effTok) ? 'eq-amp-in-token' : /#/.test(d2.slice(tokStart, at)) ? 'hash-in-token-before' : /#(?![\w\-\\\u0080-\uffff])/.test(before) ? 'lone-hash-before' : null;
    if (viol) { bad++; if (shown.length < 12) shown.push({ viol, text: JSON.stringify(text), out: JSON.stringify(out) }); }
  }
}
console.log({ total, violations: bad }); for (const x of shown) console.log(JSON.stringify(x));
