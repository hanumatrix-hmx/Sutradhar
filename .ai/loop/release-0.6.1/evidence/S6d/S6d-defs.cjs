const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const TP = 'packages/cli/src/temp-profile.ts';
module.exports = {
  cwd: WT, vitestCwd: 'packages/cli', vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/scan-command-lines.spec.ts'],
  mutants: [
    { id: 'M-D1', file: TP, edits: [{ from: "if (platform === 'linux') {", to: "if (platform === 'linux-disabled') {" }], mustFail: ['D1:'] },
    { id: 'M-D2', file: TP, edits: [{ from: "['-A', '-ww', '-o', 'args=']", to: "['-A', '-o', 'args=']" }], mustFail: ['D3:'] },
    { id: 'M-D3', file: TP, edits: [{ from: 'return lines === null ? null : keepPrefixed(lines);', to: 'return keepPrefixed(lines ?? []);' }], mustFail: ['D2:'] },
    { id: 'M-D4', file: TP, edits: [{ from: 'if (readable === 0 || performance.now() >= deadline) return null;', to: 'if (performance.now() >= deadline) return null;' }], mustFail: ['D8:'] },
    { id: 'M-D5', file: TP, edits: [{ from: '    if (performance.now() >= deadline) return null;\n    let raw: Buffer;', to: '    let raw: Buffer;' }], mustFail: ['D9b:'] },
    { id: 'M-D6', file: TP, edits: [{ from: ".split('\\0').join(' ').trim()", to: ".split('\\0').join('').trim()" }], mustFail: ['D5:'] },
    { id: 'M-D7', file: TP, edits: [{ from: "if (!/^\\d+$/.test(name)) continue;", to: '' }], mustFail: ['D5:'] },
    { id: 'M-D8', file: TP, edits: [{ from: "    names = await procFs.readdir('/proc');\n  } catch {\n    return null;", to: "    names = await procFs.readdir('/proc');\n  } catch {\n    return [];" }], mustFail: ['D7:'] },
  ],
};
