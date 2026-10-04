// S6g mutants (B.1 S6g AC3 + F2 + F7). Runner: S6b mutrun.cjs (CRLF-aware, sha256 before/after, restore in finally).
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const CS = 'packages/cli/src/close-session.ts';
const CLI = 'packages/cli/src/cli.ts';
const THROW = '\n  if (clearFailed) throw clearError;\n}';
module.exports = {
  cwd: WT,
  vitestCwd: 'packages/cli',
  vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/close-session.spec.ts'],
  mutants: [
    { id: 'M-B2a-swallow', file: CS, edits: [{ from: THROW, to: '\n}' }], mustFail: ['G6g-1', 'G6g-3', 'G6g-4', 'G6g-5', 'G6g-6'] },
    { id: 'M-B2a-old-warn', file: CS, edits: [{ from: THROW, to: '\n  if (clearFailed) warn(`Warning: could not clear the session state (${msg(clearError)}); run "sutradhar close" again if the next command misbehaves.`);\n}' }], mustFail: ['G6g-1'] },
    { id: 'M-B2b-rethrow-before-cleanup', file: CS, edits: [
      { from: THROW, to: '\n}' },
      { from: '\n  const dir: unknown = state.userDataDir;', to: '\n  if (clearFailed) throw clearError;\n  const dir: unknown = state.userDataDir;' } ], mustFail: ['G6g-1', 'G6g-1b'] },
    { id: 'M-B2c-wrapped-error', file: CS, edits: [{ from: '  if (clearFailed) throw clearError;', to: '  if (clearFailed) throw new Error(msg(clearError));' }], mustFail: ['G6g-1', 'G6g-3', 'G6g-4', 'G6g-5', 'G6g-6'] },
    { id: 'M-B2d-selfheal-dot-catch', file: CLI, edits: [{ from: '      await stopSpawnedChrome(state, sessionStopDeps());\n      return spawnFreshSession', to: '      await stopSpawnedChrome(state, sessionStopDeps()).catch(() => {});\n      return spawnFreshSession' }], mustFail: ['O6b', 'self-heal'] },
    { id: 'M-B2e-cmdClose-dot-catch', file: CLI, edits: [{ from: '    await stopSpawnedChrome(state, sessionStopDeps());\n  } else {', to: '    await stopSpawnedChrome(state, sessionStopDeps()).catch(() => {});\n  } else {' }], mustFail: ['O6b', 'cmdClose'] },
    { id: 'M-B2d2-selfheal-try-catch', file: CLI, edits: [{ from: '      await stopSpawnedChrome(state, sessionStopDeps());\n      return spawnFreshSession', to: '      try {\n        await stopSpawnedChrome(state, sessionStopDeps());\n      } catch {}\n      return spawnFreshSession' }], mustFail: ['O6b', 'self-heal'] },
    { id: 'M-B2e2-cmdClose-try-catch', file: CLI, edits: [{ from: '    await stopSpawnedChrome(state, sessionStopDeps());\n  } else {', to: '    try {\n      await stopSpawnedChrome(state, sessionStopDeps());\n    } catch {}\n  } else {' }], mustFail: ['O6b', 'cmdClose'] },
    { id: 'M-B2f1-rethrow-cleanup-error', file: CS, edits: [{ from: 'will retry it.`);\n    }\n  }\n', to: 'will retry it.`);\n      throw err;\n    }\n  }\n' }], mustFail: ['G6g-3', 'O3'] },
    { id: 'M-B2f2-skip-rethrow-when-cleanup-fails', file: CS, edits: [{ from: 'will retry it.`);\n    }\n  }\n', to: 'will retry it.`);\n      clearFailed = false;\n    }\n  }\n' }], mustFail: ['G6g-3'] },
    { id: 'M-B2g-rethrow-only-with-tempProfile', file: CS, edits: [
      { from: THROW, to: '\n}' },
      { from: 'will retry it.`);\n    }\n  }\n', to: 'will retry it.`);\n    }\n    if (clearFailed) throw clearError;\n  }\n' } ], mustFail: ['G6g-4'] },
    { id: 'M-B2h-extra-warning-line', file: CS, edits: [{ from: '  if (clearFailed) throw clearError;', to: '  if (clearFailed) {\n    warn(`Warning: could not clear the session state (${msg(clearError)})`);\n    throw clearError;\n  }' }], mustFail: ['G6g-1'] },
    { id: 'M-B2i-state-cleared-logged-on-failure', file: CS, edits: [{ from: '    await deps.clearState();\n    debug(\'[cleanup] state-cleared\');', to: '    debug(\'[cleanup] state-cleared\');\n    await deps.clearState();' }], mustFail: ['G6g-1'] },
    { id: 'M-B2j-kill-error-escalated', file: CS, edits: [{ from: '      debug(`[cleanup] kill-error message=${JSON.stringify(msg(err))}`);', to: '      throw err;' }], mustFail: ['failing kill never throws'] },
  ],
};
