const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const TP = 'packages/cli/src/temp-profile.ts';
// S4's probes/mutate.cjs definitions M1..M6, applied to HEAD's temp-profile.ts. Anchors re-written where HEAD's text moved
// (M2: `rmFn` seam; M5: the filter lives in keepPrefixed and is case-insensitive since S6e-2). The whole cli unit suite runs under each mutant.
module.exports = {
  cwd: WT, vitestCwd: 'packages/cli', vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: [],
  mutants: [
    { id: 'M1_null_scan_fail_open', file: TP, edits: [{ from: "if (f.commandLines === null) return { remove: false, reason: 'scan-unavailable' };", to: 'if (f.commandLines === null) return { remove: true };' }], mustFail: [] },
    { id: 'M2_no_win_lockfile_probe', file: TP, edits: [{ from: "await rmFn(path.join(dir, 'lockfile'), { force: true });", to: '/* lockfile probe removed */' }], mustFail: ['N4-a'] },
    { id: 'M3_owner_alive_ignored', file: TP, edits: [{ from: "if (f.ownerAlive) return { remove: false, reason: 'owner-alive' };", to: '/* owner check removed */' }], mustFail: [] },
    { id: 'M4_age_ignored', file: TP, edits: [{ from: 'if (f.minAgeMs > 0 && f.ageMs < f.minAgeMs)', to: 'if (false)' }], mustFail: [] },
    { id: 'M5_scan_case_sensitive_kept', file: TP, edits: [{ from: 'return lines.filter((l) => l.toLowerCase().includes(TEMP_PROFILE_PREFIX));', to: 'return lines.filter((l) => l.includes(TEMP_PROFILE_PREFIX.toUpperCase()));' }], mustFail: ['F2-a'] },
    { id: 'M6_no_root_check', file: TP, edits: [{ from: 'return norm(path.dirname(dir)) === norm(tmpRoot);', to: 'return true;' }], mustFail: [] },
  ],
};
