import * as B from 'file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/browser/dist/index.js';
import * as H from 'file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/cli/dist/history-file.js';
import { generate } from 'file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/tools/scenario-suite/lib/fr2-11-property.mjs';
const URL_SHAPED_BEFORE = /[/\\@%]|:[0-9/]|:$/;
const exempt = (t, secret) => { const before = t.slice(0, Math.max(0, t.indexOf(secret))); if (URL_SHAPED_BEFORE.test(before)) return false; return before.endsWith('#') || /\[[^\]\s]*=$/.test(before); };
let total = 0, leaks = 0; const shown = [];
const seeds = Number(process.argv[2] ?? 40);
for (let s = 1; s <= seeds; s++) {
  for (const c of generate(1000 + s * 7919, 6000)) {
    total++;
    const t = c.text, k = c.secret;
    const e = B.sanitizeHistoryEntry({ actionType: 'click', selector: exempt(t, k) ? 'x' : t, target: t, url: t, error: t, success: false, executionTimeMs: 1, timestamp: 't', verification: { verified: false, confidence: 0, reason: t, evidence: { tier: 'x', checks: [{ check: 'c', outcome: 'fail', expected: t, observed: t, detail: t }] } } });
    const out = JSON.stringify([B.redactHistoryText(t), B.redactHistoryUrl(t), e, B.sanitizeHistoryEntry({ actionType: 'navigate', target: t }), B.evalCodePreview(t), H.redactCliArgs('clicktext', [t]), H.redactCliArgs('nav', [t]), H.redactCliArgs('upload', ['x', t]), H.buildHistoryLine({ ts: 't', sessionId: 's', cwd: '/w', verb: 'nav', args: [], exitCode: 1, durationMs: 1, error: t })]);
    if (out.includes(k)) { leaks++; if (shown.length < 15) shown.push({ seed: 1000 + s * 7919, id: c.id, text: t }); }
    const a = B.redactHistoryText(t); if (B.redactHistoryText(a) !== a) { leaks++; if (shown.length < 15) shown.push({ idem: true, text: t }); }
  }
}
console.log({ total, leaks }); for (const x of shown) console.log(JSON.stringify(x));
