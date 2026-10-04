const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const TP = 'packages/cli/src/temp-profile.ts';
const RECHECK = "    if (!(await realDirectory(dir))) {\n      dlog('rm-stop', { path: dir, n, reason: 'not-a-directory' });\n      return { removed: false, error: 'not-a-directory' };\n    }\n";
module.exports = {
  cwd: WT, vitestCwd: 'packages/cli', vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/temp-profile.spec.ts'],
  mutants: [
    { id: 'M-F1a', file: TP, edits: [{ from: 'return !st.isSymbolicLink() && st.isDirectory();', to: 'return true;' }], mustFail: ['F1-a', 'F1-c'] },
    { id: 'M-F1b', file: TP, edits: [{ from: '    const st = await lstat(dir);', to: '    const st = await stat(dir);' }], mustFail: ['F1-a'] },
    { id: 'M-F1c', file: TP, edits: [
      { from: RECHECK, to: '' },
      { from: 'const realDir = await realDirectory(dir);\n  if (!realDir) {', to: 'const realDir = true as boolean;\n  if (!realDir) {' } ], mustFail: ['F1-a'] },
    // extras (not in the plan's list)
    { id: 'M-F1c2-recheck-only', file: TP, edits: [{ from: RECHECK, to: '' }], mustFail: ['F1-e'] },
    { id: 'M-F1d-order', file: TP, edits: [{ from: "  if (f.realDir === false) return { remove: false, reason: 'not-a-directory' };\n  if (f.commandLines === null) return { remove: false, reason: 'scan-unavailable' };", to: "  if (f.commandLines === null) return { remove: false, reason: 'scan-unavailable' };\n  if (f.realDir === false) return { remove: false, reason: 'not-a-directory' };" }], mustFail: ['decideRemoval: realDir === false'] },
  ],
};
