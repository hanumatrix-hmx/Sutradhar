// S10b: appends the 0.6.1 follow-up gap rows to .ai/loop/field-report-2/gaps.md and updates the GAP-315 row.
// Numbers: master's last gap is GAP-357, but GAP-358..GAP-378 are already used by the held FR2-11 branch
// (claude/fr2-11-action-history, 339..378), so new rows start at GAP-379 and never collide with either.
// Usage (from the worktree root): node .ai/loop/release-0.6.1/evidence/S10b/add-gaps.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = '.ai/loop/field-report-2/gaps.md';
const raw = readFileSync(FILE, 'utf-8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
if (!s.endsWith('\n')) s += '\n';
const START = 379;
const have = [...s.matchAll(/^\| GAP-(\d+) /gm)].map((m) => Number(m[1]));
if (Math.max(...have) >= START) throw new Error('numbers >= 379 already present');

const EV = 'release-0.6.1/evidence';
const rows = [
  ['0.6.1 S10b', 'minor, test coverage',
    '`packages/mcp-server` and `packages/dev-runtime` have no `test` script, so `turbo run test` (CI) never runs their vitest suites (mcp-server: 5 files / 156 tests including `tools.spec.ts`, which pins the tool count; dev-runtime: 1 file / 4 tests). The 0.6.1 matrix and the S11 gate ran them directly with `vitest run --globals`. Fix: add `"test": "vitest run --globals"` to both packages.',
    'OPEN', '-'],
  ['0.6.1 S10b', 'minor, release hygiene',
    'There is no CI guard against advisories that reach the published bundles. 0.6.1 found `fast-uri` 3.1.5 (6 advisories) inlined in `dist/mcp-cli.js` only through a manual inventory (`' + EV + '/S1/bundle-inventory.mjs`: esbuild metafile x `pnpm audit --json`; used as the S11 gate). Fix: run that inventory in CI and fail on any shipped advisory.',
    'OPEN', '-'],
  ['0.6.1 S10b (GAP-315)', 'minor, documented',
    'One `rm` that has already started cannot be cancelled (Node has no cancellation for an in-flight fs call). The cleanup deadline (close 15 s, sweep 15 s) is therefore the deadline plus the time of one directory delete; a very large or slow profile dir can make `close` or the first command of a session run past the stated bound. No delete starts with under 1 s left. Documented in the CLI README.',
    'OPEN (documented)', '-'],
  ['0.6.1 S3b', 'info, dev/test only',
    'Dev-only advisories that remain after 0.6.1 (none ships, see `' + EV + '/S3a/inventory-vs-NEW-audit.txt`: shipped advisories 0): vitest (critical, GHSA-5xrq-8626-4rwp), vite x3, esbuild via vite (all need a major toolchain upgrade) and braces (GHSA-vfj7-8cjw-p6xm, no fix exists). The three fixable in range (brace-expansion, js-yaml, nanoid) were refreshed in 0.6.1 (S3b kept).',
    'OPEN (deferred)', '-'],
  ['0.6.1 S10b (GAP-315)', 'minor, documented',
    'The Windows `lockfile` check (rule 5) has no POSIX equivalent: on Linux/macOS a live Chrome is detected only by the process scan (`/proc` on Linux, `ps -ww` on macOS) and the owner PID. The scan also cannot see other users\' or elevated processes (audit N5, accepted); those cases rely on the owner-PID check (EPERM counts as alive) and, on Windows, the lock file. Documented in the CLI README limitations.',
    'OPEN (documented)', '-'],
  ['0.6.1 S10b (GAP-349)', 'minor, test coverage',
    'There is no deterministic live trigger for GAP-349 path F8 (attach/setViewport failure after spawn) nor for P2 (start timeout while the child is alive); both are covered only by unit tests with seams (G5, G3, G3b; `' + EV + '/S6c`). The live harness (`' + EV + '/S7`) covers P0 (EFTYPE) and P2x (child exits 9).',
    'OPEN (unit-only)', '-'],
  ['0.6.1 S10b', 'minor, not executed',
    'Not executed for 0.6.1: macOS (any), and real Chrome on Linux (the Linux evidence is WSL Node 20 at module/unit level with no Chrome). Recommended before publishing: `workflow_dispatch` of `scenario-suite.yml` on `release/0.6.1`; in the CLI step log check that every `close` exits 0, that no `Warning: could not remove temp profile` line repeats across sessions, and that the runner\'s TEMP holds no `sutradhar-cli-*` dirs.',
    'OPEN (not executed)', '-'],
  ['0.6.1 S10b (S7 timing)', 'info',
    'Scan timing margin. `SCAN_TIMEOUT_MS` is 8 s and the sweep/close budgets are 15 s, but the live maxima were measured on a healthy run only (S7: scan p50 495 ms, max 574 ms; S8b: max 583 ms; whole `close` p50 about 1.1 s). A scan that times out under a heavily loaded machine yields `scan-unavailable` and the directory is KEPT (a leak, never a loss); the cap paths themselves are unit-tested (T1-T5) but not reachable live. Re-measure under load if leaks are reported.',
    'OPEN (documented)', '-'],
  ['0.6.1 S10b (pre-existing, plan 1.5, S8b-2)', '**wrong kill**, pre-existing in master/0.6.0, not widened by 0.6.1',
    '`close` and CLI self-heal run `killChromeTree(state.chromePid)` blindly on the recorded PID. A `state.json` that outlives its Chrome (reboot, crash) therefore kills whatever unrelated process now holds that PID. 0.6.1 keeps these kill semantics (same `taskkill /T /F` or `process.kill(-pid)`) and only changes the order (kill, then clear state, then bounded cleanup), which removes the GAP-315 window in which a slow cleanup kept the PID. **A failed state clear leaves `chromePid` recorded (as in 0.6.0):** live A/B in `' + EV + '/S8b/ab/compare.txt`: 0.6.0 and HEAD both exit 1 with `Fatal: EBUSY ... state.json`, `state.json` still records the (already killed) PID, and the next command\'s self-heal re-kills it. Fix: the 0.7.0 close/recovery redesign (ownership verification before any kill; plan section 10, requirements R-1..R-10).',
    'OPEN (deferred to 0.7.0)', '-'],
  ['0.6.1 S10b', 'info, not testable here',
    '8.3 short-name TEMP paths (for example `C:\\PROGRA~1`) could not be tested: this volume (E:) has no 8.3 names and the isolated TEMP must live under the scratchpad on E:. The cleanup compares normalised long paths; a short-name TEMP is untested.',
    'OPEN (not testable here)', '-'],
  ['0.6.1 S10b (GAP-315 audit N1)', 'minor, leak not loss',
    'A `sutradhar-cli-*` directory whose `.sutradhar-owner.json` is present but unreadable or corrupt is classified `owner-unknown` and KEPT forever: no sweep or close removes it (fail closed, S6e-4). That is a permanent leak of one profile dir (50-100+ MB) per corrupted marker, never a deletion of something in use. Remedy today: delete it by hand (documented in the CLI README). A later release could add an age-gated removal that also requires a successful scan and the Windows lock check.',
    'OPEN (documented)', '-'],
  ['0.6.1 S10b (GAP-315 audit N7)', 'minor, leak not loss',
    'If the PID recorded in a directory\'s owner marker is reused by an unrelated live process, rule 3 sees an "alive owner" and the directory is kept for as long as that PID lives. It fails in the safe direction (a leak). Verifying PID ownership is part of the 0.7.0 redesign (plan section 10).',
    'OPEN (deferred to 0.7.0)', '-'],
  ['0.6.1 S10b (S6e-1 note 3)', 'info, cosmetic',
    'A candidate directory that vanishes between the fact gathering and the delete (another session removed it) now yields `{removed:false, reason:\'not-a-directory\'}` instead of `removed:true`, so `close` prints a spurious `Warning: could not remove temp profile ... (not-a-directory)` in that rare race. Never a loss; left as specified (`' + EV + '/S6e-1/README.md`, deviation 3).',
    'OPEN (cosmetic)', '-'],
  ['0.6.1 S10b (S8 F-S8-3)', 'info, test discrimination',
    'The live `win-plant` probe\'s second PLANT check ("in-use stand-in dir kept") also passes under mutant M-F3 (bare `powershell.exe`): a hung planted binary makes the scan `null`, so `close` keeps the dir for the wrong reason. Only the first PLANT check (scan unaffected, took ms) discriminates. Strengthen the second check so that it fails when the planted binary is executed (`' + EV + '/S8/audit.md`, F-S8-3).',
    'OPEN (test only)', '-'],
  ['0.6.1 S10b (S8 F-S8-5)', 'info, behaviour note',
    'Start-up now fails fast: the `spawnDetachedChrome` start loop stops as soon as the child exits (P2x), with `Chrome exited (code N) before it was ready`, instead of polling the 10 s start window. A launcher stub that hands off to another process and exits (not observed for Chrome or Edge with a fresh profile; possible with wrapper scripts or snap/flatpak launchers via `CHROME_PATH`) would now fail at once instead of succeeding when the endpoint comes up. Noted in the 0.6.1 changelog (Changed). Verify with a real wrapper launcher on Linux before widening support.',
    'OPEN (documented)', '-'],
  ['0.6.1 S10b (S8 F-S8-6, S8b-5)', 'info, harness',
    'The unmodified S4 live probe `win-browser.mjs` cannot keep `--user-data-dir` at or under the plan\'s 200-character limit (P5) under the scratchpad (205 chars in S8b, 213 in S4); Chrome 154 and Edge 154 still started normally in all four modes. Give the probe a short-ISO parameter or shorten the scratchpad prefix if it is re-run.',
    'OPEN (harness)', '-'],
  ['0.6.1 S10b (S8b-1)', 'info, release tooling',
    '`scripts/check-release-ready.mjs` fails a package whose dist is older than the newest mtime under its own src. The S6h mutation runs rewrote `temp-profile.ts` (apply, then restore with identical content, sha256 `346572f5...` unchanged since `4f26526`), making it newer than the dist although the dist was byte-identical to a rebuild of HEAD (S8b `dist-freshness.txt`). An mtime-only freshness gate can flag that falsely (a rebuild clears it, as in S11). Fix: compare content hashes, or have mutation tooling restore mtimes.',
    'OPEN (tooling)', '-'],
  ['0.6.1 S10b (S8b-3)', 'info, accepted',
    '`system-binaries.ts` builds the absolute paths of `powershell.exe`, `taskkill.exe` and `ps` from `%SystemRoot%` read at call time; a relative or attacker-chosen `SystemRoot` would defeat the "absolute system path" property. Not a privilege boundary: whoever controls the CLI\'s environment already controls `NODE_OPTIONS` and `PATH`. A hardening option would be to ignore a non-absolute `SystemRoot`.',
    'OPEN (accepted, documented)', '-'],
  ['0.6.1 S10b (S8b-4)', 'info, test robustness',
    'The deterministic T5 (`temp-profile.spec.ts`, asserts each logged `rm-attempt remaining-ms` is at least `MIN_RM_START_MS`) can still fail if more than about 1 s of latency lands before the FIRST rm attempt (it then sees zero attempts). A generous bound rather than a tight threshold; mutant M-b detection relies on the third attempt landing in [0,1000) ms. Recorded by S6h and S8b.',
    'OPEN (documented)', '-'],
  ['0.6.1 S10b (plan section 10)', 'major, deferred design',
    'Deferred to 0.7.0: the close/recovery redesign removed from 0.6.1 by the orchestrator\'s scope decision: graceful CDP `Browser.close` through the session\'s own endpoint, kill only after the PID is positively verified as ours (Windows CIM ProcessId and CommandLine, Linux `/proc/<pid>/cmdline`, macOS `ps -ww`), keep and report an unverifiable PID, a separate store for unverified entries, and a documented close exit code. Starting requirements R-1..R-10 and the measurements already taken are in `.ai/loop/release-0.6.1/plan.md` section 10; it needs its own audit counter. Fixes the wrong-kill gap above and the marker-PID-reuse leak.',
    'OPEN (deferred to 0.7.0)', '-'],
];

let n = START;
const lines = rows.map(([item, sev, desc, status, fixed]) => `| GAP-${n++} | ${item} | ${sev} | ${desc} | ${status} | ${fixed} |`);
s += lines.join('\n') + '\n';

// GAP-315 row: record the 0.6.1 audit outcome (S8 ACCEPT update was owed by plan S8; written here, with S10b).
const old = '| DONE | GAP-315-fix |';
const rowStart = s.indexOf('| GAP-315 | FR2-07 run-1 |');
const rowEnd = s.indexOf('\n', rowStart);
const row = s.slice(rowStart, rowEnd);
if (rowStart < 0 || !row.endsWith(old)) throw new Error('GAP-315 row tail not as expected');
const add = '0.6.1 (release/0.6.1): merged with a 15 s overall cleanup deadline, a path-logging debug seam, absolute system-binary paths, a case-insensitive scan filter, an lstat guard, fail-closed owner markers and the close order kill -> clear state -> bounded cleanup (a failed state clear still fails the command as in 0.6.0). Independently audited three times (S4 REOPEN, S8 REOPEN, S8b ACCEPT); evidence `release-0.6.1/evidence/S4`, `S8`, `S8b`; follow-ups GAP-' + START + '..GAP-' + (START + rows.length - 1) + '. |';
const newRow = row.slice(0, row.length - old.length) + add.replace(/ \|$/, ' ') + '| DONE | GAP-315-fix; release-0.6.1/evidence/S8b |';
s = s.slice(0, rowStart) + newRow + s.slice(rowEnd);

writeFileSync(FILE, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log(`appended ${rows.length} rows GAP-${START}..GAP-${n - 1}; crlf=${crlf}`);
