const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const TP = 'packages/cli/src/temp-profile.ts';
module.exports = {
  cwd: WT, vitestCwd: 'packages/cli', vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/scan-command-lines.spec.ts'],
  mutants: [
    // the case-sensitive filter restored
    { id: 'M-F2', file: TP, edits: [{ from: 'return lines.filter((l) => l.toLowerCase().includes(TEMP_PROFILE_PREFIX));', to: 'return lines.filter((l) => l.includes(TEMP_PROFILE_PREFIX));' }], mustFail: ['F2-a', 'F2-b'] },
    // S4 probes/mutate.cjs M5 (upper-cased filter), re-anchored on the HEAD text (the S4 anchor no longer exists after S6d)
    { id: 'M5', file: TP, edits: [{ from: 'return lines.filter((l) => l.toLowerCase().includes(TEMP_PROFILE_PREFIX));', to: 'return lines.filter((l) => l.includes(TEMP_PROFILE_PREFIX.toUpperCase()));' }], mustFail: ['F2-a'] },
    // extra: only the Linux /proc path loses the filter
    { id: 'M-F2-linux-unfiltered', file: TP, edits: [{ from: 'return lines === null ? null : keepPrefixed(lines);', to: 'return lines;' }], mustFail: ['F2-c', 'D1:'] },
  ],
};
