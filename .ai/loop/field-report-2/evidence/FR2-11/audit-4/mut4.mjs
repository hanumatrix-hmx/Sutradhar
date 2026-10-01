// AUDIT-4 mutant driver (own mutants). Apply one mutant, rebuild the touched package dist(s) with tsc, run the privacy unit
// specs of browser + cli, run gen4 (CLAIM leak count vs baseline) and restore the file byte-identically (sha256 checked).
// Usage: node mut4.mjs [ids...]
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
import { here, repo } from './lib4.mjs';
const BS = String.fromCharCode(92);
const AH = 'packages/browser/src/session/action-history.ts', HF = 'packages/cli/src/history-file.ts', BT = 'packages/browser/src/session/browser-tab.ts';
const M = {
  M1: [AH, '|' + BS + 'p{Cf}+)/gu;', ')/gu;', 'sub-tokenisation: Unicode Cf no longer splits'],
  M2: [AH, '(' + BS + BS + "*['" + '"`]|[,()[' + BS + ']{}|^]', '([()[' + BS + ']{}|^]', 'sub-tokenisation: quotes, backtick and comma no longer split'],
  M3: [AH, "for (let k = 1; k < parts.length; k++) acc = acc.slice(0, acc.lastIndexOf('/') + 1) + parts[k]!;", "for (let k = 1; k < parts.length; k++) acc = k === 1 ? acc.slice(0, acc.lastIndexOf('/') + 1) + parts[k]! : acc + '@' + parts[k]!;", 'userinfo: only the first @ of a run is stripped'],
  M4: [AH, "acc.slice(0, acc.lastIndexOf('/') + 1)", "acc.slice(0, Math.max(acc.lastIndexOf('/'), acc.lastIndexOf(String.fromCharCode(92)), acc.lastIndexOf(String.fromCharCode(39)), acc.lastIndexOf(',')) + 1)", 'userinfo: a backslash, quote or comma also stops the strip'],
  M5: [AH, 'return span >= t.length ? t : t.slice(0, span) + reduceLoosePath(t.slice(span));', 'return t;', 'exemption span: a scheme:// sub-token is kept whole (old whole-token exemption)'],
  M6: [AH, 'const IPV6_HOST = /(?<=' + BS + '/' + BS + '/|@)' + BS + '[[0-9A-Fa-f:.%]+' + BS + ']/g;', 'const IPV6_HOST = /' + BS + '[[^' + BS + ']]+' + BS + ']/g;', 'IPv6: any bracket group anywhere is kept whole'],
  M7: [AH, '<(?!dir>)|(?<!<dir)>', '<|>', '<dir>: placeholder no longer protected from the split'],
  M8: [AH, "const input = decoded.split(TRUE_WS).map((p, i) => (i % 2 === 1 ? p : stripUserinfo(p))).join('');", 'const input = decoded;', 'order: no userinfo pre-pass before the cut (strip only inside redactToken)'],
  M9: [AH, 'const decoded = decodeDelimiters(raw);', 'const decoded = raw;', 'order: decode removed (split/strip see the encoded text)'],
  M10: [AH, "if (typeof e.error === 'string') out.error = redactedString(e.error, HISTORY_TEXT_CAP);", "if (typeof e.error === 'string') out.error = capHistoryString(e.error, HISTORY_TEXT_CAP);", 'caller/field: entry.error skips the rule'],
  M11: [BT, 'this.actionHistory.push(stored);', 'this.actionHistory.push(entry);', 'surface: the TAB view stores the raw entry (session ring still sanitized)'],
  M12: [HF, 'capHistoryString(redactHistoryText(scrubDeep(input.error, secrets)), ERROR_CAP)', 'capHistoryString(scrubDeep(input.error, secrets), ERROR_CAP)', 'surface: CLI history.jsonl line error skips the rule'],
  M13: [HF, 'args.map((a, i) => (sel.includes(i) ? redactHistorySelector(a) : redactHistoryText(a)))', 'args.map((a) => a)', 'surface: human history prints raw args of an old line'],
  M14: [AH, 'return redactHistoryText(s.replace(CONDITION_KEY', 'return (s.replace(CONDITION_KEY', 'caller: wait_for condition selector skips the rule'],
  M15: [AH, 'return redactHistoryText(redactHistoryUrlD5(decodeDelimiters(url)));', 'return redactHistoryUrlD5(decodeDelimiters(url));', 'caller: structured URL fields skip the text rule after D5'],
  M16: [AH, 'const SEP_THEN_TEXT = /[' + BS + BS + '/][^' + BS + BS + '/]/;', 'const SEP_THEN_TEXT = /' + BS + '/[^' + BS + BS + '/]/;', 'path rule: a backslash is not a separator'],
};
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, f))).digest('hex');
const sh = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: true, timeout: 600000 }); return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }; };
const ESC = String.fromCharCode(27);
const strip = (s) => s.split(ESC).map((p, i) => (i === 0 ? p : p.replace(/^\[[0-9;]*m/, ''))).join('');
if (process.argv[2] === '--check') { for (const [id, [f, find]] of Object.entries(M)) console.log(id, fs.readFileSync(path.join(repo, f), 'utf8').split(find).length - 1); process.exit(0); }
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(M);
const files = [AH, HF, BT];
const before = Object.fromEntries(files.map((f) => [f, sha(f)]));
fs.writeFileSync(path.join(here, 'sha-src-before.txt'), JSON.stringify(before, null, 1));
const results = [];
const tsc = path.join(repo, 'node_modules/typescript/bin/tsc');
const build = (f) => sh('node', [tsc], path.join(repo, f.startsWith('packages/cli') ? 'packages/cli' : 'packages/browser'));
const failed = (o) => { const m = strip(o).match(/Tests +(\d+) failed/); return m ? Number(m[1]) : (/Tests +\d+ passed/.test(strip(o)) ? 0 : -1); };
for (const id of ids) {
  const [file, find, repl, what] = M[id];
  const abs = path.join(repo, file); const orig = fs.readFileSync(abs, 'utf8');
  const n = orig.split(find).length - 1;
  if (n !== 1) { results.push({ id, what, error: 'find matched ' + n + ' times' }); console.log(id, 'SKIP matched', n); continue; }
  const r = { id, what, file };
  try {
    fs.writeFileSync(abs, orig.replace(find, repl));
    r.build = build(file).code;
    if (file.startsWith('packages/browser')) r.buildCli = build(HF).code;
    const vb = sh(path.join(repo, 'node_modules/.bin/vitest'), ['run', 'tests/unit/action-history.spec.ts', 'tests/unit/char-rule.spec.ts', 'tests/unit/glue-rule.spec.ts', 'tests/unit/privacy-matrix.spec.ts', 'tests/unit/session-action-history.spec.ts'], path.join(repo, 'packages/browser'));
    const vc = sh(path.join(repo, 'node_modules/.bin/vitest'), ['run', 'tests/unit/char-rule.spec.ts', 'tests/unit/glue-rule.spec.ts', 'tests/unit/privacy-matrix.spec.ts', 'tests/unit/history-file.spec.ts', 'tests/unit/help-text.spec.ts'], path.join(repo, 'packages/cli'));
    r.unitBrowserFailed = failed(vb.out); r.unitCliFailed = failed(vc.out);
    const g = sh('node', [path.join(here, 'gen4.mjs'), repo], here);
    try { const j = JSON.parse(g.out); r.gen4ClaimLeakingCells = j.perClass.CLAIM.leakingCells; r.gen4Idem = j.idempotencyFails; } catch { r.gen4 = g.out.slice(0, 200); }
  } finally { fs.writeFileSync(abs, orig); }
  r.restored = sha(file) === before[file];
  r.caughtByUnit = r.unitBrowserFailed > 0 || r.unitCliFailed > 0;
  results.push(r); console.log(JSON.stringify(r));
}
build(AH); build(HF);
const after = Object.fromEntries(files.map((f) => [f, sha(f)]));
fs.writeFileSync(path.join(here, 'sha-src-after.txt'), JSON.stringify(after, null, 1));
fs.writeFileSync(path.join(here, 'mutants4.json'), JSON.stringify({ results, shaEqual: JSON.stringify(before) === JSON.stringify(after) }, null, 1));
console.log('shaEqual', JSON.stringify(before) === JSON.stringify(after));
