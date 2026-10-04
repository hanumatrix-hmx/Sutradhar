// S8b T5 latency controls (independent re-derivation of the S6h claim). LAT = a behaviour-preserving 80 ms await inserted
// between the module's deadline check (+ its rm-attempt log line) and the rm call: what a loaded runner does to that gap.
const fs = require('fs');
const SP = 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const TP = 'src/temp-profile.ts', TPS = 'tests/unit/temp-profile.spec.ts';
const norm = (s) => s.replace(/\r\n/g, '\n');
const cur = norm(fs.readFileSync(WT + '/packages/cli/' + TPS, 'utf8')), old = norm(fs.readFileSync(SP + '/S8b/old-temp-profile.spec.ts', 'utf8'));
const block = (s) => { const a = s.indexOf("  it('T5:") >= 0 ? s.indexOf("  it('T5:") : s.indexOf('  it("T5:'); const b = s.indexOf("  it('T8:", a); if (a < 0 || b < 0) throw new Error('T5 block not found'); return s.slice(a, b); };
const NEW_T5 = block(cur), OLD_T5 = block(old);
const LAT = { file: TP, from: "    dlog('rm-attempt', { path: dir, n, 'remaining-ms': Math.round(remaining) });\n", to: "    dlog('rm-attempt', { path: dir, n, 'remaining-ms': Math.round(remaining) });\n    await new Promise((r) => setTimeout(r, 80));\n" };
const SPEC = [TPS];
module.exports = [
  { id: 'T5-BASELINE-new', desc: 'HEAD spec, HEAD module', specs: SPEC, edits: [] },
  { id: 'LAT80-new-T5', desc: 'NEW T5 under the 80 ms latency (must still PASS: run expected green)', specs: SPEC, edits: [LAT], expectGreen: true },
  { id: 'OLD-T5-no-latency', desc: 'OLD T5 (fe71ceb) on the real module (must PASS)', specs: SPEC, edits: [{ file: TPS, from: NEW_T5, to: OLD_T5 }], expectGreen: true },
  { id: 'LAT80-old-T5', desc: 'OLD T5 under the 80 ms latency (expected to FAIL: load-sensitive)', specs: SPEC, mustFail: ['T5:'], edits: [{ file: TPS, from: NEW_T5, to: OLD_T5 }, LAT] },
];
// S6f re-derivation: restore the PRE-S6f guard (b) line (git show 8fa2516) and apply placement (i): it must SURVIVE (green);
// with the HEAD guard the same placement fails (M-O6-i in the main batch).
const CSS = 'tests/unit/close-session.spec.ts', CLI = 'src/cli.ts';
const curCs = norm(fs.readFileSync(WT + '/packages/cli/' + CSS, 'utf8'));
const a = curCs.indexOf('      // ' + String.fromCharCode(96) + 'cb' + String.fromCharCode(96) + ' is the index of the ' + String.fromCharCode(96) + 'if' + String.fromCharCode(96) + ' keyword');
const b = curCs.indexOf('      expect(clearAt).toBeGreaterThan(cbClose);\n', a);
if (a < 0 || b < 0) throw new Error('guard (b) block not found');
const NEW_GUARD = curCs.slice(a, b + '      expect(clearAt).toBeGreaterThan(cbClose);\n'.length);
const OLD_GUARD = '      expect(clearAt).toBeGreaterThan(cb + cbBlock.length - 1);\n';
const TRAIL = '    await clearState(); // still runs for BOTH no-chromePid paths, including dialog-blocked (legacy state files)';
module.exports.push({ id: 'OLDGUARD-M-O6-i', desc: 'pre-S6f guard (b) + placement (i): expected to SURVIVE (0 failed)', specs: [CSS], edits: [{ file: CSS, from: NEW_GUARD, to: OLD_GUARD }, { file: CLI, from: '      }\n    }\n' + TRAIL, to: '      }\n      await clearState();\n    }' }], expectGreen: true });
module.exports.push({ id: 'OLDGUARD-only', desc: 'pre-S6f guard (b) on the real code: green', specs: [CSS], edits: [{ file: CSS, from: NEW_GUARD, to: OLD_GUARD }], expectGreen: true });
