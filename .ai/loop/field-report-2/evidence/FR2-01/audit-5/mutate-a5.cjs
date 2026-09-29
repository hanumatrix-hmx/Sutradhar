// FR2-01 audit-5: the auditor's OWN mutations (X1..X4), beyond fix-4's M1..M7. Same contract as
// fix-4's mutate.cjs: applies one named mutation in place; the runner restores the file from a
// byte-exact backup afterwards and checks `git diff --quiet` on it.
const fs = require('fs');
const path = require('path');
const f = path.resolve(__dirname, '../../../../../../packages/browser/src/actions/browser-action-engine.ts');
let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const muts = {
  // X1 (GAP-084, attached half): firstAnyHandleAnyFrame back to sequential probing. fix-4 added a
  // timing test only for the VISIBLE half (firstVisibleHandleAnyFrame).
  X1: [
    `  private async firstAnyHandleAnyFrame(page: Page, fullSelector: string): Promise<ElementHandle<Element> | null> {
    const frames = this.liveFramesOf(page);
    const verdicts = await Promise.all(frames.map((frame) => this.pierceFirstMatch(frame, fullSelector)));`,
    `  private async firstAnyHandleAnyFrame(page: Page, fullSelector: string): Promise<ElementHandle<Element> | null> {
    const frames = this.liveFramesOf(page);
    const verdicts: FrameProbeVerdict[] = [];
    for (const frame of frames) verdicts.push(await this.pierceFirstMatch(frame, fullSelector)); // MUTATION_X1`,
  ],
  // X2 (GAP-081 consumer): isHiddenInEveryFrame ignores an 'unknown' visibility verdict (treats it
  // like 'not-visible'). This is the actual false-SUCCESS consumer site.
  X2: [`      if (visibility === 'unknown') sawUnknown = true;\n`, `      // MUTATION_X2 removed unknown handling\n`],
  // X3 (GAP-081): only the FATAL branch of isHandleVisible collapses to 'not-visible'.
  X3: [
    `      if (BrowserActionEngine.isFatalFrameCheckError(err)) return 'unknown';\n      if (this.isContextDestroyedError(err)) return 'not-visible';`,
    `      if (BrowserActionEngine.isFatalFrameCheckError(err)) return 'not-visible'; // MUTATION_X3\n      if (this.isContextDestroyedError(err)) return 'not-visible';`,
  ],
  // X4 (GAP-081/GAP-086): only the TIMEOUT branch of isHandleVisible collapses to 'not-visible'.
  X4: [`      if (outcome === BOUNDED_TIMED_OUT) return 'unknown';`, `      if (outcome === BOUNDED_TIMED_OUT) return 'not-visible'; // MUTATION_X4`],
};
const m = muts[process.argv[2]];
if (!m) throw new Error('unknown mutation ' + process.argv[2]);
if (!s.includes(m[0])) throw new Error('anchor not found for ' + process.argv[2]);
s = s.replace(m[0], m[1]);
fs.writeFileSync(f, s.replace(/\n/g, '\r\n'));
console.log('applied', process.argv[2]);
