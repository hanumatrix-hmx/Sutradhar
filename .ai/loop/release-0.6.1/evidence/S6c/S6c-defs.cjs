const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const SC = 'packages/cli/src/spawn-chrome.ts';
const SS = 'packages/cli/src/spawn-session.ts';
const SPEC = 'packages/cli/tests/unit/spawn-failure-cleanup.spec.ts';
module.exports = {
  cwd: WT,
  vitestCwd: 'packages/cli',
  vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/spawn-failure-cleanup.spec.ts'],
  mutants: [
    { id: 'M-G1', file: SC, edits: [{ from: '    await discard();\n    throw new Error(`Failed to spawn Chrome (', to: '    throw new Error(`Failed to spawn Chrome (' }], mustFail: ['G1 '] },
    { id: 'M-G2', file: SC, edits: [{ from: '    await discard();\n    await new Promise<void>((r) => setImmediate(r));', to: '    await new Promise<void>((r) => setImmediate(r));' }], mustFail: ['G2 '] },
    { id: 'M-G3', file: SC, edits: [{ from: '  await discard(pid, true);', to: '' }], mustFail: ['G3 (P2)'] },
    { id: 'M-G4', file: SC, edits: [{ from: 'await discard(pid, false);', to: 'await discard(pid, true);' }], mustFail: ['G4 '] },
    { id: 'M-G5', file: SS, edits: [{ from: '      await discard(spawned);', to: '      void discard(spawned);' }], mustFail: ['G5: order'] },
    { id: 'M-seam', file: SC, edits: [{ from: 'createTempProfileDir(deps.tmpRoot)', to: 'createTempProfileDir()' }], mustFail: ['G1 '] },
    { id: 'M-G6', file: SC, edits: [{ from: 'killed ? target.pid : undefined', to: 'undefined' }], mustFail: ['G3b'] },
    { id: 'M-G7', file: SC, edits: [{ from: '        isAlive: deps.isAlive,\n', to: '' }], mustFail: ['G3 (P2)'] },
    { id: 'M-G8', file: SPEC, edits: [{ from: '      ...opts,\n      tmpRoot,\n      scan: async () => [],', to: '      tmpRoot,\n      scan: async () => [],' }], mustFail: ['G3 (P2)'] },
  ],
};
