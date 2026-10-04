// S10 acceptance checks, re-read live from the files on disk. Exit 1 on any FAIL.
// Usage (from the worktree root): node .ai/loop/release-0.6.1/evidence/S10/check-s10.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const EV = '.ai/loop/release-0.6.1/evidence';
let bad = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); if (!cond) bad++; };
const cl = readFileSync(process.env.S10_CHANGELOG ?? 'docs/22-changelog.md', 'utf-8').replace(/\r\n/g, '\n');
const i0 = cl.indexOf('## [0.6.1] - unreleased');
const i1 = cl.indexOf('## [0.6.0] - 2026-10-03');
const sec = cl.slice(i0, i1);

// S10-1 heading order (inside the 0.6.1 section) and placement under [Unreleased]
const heads = [...sec.matchAll(/^(#{2,3}) (.+)$/gm)].map((m) => m[2]);
ok('S10-1 headings', JSON.stringify(heads) === JSON.stringify(['[0.6.1] - unreleased', 'Security', 'Fixed', 'Changed']), JSON.stringify(heads));
ok('S10-1 order: [Unreleased] < 0.6.1 < 0.6.0', cl.indexOf('## [Unreleased]') < i0 && i0 < i1 && i0 > 0);

// S10-3 GHSA set in the changelog == the S1 shipped set (advisories on a module/version the inventory shows inlined), count 6
const audit = JSON.parse(readFileSync(`${EV}/S1/audit-full.json`, 'utf-8'));
const shipped = new Set();
for (const v of Object.values(audit.advisories ?? {})) {
  if (v.module_name === 'fast-uri' && v.findings.some((f) => f.version === '3.1.5')) shipped.add(v.github_advisory_id.replace(/^GHSA-/, ''));
}
const inCl = new Set([...sec.matchAll(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/g)].map((m) => m[0].slice(5)));
const same = shipped.size === inCl.size && [...shipped].every((g) => inCl.has(g));
ok('S10-3 GHSA set equals S1 shipped set, count 6', same && shipped.size === 6, `S1=${[...shipped].sort().join(',')} changelog=${[...inCl].sort().join(',')}`);
// the S1 inventory says exactly those 6 shipped advisories
const inv = readFileSync(`${EV}/S1/bundle-inventory.txt`, 'utf-8');
ok('S10-3 S1 inventory: shipped advisories: 6', inv.includes('shipped advisories: 6'));

// S10-4 bounds in docs equal the constants
const tp = readFileSync('packages/cli/src/temp-profile.ts', 'utf-8');
const cs = readFileSync('packages/cli/src/close-session.ts', 'utf-8');
const num = (src, name) => Number(src.match(new RegExp(`${name} = ([0-9_]+)(?: \\* ([0-9_]+))?`)).slice(1).filter(Boolean).map((x) => Number(x.replace(/_/g, ''))).reduce((a, b) => a * b));
const KILL = num(cs, 'KILL_CAP_MS'), CLEAN = num(tp, 'CLOSE_CLEANUP_DEADLINE_MS'), SWEEP = num(tp, 'SWEEP_BUDGET_MS'), STALE = num(tp, 'STALE_MIN_AGE_MS');
ok('S10-4 constants', KILL === 10000 && CLEAN === 15000 && SWEEP === 15000 && STALE === 600000, `kill=${KILL} cleanup=${CLEAN} sweep=${SWEEP} stale=${STALE}`);
ok('S10-4 changelog says about 10 s / about 15 s / 15 s sweep / 10 minutes', sec.includes('capped at about 10 s') && sec.includes('about 15 s more') && sec.includes('capped at about 15 s in total') && sec.includes('older than 10 minutes'));
ok('S10-4 p50 source: S7 README', readFileSync(`${EV}/S7/README.md`, 'utf-8').includes('1092 ms (about 1.1 s)') && sec.includes('about 1.1 s in total'));

// S10-5 placeholder check, case-insensitive, exact names
const re = /<(fast_uri|qs|hono|hono_node|ip_address|close_p50|sweep_p50|p50)>/gi;
ok('S10-5 no placeholder left in docs/22-changelog.md', (cl.match(re) ?? []).length === 0);
const tpl = readFileSync(`${EV}/S10/template.txt`, 'utf-8');
ok('S10-5 negative control: template has 7 placeholders (the pattern can match)', (tpl.match(re) ?? []).length === 7);

// S10-2 stale version references
let out = '';
try { out = execFileSync('git', ['grep', '-nE', 'as of 0[.]6[.]0|Status [(]0[.]6[.]0[)]', '--', 'README.md', 'SECURITY.md', 'packages/browser/README.md', 'packages/cli/README.md', 'packages/mcp-server/README.md', 'packages/sutradhar/README.md'], { encoding: 'utf-8' }); } catch (e) { out = e.stdout ?? ''; }
ok('S10-2 no "as of 0.6.0" / "Status (0.6.0)" left', out.trim() === '', out.trim());
ok('S10-2 README heading', readFileSync('README.md', 'utf-8').includes('### Status (0.6.1) and known limitations'));
process.exit(bad ? 1 : 0);
