const SP = 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const TP = 'packages/cli/src/temp-profile.ts';
module.exports = {
  cwd: WT,
  vitestCwd: 'packages/cli',
  vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/temp-profile.spec.ts', 'tests/unit/system-binaries.spec.ts', 'tests/unit/help-text.spec.ts'],
  mutants: [
    { id: 'M-a', file: TP, edits: [{ from: 'runScan(opts.scan ?? scanCommandLines, scanMs), 0, isAlive)', to: 'runScan(opts.scan ?? scanCommandLines, 20_000), 0, isAlive)' }], mustFail: ['T1:', 'T4:'] },
    { id: 'M-b', file: TP, edits: [{ from: 'if (remaining < MIN_RM_START_MS) {', to: 'if (remaining < 0) {' }], mustFail: ['T5:'] },
    { id: 'M-c', file: TP, edits: [
      { from: 'const deadline = t0 + (opts.budgetMs ?? SWEEP_BUDGET_MS);', to: 'let deadline = t0 + (opts.budgetMs ?? SWEEP_BUDGET_MS);' },
      { from: 'const commandLines = await runScan(opts.scan ?? scanCommandLines, scanMs);', to: 'const commandLines = await runScan(opts.scan ?? scanCommandLines, scanMs); deadline = performance.now() + (opts.budgetMs ?? SWEEP_BUDGET_MS);' } ], mustFail: ['T3:'] },
    { id: 'M-d', file: TP, edits: [{ from: "dlog('decision', { path: dir, ", to: "dlog('decision', { ", all: true }], mustFail: ['T6:'] },
    { id: 'M-e', file: TP, edits: [{ from: '  return lines;', to: '  return lines ?? [];' }], mustFail: ['T8:'] },
    { id: 'M-f', file: TP, edits: [{ from: 'export function isAutoTempProfileDir(dir: string, tmpRoot: string): boolean {', to: "export function isAutoTempProfileDir(dir: string, tmpRoot: string): boolean {\n  dlog('consider', { path: dir });" }], mustFail: ['T6b:'] },
    // extra mutants for the additional S6a tests (not in the plan's list of six)
    { id: 'M-exitclamp', file: TP, edits: [{ from: 'Math.max(0, Math.min(cap, left))', to: 'cap' }], mustFail: ['A.4:'] },
    { id: 'M-isalive', file: TP, edits: [{ from: 'ownerAlive: ownerPid !== undefined && isAlive(ownerPid),', to: 'ownerAlive: ownerPid !== undefined && isPidAlive(ownerPid),' }], mustFail: ['isAlive seam:'] },
    { id: 'M-sysroot', file: 'packages/cli/src/system-binaries.ts', edits: [
      { from: 'function systemRoot(): string {\n  const v = process.env.SystemRoot;', to: 'const CACHED = process.env.SystemRoot;\nfunction systemRoot(): string {\n  const v = CACHED;' } ], mustFail: ['reads SystemRoot on every call'] },
    { id: 'M-helptext', file: 'packages/cli/src/cli.ts', edits: [{ from: '  SUTRADHAR_CLI_DEBUG_CLEANUP       Diagnostics:', to: '  SUTRADHAR_CLI_NOTHING            Diagnostics:' }], mustFail: ['T7:'] },
  ],
};
