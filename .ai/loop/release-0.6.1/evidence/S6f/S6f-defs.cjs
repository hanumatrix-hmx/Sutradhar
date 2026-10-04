// S6f mutant definitions: M-O6 placements i-v for the cmdClose "no-chromePid clearState sits AFTER the if (!closeBlocked) block" guard (b).
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const CLI = 'packages/cli/src/cli.ts';
const TRAIL = '    await clearState(); // still runs for BOTH no-chromePid paths, including dialog-blocked (legacy state files)';
const GONE = '        // Already gone (browser closed externally, etc.) \u2014 clearing state is still the right move.';
module.exports = {
  cwd: WT,
  vitestCwd: 'packages/cli',
  vitestBin: WT + '/node_modules/vitest/vitest.mjs',
  tests: ['tests/unit/close-session.spec.ts'],
  mutants: [
    { id: 'M-O6-i-S8-variant-last-stmt-in-block', file: CLI, edits: [
      { from: '      }\n    }\n' + TRAIL, to: '      }\n      await clearState();\n    }' } ], mustFail: ['(b)'] },
    { id: 'M-O6-ii-S6b-original-inside-try', file: CLI, edits: [
      { from: TRAIL, to: '' },
      { from: '        await runtime.shutdown(sessionId);\n      } catch {\n' + GONE, to: '        await runtime.shutdown(sessionId);\n        await clearState();\n      } catch {\n' + GONE } ], mustFail: ['(b)'] },
    { id: 'M-O6-iii-first-stmt-after-brace', file: CLI, edits: [
      { from: TRAIL, to: '' },
      { from: '    if (!closeBlocked) {\n      // FR2-04 N11:', to: '    if (!closeBlocked) {\n      await clearState();\n      // FR2-04 N11:' } ], mustFail: ['(b)'] },
    { id: 'M-O6-iv-inside-catch', file: CLI, edits: [
      { from: TRAIL, to: '' },
      { from: '      } catch {\n' + GONE + '\n      }', to: '      } catch {\n' + GONE + '\n        await clearState();\n      }' } ], mustFail: ['(b)'] },
    { id: 'M-O6-v-before-if-block', file: CLI, edits: [
      { from: TRAIL, to: '' },
      { from: '  } else {\n    if (!closeBlocked) {\n      // FR2-04 N11:', to: '  } else {\n    await clearState();\n    if (!closeBlocked) {\n      // FR2-04 N11:' } ], mustFail: ['(b)'] },
  ],
};
