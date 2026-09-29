// FR2-01 audit-4 mutation helper: applies ONE named mutation to the engine source (in place),
// so a targeted vitest run shows whether the fix-3 tests actually guard that behavior.
// ALWAYS followed by `git checkout -- packages/browser/src/actions/browser-action-engine.ts`.
const fs = require('fs');
const path = require('path');
const f = path.resolve(__dirname, '../../../../../../packages/browser/src/actions/browser-action-engine.ts');
let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const muts = {
  // M1: isHiddenInEveryFrame back to sequential probing (GAP-059 regression)
  M1: [
    'const verdicts = await Promise.all(frames.map((frame) => this.pierceFirstMatch(frame, fullSelector)));',
    'const verdicts: FrameProbeVerdict[] = []; for (const frame of frames) verdicts.push(await this.pierceFirstMatch(frame, fullSelector));',
  ],
  // M2: GAP-057 regression - unknown collapses to hidden
  M2: ["return sawUnknown ? 'unknown' : 'hidden';", "return 'hidden';"],
  // M3: GAP-059 dispose regression - never dispose late handle
  M3: ['if (handle && typeof handle.dispose === \'function\') void handle.dispose().catch(() => {});', 'void handle;'],
  // M4: GAP-058 regression - default retries back to 2
  M4: [
    "(params.actionType === 'wait_for_selector' && params.timeoutMs !== undefined && params.timeoutMs <= 0 ? 0 : 2);",
    '2;',
  ],
  // M5: probeSelectorMatchExists collapses unknown to false (GAP-057 matchedAtStart regression)
  M5: ['return sawUnknown ? undefined : false;', 'return false;'],
};
const m = muts[process.argv[2]];
if (!m) throw new Error('unknown mutation');
if (!s.includes(m[0])) throw new Error('anchor not found for ' + process.argv[2]);
s = s.replace(m[0], m[1]);
fs.writeFileSync(f, s.replace(/\n/g, '\r\n'));
console.log('applied', process.argv[2]);
