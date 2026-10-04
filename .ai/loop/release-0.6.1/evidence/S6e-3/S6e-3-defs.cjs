const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const TP = 'packages/cli/src/temp-profile.ts';
const SC = 'packages/cli/src/spawn-chrome.ts';
module.exports = {
  cwd: WT, vitestCwd: 'packages/cli', vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/system-binaries.spec.ts'],
  mutants: [
    // M-F3: the scan goes back to the bare powershell.exe name
    { id: 'M-F3', file: TP, edits: [{ from: "await run(powershellExe(), ['-NoProfile'", to: "await run('powershell.exe', ['-NoProfile'" }], mustFail: ['F3-a'] },
    // extras
    { id: 'M-F3b-kill-bare-taskkill', file: SC, edits: [{ from: "spawnFn(taskkillExe(), ['/PID'", to: "spawnFn('taskkill', ['/PID'" }], mustFail: ['F3-c (Windows)', 'F3-d'] },
    { id: 'M-F3c-posix-bare-ps', file: TP, edits: [{ from: "await run(psBin(), ['-A', '-ww'", to: "await run('ps', ['-A', '-ww'" }], mustFail: ['F3-b'] },
    { id: 'M-F3d-new-bare-site', file: TP, edits: [{ from: "execFile(file, args, { timeout: timeoutMs", to: "execFile('powershell.exe', args, { timeout: timeoutMs" }], mustFail: ['F3-d'] },
  ],
};
