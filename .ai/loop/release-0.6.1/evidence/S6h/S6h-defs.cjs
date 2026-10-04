// S6h mutants for T5 (F-S8-4). Runner: S6b mutrun.cjs (CRLF-aware, sha256 before/after, restore in finally).
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const TP = 'packages/cli/src/temp-profile.ts';
module.exports = {
  cwd: WT, vitestCwd: 'packages/cli', vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/temp-profile.spec.ts'],
  mutants: [
    { id: 'M-b', file: TP, edits: [{ from: '    if (remaining < MIN_RM_START_MS) {', to: '    if (remaining < 0) {' }], mustFail: ['T5:'] },
    { id: 'M-b2-half-threshold', file: TP, edits: [{ from: '    if (remaining < MIN_RM_START_MS) {', to: '    if (remaining < MIN_RM_START_MS / 2) {' }], mustFail: ['T5:'] },
    { id: 'M-b3-constant-100', file: TP, edits: [{ from: 'export const MIN_RM_START_MS = 1_000;', to: 'export const MIN_RM_START_MS = 100;' }], mustFail: ['exports the seven constants'] },
    { id: 'M-b4-no-attempt-log', file: TP, edits: [{ from: "    dlog('rm-attempt', { path: dir, n, 'remaining-ms': Math.round(remaining) });", to: '' }], mustFail: ['T5:'] },
    // Behaviour-preserving "loaded runner" simulation (NOT a bug): 80 ms of extra latency between the module's deadline check and the
    // fake's own clock reading. The OLD T5 (975 ms threshold on the fake's reading) must FAIL on it, the NEW T5 must PASS.
    { id: 'LOAD-SIM-80ms-gap', file: TP, edits: [{ from: "    dlog('rm-attempt', { path: dir, n, 'remaining-ms': Math.round(remaining) });", to: "    dlog('rm-attempt', { path: dir, n, 'remaining-ms': Math.round(remaining) });\n    await new Promise((r) => setTimeout(r, 80));" }], mustFail: [] },
  ],
};
