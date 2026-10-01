/**
 * @file packages/cli/tests/unit/glue-rule.spec.ts
 * @description FR2-11 fix-3 (audit-3 A3-F1) on every CLI surface: GLUED tokens (2-3 URLs / local paths in one token, every delimiter, a secret
 * in every slot) through the args of every verb, the thrown error, the serialized history.jsonl line and the human `history` rows.
 * Same seeded generator as the browser package (seed and count below).
 */
import { redactCliArgs, buildHistoryLine, formatHistoryHuman } from '../../src/history-file.js';
import { generate, GLUE_SEED } from '../../../../tools/scenario-suite/lib/fr2-11-glue.mjs';

const N = 1500;
const cases = generate(GLUE_SEED + 2, N) as { id: string; secrets: string[]; text: string }[];
const VERBS = ['nav', 'newtab', 'audit', 'compare', 'click', 'clicktext', 'clickrole', 'hover', 'scroll', 'wait', 'waitfor', 'upload', 'download', 'screenshot', 'grant', 'focustab', 'closetab', 'drag', 'snap', 'text', 'tabs', 'axsnap', 'press', 'eval', 'type', 'select', 'dialog', 'setclipboard'];
// verbs whose argument is ONE real URL (FR2-09 D5: origin + pathname is the stored form, never glued text)
const URL_VERBS = new Set(['nav', 'newtab', 'audit', 'compare']);

describe(`FR2-11 fix-3 CLI glue property test (seed ${GLUE_SEED + 2}, ${N} generated strings x ${VERBS.length} verbs x 3 positions)`, () => {
  it('no secret in any verb, any arg position, the thrown error, actionsUnavailable and the serialized line', () => {
    const leaks: { id: string; where: string; text: string }[] = [];
    for (const c of cases) {
      for (const verb of VERBS) {
        if (URL_VERBS.has(verb)) continue;
        const out = JSON.stringify([redactCliArgs(verb, [c.text, 'x', 'y']), redactCliArgs(verb, ['x', c.text, 'y']), redactCliArgs(verb, ['x', 'y', c.text])]);
        for (const s of c.secrets) if (out.includes(s)) leaks.push({ id: c.id, where: verb, text: c.text });
      }
      const line = JSON.stringify(buildHistoryLine({ ts: 't', sessionId: 's', cwd: '/w', verb: 'nav', args: [], exitCode: 1, durationMs: 1, error: c.text, actionsUnavailable: c.text }));
      for (const s of c.secrets) if (line.includes(s)) leaks.push({ id: c.id, where: 'line', text: c.text });
    }
    expect(leaks.slice(0, 6)).toEqual([]);
    expect(leaks.length).toBe(0);
  });
  it('the human `history` output applies the same rule to a line an older build wrote with glued text in it', () => {
    const bad: string[] = [];
    for (const c of cases.slice(0, 1000)) {
      const parsed = {
        v: 1, ts: '2026-09-25T14:02:11.123Z', sessionId: 's', verb: 'eval', args: [c.text], exitCode: 1, durationMs: 1, error: c.text, actionsUnavailable: c.text,
        actions: [{ actionType: 'eval', success: false, target: c.text, error: c.text, tabId: 't', seq: 1 }], actionsEvicted: 0,
      };
      const out = formatHistoryHuman({ lines: [{ raw: '', parsed: parsed as never }], skipped: 0, rotatedExists: false }, { file: '/f' });
      for (const s of c.secrets) if (out.includes(s)) bad.push(c.text);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
  it('the audit-3 shapes through the CLI eval verb and the error', () => {
    const a = "['https://h.test/a','https://u:CLIGLUE1x@h2.test/p'].length";
    expect(JSON.stringify(redactCliArgs('eval', [a]))).not.toContain('CLIGLUE1x');
    const e = "Error: {api:'https://h.test/x',db:'postgres://admin:CLIGLUE2x@db:5432/app'}";
    expect(JSON.stringify(buildHistoryLine({ ts: 't', sessionId: 's', cwd: '/w', verb: 'eval', args: [], exitCode: 1, durationMs: 1, error: e }))).not.toContain('CLIGLUE2x');
    expect(JSON.stringify(redactCliArgs('eval', ["['https://h.test/a','C:/Users/CLIGLUE3x/doc.txt']"]))).not.toContain('CLIGLUE3x');
  });
});
