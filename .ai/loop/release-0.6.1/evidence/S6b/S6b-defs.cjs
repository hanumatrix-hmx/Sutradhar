const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const CS = 'packages/cli/src/close-session.ts';
const CLI = 'packages/cli/src/cli.ts';
const TP = 'packages/cli/src/temp-profile.ts';
module.exports = {
  cwd: WT,
  vitestCwd: 'packages/cli',
  vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/close-session.spec.ts', 'tests/unit/temp-profile.spec.ts'],
  mutants: [
    { id: 'M-O1', file: CS, edits: [
      { from: '    await deps.clearState();', to: '    await Promise.resolve();' },
      { from: 'export async function stopSpawnedChrome(state: CliState, deps: StopDeps): Promise<void> {', to: 'export async function stopSpawnedChrome(state: CliState, deps: StopDeps): Promise<void> {\n  try { await stopImpl(state, deps); } finally { await deps.clearState().catch(() => {}); }\n}\nasync function stopImpl(state: CliState, deps: StopDeps): Promise<void> {' } ], mustFail: ['O1:', 'O2:'] },
    { id: 'M-O2', file: CS, edits: [{ from: 'await deps.kill(pid, KILL_CAP_MS);', to: 'void deps.kill(pid, KILL_CAP_MS);' }], mustFail: ['O1:'] },
    { id: 'M-O3', file: CS, edits: [{ from: "      warn(`Warning: temp profile cleanup failed (${msg(err)}); a CLI session started 10 or more minutes from now will retry it.`);", to: '      throw err;' }], mustFail: ['O3:'] },
    { id: 'M-O4a-default', file: CS, edits: [{ from: 'const now = deps.now ?? (() => performance.now());', to: 'const now = deps.now ?? (() => Date.now());' }], mustFail: ['O8:'] },
    { id: 'M-O4b-wiring', file: CLI, edits: [{ from: '    now: () => performance.now(),', to: '    now: Date.now,' }], mustFail: ['O6:'] },
    { id: 'M-O5', file: CLI, edits: [{ from: '    await stopSpawnedChrome(state, sessionStopDeps());\n  } else {', to: '    await stopSpawnedChrome(state, sessionStopDeps());\n    await clearState();\n  } else {' }], mustFail: ['(a)'] },
    { id: 'M-O6', file: CLI, edits: [
      { from: '    await clearState(); // still runs for BOTH no-chromePid paths, including dialog-blocked (legacy state files)', to: '' },
      { from: '        await runtime.shutdown(sessionId);\n      } catch {\n        // Already gone', to: '        await runtime.shutdown(sessionId);\n        await clearState();\n      } catch {\n        // Already gone' } ], mustFail: ['(b)'] },
    { id: 'M-O7', file: CS, edits: [
      { from: "if (typeof dir === 'string' && state.tempProfile === true) {", to: 'if (state.tempProfile === true) {' },
      { from: "const pid = typeof rawPid === 'number' && Number.isInteger(rawPid) && rawPid > 0 ? rawPid : undefined;", to: 'const pid = state.chromePid as number | undefined;' } ], mustFail: ['O9:', 'O10:'] },
    { id: 'M-T10', file: TP, edits: [{ from: "    dlog('scan-error', { message: errMessage(err) });", to: '    throw err;' }], mustFail: ['T10:'] },
    // extras for the other N2 behaviours
    { id: 'M-T9', file: TP, edits: [{ from: "    if (typeof dir !== 'string') return { removed: false, reason: 'not-auto-temp' }; // hand-corrupted state.json", to: '' }], mustFail: ['T9:'] },
    { id: 'M-N2-close-catch', file: TP, edits: [{ from: "    return { removed: false, reason: 'error' };", to: '    throw err;' }], mustFail: ['an unexpected internal error becomes'] },
    { id: 'M-N2-sweep-catch', file: TP, edits: [{ from: "    dlog('error', { message: errMessage(err) });\n  }\n  dlog('phase sweep'", to: "    throw err;\n  }\n  dlog('phase sweep'" }], mustFail: ['a sweep that hits an unexpected internal error'] },
  ],
};
