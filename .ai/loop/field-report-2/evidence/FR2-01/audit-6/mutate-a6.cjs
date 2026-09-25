// FR2-01 audit-6 mutation runner. For each named mutation: byte-exact backup of the target file,
// apply the mutation (anchor must exist exactly once), run the relevant package's vitest, record the
// summary, restore from the backup, and verify sha256(after) === sha256(before). Line endings are
// preserved (both target files are CRLF).
// Run: node .ai/loop/field-report-2/evidence/FR2-01/audit-6/mutate-a6.cjs [names...]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../../../../..');
const ENGINE = path.join(root, 'packages/browser/src/actions/browser-action-engine.ts');
const TOOLS = path.join(root, 'packages/mcp-server/src/tools.ts');
const VITEST = path.join(root, 'node_modules/.bin/vitest');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const muts = {
  // ---- reproduced from fix-4 (mutate.cjs) ----
  'fix4-M2': [ENGINE, 'browser', `      if (outcome === BOUNDED_TIMED_OUT) return 'unknown';
      return outcome ? 'visible' : 'not-visible';
    } catch (err) {
      if (BrowserActionEngine.isFatalFrameCheckError(err)) return 'unknown';
      if (this.isContextDestroyedError(err)) return 'not-visible';
      return 'unknown';
    }`, `      if (outcome === BOUNDED_TIMED_OUT) return 'not-visible';
      return outcome ? 'visible' : 'not-visible';
    } catch (err) {
      return 'not-visible';
    }`],
  'fix4-M3': [ENGINE, 'browser', `      // can't mistake "this code doesn't recognize the error" for "this frame confirms absent".
      return { kind: 'unknown' };`, `      // can't mistake "this code doesn't recognize the error" for "this frame confirms absent".
      return { kind: 'no-match' }; // MUTATION fix4-M3`],
  'fix4-M4': [ENGINE, 'browser', `              hiddenVerdict === 'unknown'
                ? 'could not verify: one or more frames were unresponsive'
                : \`an element matching "\${params.selector}" is still visible\`;`, `              false // MUTATION fix4-M4
                ? 'could not verify: one or more frames were unresponsive'
                : \`an element matching "\${params.selector}" is still visible\`;`],
  // ---- reproduced from fix-5 (mutation-gap111/112/113.txt) ----
  'fix5-G111': [TOOLS, 'mcp-server', `    ['could not verify', 'could not determine'],`, `    [], // MUTATION fix5-G111`],
  'fix5-G112': [ENGINE, 'browser', `          if (this.isContextDestroyedError(err)) return null;
          return BOUNDED_TIMED_OUT;`, `          return null; // MUTATION fix5-G112`],
  'fix5-G113': [ENGINE, 'browser', `          if (this.isContextDestroyedError(err)) return 0;
          unconfirmed = true;
          return 0;`, `          return 0; // MUTATION fix5-G113`],
  // ---- audit-6's OWN new mutations ----
  // N1: a plausible future rewording of the engine's honest hidden-timeout text (both sites). The MCP
  // `unless` list is a literal-substring coupling to this text; does ANY test catch the drift that
  // silently re-enables the contradicting "still visible" hint?
  'a6-N1-reword': [ENGINE, 'browser+mcp-server', `'could not verify: one or more frames were unresponsive'`, `'unable to confirm: one or more frames were unresponsive'`, 'all'],
  // N2: drop the second `unless` entry. The engine never emits "could not determine" (its visible-state
  // message says "could not be determined"), so this entry is dead — expect NO test to notice.
  'a6-N2-dead-unless': [TOOLS, 'mcp-server', `    ['could not verify', 'could not determine'],`, `    ['could not verify'], // MUTATION a6-N2`],
  // N3: pierceFirstMatch's context-destroyed branch -> 'unknown' instead of 'no-match' (the direction
  // a fix for audit-6's tab-close false success would take). Does any existing test pin the current
  // 'no-match' behavior, i.e. would a fix break the suite?
  'a6-N3-ctxdestroyed-unknown': [ENGINE, 'browser', `        // might resolve differently.
        return { kind: 'no-match' };`, `        // might resolve differently.
        return { kind: 'unknown' }; // MUTATION a6-N3`],
  // N4: describeWaitForSelectorTimeout — remove the whole GAP-083 unconfirmed-frames guard. Does the
  // suite catch it (i.e. is the guard fix-4 added actually pinned)?
  'a6-N4-no-083-guard': [ENGINE, 'browser', `if (diagnosis && diagnosis.total === 0 && diagnosis.unconfirmedFrames > 0) {`, `if (false && diagnosis && diagnosis.total === 0 && diagnosis.unconfirmedFrames > 0) { // MUTATION a6-N4`],
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(muts);
const results = [];
for (const name of names) {
  const [file, pkgs, from, to, all] = muts[name];
  const backup = fs.readFileSync(file);
  const before = sha(file);
  const s = backup.toString('utf8').replace(/\r\n/g, '\n');
  const count = s.split(from).length - 1;
  if (count === 0 || (count > 1 && all !== 'all')) throw new Error(`${name}: anchor found ${count}x`);
  fs.writeFileSync(file, (all === 'all' ? s.split(from).join(to) : s.replace(from, to)).replace(/\n/g, '\r\n'));
  const summaries = [];
  try {
    for (const pkg of pkgs.split('+')) {
      const r = spawnSync(VITEST, ['run'], { cwd: path.join(root, 'packages', pkg), encoding: 'utf8', shell: true });
      const outp = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
      fs.writeFileSync(path.join(__dirname, `mutation-${name}-${pkg}.log`), outp);
      const tests = (outp.match(/Tests\s+[^\n]+/) || ['?'])[0];
      const failed = [...outp.matchAll(/FAIL\s+tests\/[^\n]+/g)].map((m) => m[0].slice(0, 260));
      summaries.push({ pkg, exit: r.status, tests, failed: [...new Set(failed)] });
    }
  } finally {
    fs.writeFileSync(file, backup);
  }
  const after = sha(file);
  const res = { name, anchorsReplaced: all === 'all' ? count : 1, summaries, shaBefore: before, shaAfter: after, restored: before === after };
  results.push(res);
  console.log(JSON.stringify(res));
}
fs.writeFileSync(path.join(__dirname, 'mutation-results.json'), JSON.stringify(results, null, 2));
