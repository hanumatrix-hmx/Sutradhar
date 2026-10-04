const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const TP = 'packages/cli/src/temp-profile.ts';
module.exports = {
  cwd: WT, vitestCwd: 'packages/cli', vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/temp-profile.spec.ts'],
  mutants: [
    // M-N1: `invalid` treated as `absent`
    { id: 'M-N1', file: TP, edits: [{ from: 'ownerState: marker.state,', to: "ownerState: marker.state === 'invalid' ? 'absent' : marker.state," }], mustFail: ['N1-a', 'N1-b', 'N1-c'] },
    // extras
    { id: 'M-N1b-read-error-is-absent', file: TP, edits: [{ from: "return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'absent' } : { state: 'invalid' };", to: "return { state: 'absent' };" }], mustFail: ['N1-c'] },
    { id: 'M-N1c-any-number-is-valid', file: TP, edits: [{ from: "return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? { state: 'valid', pid } : { state: 'invalid' };", to: "return typeof pid === 'number' ? { state: 'valid', pid } : { state: 'invalid' };" }], mustFail: ['chromePid is 0', 'chromePid is negative', 'chromePid is fractional'] },
    { id: 'M-N1d-parse-failure-is-absent', file: TP, edits: [{ from: "  } catch {\n    return { state: 'invalid' };\n  }\n}", to: "  } catch {\n    return { state: 'absent' };\n  }\n}" }], mustFail: ['N1-a', 'empty file'] },
    { id: 'M-N1e-order-after-owner-alive', file: TP, edits: [{ from: "  if (f.ownerState === 'invalid') return { remove: false, reason: 'owner-unknown' };\n  if (f.ownerAlive) return { remove: false, reason: 'owner-alive' };", to: "  if (f.ownerAlive) return { remove: false, reason: 'owner-alive' };\n  if (f.ownerState === 'invalid') return { remove: false, reason: 'owner-unknown' };" }], mustFail: ['decideRemoval: ownerState invalid'] },
    { id: 'M-N1f-valid-marker-ignored', file: TP, edits: [{ from: "const ownerPid = marker.state === 'valid' ? marker.pid : await readLockPid(dir);", to: 'const ownerPid = await readLockPid(dir);' }], mustFail: ['VALID marker whose owner is dead'] },
  ],
};
