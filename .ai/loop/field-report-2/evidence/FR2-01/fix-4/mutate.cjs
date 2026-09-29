// FR2-01 fix-4 mutation helper: applies ONE named mutation to the engine source (in place), so a
// targeted vitest run shows whether the fix-4 tests actually guard the behavior fix-4 introduced.
// ALWAYS followed by `git checkout -- packages/browser/src/actions/browser-action-engine.ts`.
// These mutations were applied and verified interactively during fix-4's own session (each run
// individually, confirmed to fail the relevant new test, then reverted before moving to the
// next) — this file is the reusable/replayable record of that same sequence, extending
// audit-4's mutate.cjs (which covered fix-3's M1-M5) to fix-4's own M1-M7.
const fs = require('fs');
const path = require('path');
const f = path.resolve(__dirname, '../../../../../../packages/browser/src/actions/browser-action-engine.ts');
let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

const muts = {
  // M1 (GAP-084/GAP-087): firstVisibleHandleAnyFrame back to sequential per-frame probing.
  // Caught by: "GAP-084/GAP-087: probing multiple busy frames within a single VISIBLE-state
  // pass..." (elapsedMs assertion, 1037ms observed vs a 900ms bound).
  M1: [
    `  private async firstVisibleHandleAnyFrame(page: Page, fullSelector: string): Promise<ElementHandle<Element> | null> {
    const frames = this.liveFramesOf(page);
    const verdicts = await Promise.all(frames.map((frame) => this.pierceFirstMatch(frame, fullSelector)));
    let winner: ElementHandle<Element> | null = null;
    for (const verdict of verdicts) {`,
    `  private async firstVisibleHandleAnyFrame(page: Page, fullSelector: string): Promise<ElementHandle<Element> | null> {
    // MUTATION_M1: reverted to sequential per-frame probing.
    for (const frame of this.liveFramesOf(page)) {
      const verdict = await this.pierceFirstMatch(frame, fullSelector);
      if (verdict.kind !== 'match') continue;
      const visibility = await this.isHandleVisible(verdict.handle);
      if (visibility === 'visible') return verdict.handle;
      if (typeof verdict.handle.dispose === 'function') await verdict.handle.dispose().catch(() => {});
    }
    return null;
  }
  private async __unused_firstVisibleHandleAnyFrame_body(page: Page, fullSelector: string) {
    const frames = this.liveFramesOf(page);
    const verdicts = await Promise.all(frames.map((frame) => this.pierceFirstMatch(frame, fullSelector)));
    let winner: ElementHandle<Element> | null = null;
    for (const verdict of verdicts) {`,
  ],
  // M2 (GAP-081/GAP-086): isHandleVisible back to the old catch-everything-as-not-visible shape
  // (both the timeout branch and the catch block). Caught by: GAP-081a, GAP-086 (both flip
  // result.success from false to true — a false SUCCESS).
  M2: [
    `      if (outcome === BOUNDED_TIMED_OUT) return 'unknown';
      return outcome ? 'visible' : 'not-visible';
    } catch (err) {
      if (BrowserActionEngine.isFatalFrameCheckError(err)) return 'unknown';
      if (this.isContextDestroyedError(err)) return 'not-visible';
      return 'unknown';
    }
  }`,
    `      if (outcome === BOUNDED_TIMED_OUT) return 'not-visible';
      return outcome ? 'visible' : 'not-visible';
    } catch (err) {
      return 'not-visible';
    }
  }`,
  ],
  // M3 (GAP-081 part 2): pierceFirstMatch's catch-all back to mapping every unrecognized error
  // to 'no-match'. Caught by: GAP-081b (flips result.success from false to true).
  M3: [
    `      if (this.isContextDestroyedError(err)) {
        // A single frame's own context being destroyed by an ordinary in-page navigation (NOT
        // the tab/session closing — that's \`isFatalFrameCheckError\` above) is a recoverable,
        // per-frame hiccup: this frame definitively has no answer for THIS pass, and will be
        // re-probed fresh (via \`page.frames()\`) on the next one. That's 'no-match' for this
        // pass, not 'unknown' — unlike a timeout, there's no live probe still in flight that
        // might resolve differently.
        return { kind: 'no-match' };
      }
      // GAP-081 (FR2-01 audit-4/fix-4): any OTHER, unrecognized error was previously ALSO mapped
      // to 'no-match' here — silently treating an error this code has no classification for as
      // a confirmed negative. Audit-4's explicit instruction: "Error handling should default to
      // unknown, not no-match." Only the two positively-classified cases above (a real selector
      // syntax error, which rethrows; a recoverable in-page-navigation hiccup, which is
      // 'no-match') get a definite answer — everything else defaults to 'unknown' so a caller
      // can't mistake "this code doesn't recognize the error" for "this frame confirms absent".
      return { kind: 'unknown' };`,
    `      return { kind: 'no-match' };`,
  ],
  // M4 (GAP-082, dispatchAction site): waitForHiddenInAllFrames timeout back to one
  // undifferentiated "still visible" message. Caught by: GAP-081a, GAP-081b (message assertion).
  M4: [
    `          if (hiddenVerdict !== 'hidden') {
            // GAP-082 (Orchestrator decision, decisions.md audit-4 entry): an 'unknown' timeout
            // (a busy neighbor frame that never answered, no frame ever confirming visible) is a
            // GENUINELY DIFFERENT failure from a 'visible' timeout (some frame explicitly
            // confirmed the element is still there) — the two must never share the same message,
            // or a caller can't tell "we don't know" from "we know it's still there".
            const detail =
              hiddenVerdict === 'unknown'
                ? 'could not verify: one or more frames were unresponsive'
                : \`an element matching "\${params.selector}" is still visible\`;
            throw new Error(\`wait_for_selector timed out after \${waitMs}ms waiting for state=hidden: \${detail}.\`);`,
    `          if (hiddenVerdict !== 'hidden') {
            throw new Error(
              \`wait_for_selector timed out after \${waitMs}ms waiting for state=hidden: an element \` +
                \`matching "\${params.selector}" is still visible.\`,
            );`,
  ],
  // M5 (GAP-082, 9th site — checkWaitForSelectorOnce): same collapse, one call path over.
  // Caught by: "GAP-082 (9th site ...)" sub-case 1.
  M5: [
    `    if (hiddenVerdict !== 'hidden') {
      // GAP-082 (9th site — this check-once path collapsed 'unknown' into the SAME "still
      // visible" message as a confirmed-visible verdict, exactly like \`waitForHiddenInAllFrames\`
      // did before this fix round, one call path over. Same fix, same reasoning: an honest
      // "couldn't verify" must never read the same as a confirmed negative.
      const detail =
        hiddenVerdict === 'unknown'
          ? 'could not verify: one or more frames were unresponsive'
          : \`an element matching "\${selector}" is still visible\`;
      throw new Error(\`wait_for_selector timed out after 0ms waiting for state=hidden: \${detail}.\`);
    }`,
    `    if (hiddenVerdict !== 'hidden') {
      throw new Error(
        \`wait_for_selector timed out after 0ms waiting for state=hidden: an element matching \` +
          \`"\${selector}" is still visible.\`,
      );
    }`,
  ],
  // M6 (GAP-083): diagnoseSelectorVisibility back to collapsing "unconfirmed" into "nothing to
  // report" (null). Caught by: GAP-083 (falls through to "No element found").
  M6: [
    `    if (flags.length === 0 && unconfirmedFrames === 0) return null;`,
    `    if (flags.length === 0) return null;`,
  ],
  // M7 (GAP-085): countOtherVisibleMatches back to always reporting unconfirmed:false. Caught
  // by: GAP-085 (otherVisibleMatchesUnknown stays undefined instead of true).
  M7: [
    `    return { count: perFrame.reduce((a, b) => a + b, 0), unconfirmed };`,
    `    return { count: perFrame.reduce((a, b) => a + b, 0), unconfirmed: false };`,
  ],
};

const m = muts[process.argv[2]];
if (!m) throw new Error('unknown mutation: ' + process.argv[2] + ' (available: ' + Object.keys(muts).join(', ') + ')');
if (!s.includes(m[0])) throw new Error('anchor not found for ' + process.argv[2]);
s = s.replace(m[0], m[1]);
fs.writeFileSync(f, s.replace(/\n/g, '\r\n'));
console.log('applied', process.argv[2]);
