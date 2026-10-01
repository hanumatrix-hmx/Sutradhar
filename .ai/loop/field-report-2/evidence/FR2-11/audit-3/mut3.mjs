// AUDIT-3 mutants (own). Each: apply (string replace, must match exactly once), tsc browser + cli dist, vitest browser /
// cli / capability-runtime, attack3 unit generator; restore the original bytes and verify sha256. @BS@ = backslash, @BT@ = backtick.
// Usage: node mut3.mjs <repoRoot> [ids,comma-separated] [--live]
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
const root = process.argv[2]; const only = process.argv[3] && process.argv[3] !== '-' ? process.argv[3].split(',') : null;
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const U = (s) => s.split('@BS@').join(String.fromCharCode(92)).split('@BT@').join(String.fromCharCode(96));
const BR = 'packages/browser/src/session/action-history.ts', TAB = 'packages/browser/src/session/browser-tab.ts', CL = 'packages/cli/src/history-file.ts';
const M = [
  ['N1', 'skip field: evidence.observed not redacted', BR, "if ('observed' in c) cOut.observed = scalar(c.observed);", "if ('observed' in c) cOut.observed = c.observed;"],
  ['N2', 'skip field: entry.url not redacted', BR, 'if (typeof e.url === @BT@string@BT@) out.url = capHistoryString(redactHistoryUrl(e.url), HISTORY_STRING_CAP);'.replace(/@BT@/g, "'"), "if (typeof e.url === 'string') out.url = capHistoryString(e.url, HISTORY_STRING_CAP);"],
  ['N3', 'one surface: CLI line error skips the rule', CL, 'capHistoryString(redactHistoryText(scrubDeep(input.error, secrets)), ERROR_CAP)', 'capHistoryString(scrubDeep(input.error, secrets), ERROR_CAP)'],
  ['N4', 'one surface: history human output prints error raw', CL, 'error: ${firstLine(redactHistoryText(parsed.error), ERROR_CAP)}', 'error: ${firstLine(parsed.error, ERROR_CAP)}'],
  ['N5', 'reorder: rule first, decode after', BR, 'const input = decodeDelimiters(raw);', 'const input = raw;', 'return out.join(@Q@);', 'return decodeDelimiters(out.join(@Q@));'],
  ['N6', 'weaken path rule: last segment kept even without a dot', BR, 'return HAS_EXTENSION.test(name) ? name : DIR_PLACEHOLDER;', 'return name;'],
  ['N7', 'weaken path rule: only / is a separator', BR, 'const SEP_THEN_TEXT = /[@BS@@BS@/][^@BS@@BS@/]/;', 'const SEP_THEN_TEXT = /[/][^/]/;'],
  ['N8', 'decode: no double-encoding pass', BR, "const n = out.replace(/%25(?=[0-9a-fA-F]{2})/g, '%');", 'const n = out;'],
  ['N9', 'cut keeps the rest of the text (no swallow)', BR, 'if (r.swallow) break;', 'if (r.swallow && out.length < 0) break;'],
  ['N10', 'one surface: CLI args skip the rule', CL, 'const fin = (a: string): string => capHistoryString(redactHistoryText(a), ARG_CAP);', 'const fin = (a: string): string => capHistoryString(a, ARG_CAP);'],
  ['N11', 'one surface: tab view stores the raw entry (session ring sanitized)', TAB, 'this.actionHistory.push(stored);', 'this.actionHistory.push(entry);'],
  ['N12', 'cwd outside home stored verbatim', CL, "  return '<dir>';\n}\n\nconst lenTag", "  return cwd;\n}\n\nconst lenTag"],
  ['N13', 'split: U+2028..U+202F not whitespace', BR, '@BS@u2028-@BS@u202f', ''],
  ['N14', 'selector variant allows = anywhere', BR, "const probe = selector ? head.replace(/@BS@[[^@BS@]]*@BS@]?/g, '') : head;", "const probe = selector ? head.replace(/=/g, '') : head;"],
  ['N15', 'skip field: eval preview not redacted', BR, '? evalCodePreview(e.target)', '? capHistoryString(e.target)'],
  ['N16', 'userinfo strip removed', BR, 'head = stripUserinfo(head);', 'head = head;'],
];
const sh = (cmd, args, cwd, t = 600000) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: t, shell: false, windowsHide: true }); return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }; };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tsc = path.join(root, 'node_modules/typescript/bin/tsc'); const vitest = path.join(root, 'node_modules/vitest/vitest.mjs');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const results = [];
for (const [id, desc, rel, ...pairs] of M) {
  if (only && !only.includes(id)) continue;
  const f = path.join(root, rel); const orig = fs.readFileSync(f); const before = sha(f);
  let src = orig.toString('utf8'); let applied = true;
  for (let i = 0; i < pairs.length; i += 2) { const a = U(pairs[i]).split('@Q@').join("''"), b = U(pairs[i + 1]).split('@Q@').join("''"); const n = src.split(a).length - 1; if (n !== 1) { applied = false; break; } src = src.replace(a, () => b); }
  const row = { id, desc, file: rel, applied };
  if (applied) {
    fs.writeFileSync(f, src);
    try {
      const b1 = sh(process.execPath, [tsc, '-p', 'packages/browser'], root); const b2 = sh(process.execPath, [tsc, '-p', 'packages/cli'], root);
      row.build = b1.code === 0 && b2.code === 0 ? 'ok' : 'FAIL ' + strip(b1.out + b2.out).slice(0, 300);
      for (const p of ['browser', 'cli', 'capability-runtime']) {
        const v = sh(process.execPath, [vitest, 'run'], path.join(root, 'packages', p));
        const m = strip(v.out).match(/Tests\s+(.*)/); row['vitest_' + p] = (m ? m[1].trim() : 'no-summary') + ' exit=' + v.code;
        const fails = [...strip(v.out).matchAll(/(?:FAIL|×)\s+(.{0,140})/g)].map((x) => x[1]).slice(0, 3); if (fails.length) row['fail_' + p] = fails;
      }
      const a = sh(process.execPath, [path.join(here, 'attack3.mjs'), root], root);
      row.attack3 = (strip(a.out).match(/cells=.*$/m) ?? ['?'])[0];
      const g = sh(process.execPath, [path.join(here, 'glue-unit.mjs')], root); row.glueLeaks = (strip(g.out).match(/LEAK$/gm) ?? []).length;
    } finally { fs.writeFileSync(f, orig); }
  }
  row.restored = sha(f) === before;
  row.caught = Object.keys(row).some((k) => k.startsWith('vitest_') && !/exit=0/.test(row[k])) || (row.attack3 && !/claimLeaks=7 /.test(row.attack3));
  results.push(row); console.log(JSON.stringify(row));
  fs.writeFileSync(path.join(here, 'mutants3' + (only ? '-' + only.join('_') : '') + '.json'), JSON.stringify(results, null, 1));
}
// rebuild the restored sources so dist matches HEAD again
const r1 = sh(process.execPath, [tsc, '-p', 'packages/browser'], root); const r2 = sh(process.execPath, [tsc, '-p', 'packages/cli'], root);
console.log('final rebuild', r1.code, r2.code);
