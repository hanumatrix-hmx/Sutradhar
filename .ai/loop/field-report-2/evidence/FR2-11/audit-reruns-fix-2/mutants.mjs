// AUDIT-2 mutants of redactHistoryText / redactUrlToken / reducePathRun (browser) and redactCliArgs (cli).
// Each mutant: line-based edit of the SOURCE (backslash-free find strings), rebuild the package dist with tsc, run the
// vitest suites of browser, capability-runtime, mcp-server and cli, record killed/survived, restore the ORIGINAL BYTES
// and verify sha256. Usage: node mutants.mjs <repoRoot> [ids,comma-separated]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = process.argv[2];
const only = process.argv[3]?.split(',');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const BR = path.join(root, 'packages/browser/src/session/action-history.ts');
const CL = path.join(root, 'packages/cli/src/history-file.ts');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const lineEdit = (find, fn, offset = 0) => (src) => {
  const L = src.split('\n');
  const idx = L.map((l, i) => (l.includes(find) ? i : -1)).filter((i) => i >= 0);
  if (idx.length !== 1) throw new Error(`find "${find}" matched ${idx.length} lines`);
  const i = idx[0] + offset;
  const before = L[i];
  L[i] = fn(L[i]);
  if (L[i] === before) throw new Error(`edit of line ${i + 1} was a no-op`);
  return L.join('\n');
};
const rep = (a, b) => (l) => l.split(a).join(b);
const MUTANTS = [
  ['B1', BR, 'userinfo: LAST @ -> FIRST @ (password containing @ keeps its tail)', lineEdit('const at = authority.lastIndexOf', rep('lastIndexOf', 'indexOf'))],
  ['B2', BR, 'QUERY_LIKE requires a non-empty key (bare ?=S no longer a marker)', lineEdit('const QUERY_LIKE = /', rep(']*=/;', ']+=/;'))],
  ['B3', BR, 'SCHEMELESS_HOST loses the localhost alternative', lineEdit('const SCHEMELESS_HOST', rep('(?:localhost|', '(?:'), 1)],
  ['B4', BR, 'SCHEMELESS_HOST loses the [IPv6] alternative', lineEdit('const SCHEMELESS_HOST', rep('0-9A-Fa-f:.]+', '0-9A-Fa-f:.]+NOPE'), 1)],
  ['B5', BR, 'no swallowing of following tokens after a URL cut', lineEdit('const r = redactUrlToken(tok, url);', rep('swallowing = r.cut;', 'swallowing = false;'), 2)],
  ['B6', BR, 'a path run never extends across spaces', lineEdit('if (HAS_SEP.test(tk)) last = j;', rep('last = j;', 'last = last;'))],
  ['B7', BR, 'WIN_DRIVE_PATH not recognised after a quote or ( ', lineEdit('const WIN_DRIVE_PATH', rep('(?<![A-Za-z0-9])', `(?<![A-Za-z0-9'"(])`))],
  ['B13', BR, 'ENCODED_SCHEME only upper-case %2F', lineEdit('const ENCODED_SCHEME', rep('(?:%2[Ff]){2}', '(?:%2F){2}'))],
  ['B8', CL, 'dialog prompt text stored redacted-but-raw instead of a length', lineEdit("case 'eval':", rep("lenTag(args.slice(1).join(' '))", "fin(args.slice(1).join(' '))"), 3)],
  ['B9', CL, 'download dir arg no longer <dir> (text rule only)', lineEdit('const DIR_ARG_INDEXES', rep('download: [1], ', ''))],
  ['B10', CL, 'nav arg no longer through redactHistoryUrl (text rule only)', lineEdit('const URL_ARG_INDEXES', rep('nav: [0], ', ''))],
];
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: true, timeout: 600000, env: process.env });
const tscBuild = (pkg) => run('npx', ['tsc', '-p', '.'], path.join(root, 'packages', pkg));
const vitest = (pkg) => {
  const r = run(path.join(root, 'node_modules/.bin/vitest'), ['run', '--globals'], path.join(root, 'packages', pkg));
  const txt = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const tests = /Tests\s+(.*)/.exec(txt)?.[1]?.trim();
  const failing = [...txt.matchAll(/ FAIL \s*(\S+) > ([^\n]*)/g)].map((m) => m[1] + ' > ' + m[2]).slice(0, 4);
  return { status: r.status, tests, failing };
};
const results = [];
const orig = { [BR]: fs.readFileSync(BR), [CL]: fs.readFileSync(CL) };
const origSha = { [BR]: sha(BR), [CL]: sha(CL) };
try {
  for (const [id, file, desc, edit] of MUTANTS) {
    if (only && !only.includes(id)) continue;
    const t0 = Date.now();
    const mutated = edit(orig[file].toString('utf8'));
    fs.writeFileSync(file, mutated);
    const pkg = file === BR ? 'browser' : 'cli';
    const b = tscBuild(pkg);
    const res = { id, file: path.relative(root, file), desc, build: b.status };
    if (b.status === 0) {
      for (const p of ['browser', 'capability-runtime', 'mcp-server', 'cli']) res[p] = vitest(p);
    } else res.buildErr = (b.stdout + b.stderr).slice(0, 400);
    res.killed = res.build !== 0 || ['browser', 'capability-runtime', 'mcp-server', 'cli'].some((p) => res[p] && res[p].status !== 0);
    fs.writeFileSync(file, orig[file]);
    res.restoredShaOk = sha(file) === origSha[file];
    res.sec = Math.round((Date.now() - t0) / 1000);
    results.push(res);
    console.log(id, res.killed ? 'KILLED' : 'SURVIVED', desc, JSON.stringify({ b: res.browser?.tests, c: res.cli?.tests, fb: res.browser?.failing?.[0], fc: res.cli?.failing?.[0] }), 'restored', res.restoredShaOk);
    fs.writeFileSync(path.join(here, 'mutants.json'), JSON.stringify({ origSha, results }, null, 1));
  }
} finally {
  for (const f of [BR, CL]) fs.writeFileSync(f, orig[f]);
  console.log('final restore sha ok:', sha(BR) === origSha[BR], sha(CL) === origSha[CL]);
  tscBuild('browser'); tscBuild('cli');
}
