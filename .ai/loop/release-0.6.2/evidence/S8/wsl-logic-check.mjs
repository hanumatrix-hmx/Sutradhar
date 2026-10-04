// S8 auditor: platform-determinism check of the NEW pure logic of 0.6.2 (bundled from HEAD sources with esbuild, run on
// Windows Node and WSL Ubuntu Node 20). Prints one canonical JSON result line and a sha256 of it; both platforms must agree.
import { createHash } from 'node:crypto';
import { windowPageText, pageWindowInPage, formatPageTextMarker, validatePageTextOptions, isPageTextTruncated } from '../../../../../packages/capability-runtime/src/page-text.ts';
import { normalizeTarget } from '../../../../../packages/capability-runtime/src/types.ts';
import { textOutput, textReadErrorOutput } from '../../../../../packages/cli/src/text-output.ts';
import { parseArgs } from '../../../../../packages/cli/src/parse-args.ts';
import { isLaunchCapable, withSessionFlow, NoSessionError } from '../../../../../packages/cli/src/session-flow.ts';
import { classifyHistoryOutcome, historyExitCode, historyOutput } from '../../../../../packages/cli/src/history-output.ts';
import { frameCall } from '../../../../../packages/browser/src/actions/frame-call.ts';
import { decideNavigationVerdict } from '../../../../../packages/browser/src/verifier/post-conditions.ts';
const res = []; let fails = 0;
const ok = (k, c, d) => { if (!c) fails++; res.push([k, !!c, d ?? null]); };
const T = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? '\u{1F600}' : i % 3 === 1 ? 'ab' : '\u00e9\u{1D11E}')).join('');
const isH = (c) => c >= 0xd800 && c <= 0xdbff, isL = (c) => c >= 0xdc00 && c <= 0xdfff;
let twinMismatch = 0, invariant = 0, cases = 0;
for (let o = 0; o <= T.length + 2; o++) for (let m = 1; m <= 12; m++) {
  cases++;
  const a = windowPageText(T, o, m);
  globalThis.document = { body: { innerText: T } };
  const b = pageWindowInPage(o, m);
  if (JSON.stringify(a) !== JSON.stringify(b)) twinMismatch++;
  const s = a.slice;
  if (a.start < T.length && s.length === 0) invariant++;
  if (s.length && isL(s.charCodeAt(0)) && a.start > 0 && isH(T.charCodeAt(a.start - 1))) invariant++;
  if (s.length && isH(s.charCodeAt(s.length - 1)) && a.start + s.length < T.length) invariant++;
}
ok('twin windows identical over all (offset,maxChars)', twinMismatch === 0, { cases, twinMismatch });
ok('surrogate invariants hold', invariant === 0, invariant);
for (const m of [1, 2, 3, 7, 4000]) { let acc = '', off = 0, n = 0; while (off < T.length && n++ < 1000) { const w = windowPageText(T, off, m); acc += w.slice; off = w.start + w.slice.length; } ok(`paging m=${m} reproduces text`, acc === T, acc.length); }
ok('marker A', formatPageTextMarker({ offset: 4000, returnedChars: 4000, totalChars: 10037, truncated: true }, 'H') === '[page text truncated: showing characters 4000-8000 of 10037. H]');
ok('marker B', formatPageTextMarker({ offset: 8000, returnedChars: 2037, totalChars: 10037, truncated: true }) === '[page text: showing characters 8000-10037 of 10037 (end)]');
ok('marker C', formatPageTextMarker({ offset: 10042, returnedChars: 0, totalChars: 10037, truncated: true }) === '[page text: offset 10042 is past the end; the page text has 10037 characters]');
ok('marker null', formatPageTextMarker({ offset: 0, returnedChars: 299, totalChars: 299, truncated: false }) === null);
ok('empty page offset 5 not truncated', isPageTextTruncated(5, 0, 0) === false);
for (const v of [0, 100001, -1, 1.5, NaN]) { let e; try { validatePageTextOptions({ maxChars: v }); } catch (x) { e = x; } ok(`maxChars ${v} TypeError`, e instanceof TypeError, e && e.message); }
const r = { sessionId: 's', tabId: 't', url: 'u', text: 'x'.repeat(4000), offset: 4000, returnedChars: 4000, totalChars: 10037, truncated: true, source: 'dom' };
ok('textOutput plain: window + marker naming --offset 8000', JSON.stringify(textOutput(r, false).stdout) === JSON.stringify([r.text, '[page text truncated: showing characters 4000-8000 of 10037. Continue with: sutradhar text --offset 8000]']), textOutput(r, false).stdout[1]);
ok('textOutput json: one document, no marker', textOutput(r, true).stdout.length === 1 && !textOutput(r, true).stdout[0].includes('[page text'));
const er = textReadErrorOutput(Object.assign(new Error('the page text could not be read: boom'), { name: 'PageTextReadError' }));
ok('read error: stderr line, empty stdout, exit 1', er.exitCode === 1 && er.stdout.length === 0 && er.stderr[0] === 'Error: text read failed: the page text could not be read: boom');
const pa = (a) => { const p = parseArgs(a); return [p.textOffsetFlag ?? null, p.textMaxCharsFlag ?? null, p.textPagingFlagError ?? null]; };
const tbl = [['text', '--offset', '4000'], ['text', '--max-chars', '100000'], ['text', '--offset', '-1'], ['text', '--max-chars', '0'], ['text', '--max-chars', '100001'], ['text', '--offset', 'abc'], ['text', '--offset'], ['snap', '--offset', '5'], ['text', '--offset', '1e3']];
res.push(['parseArgs table', true, tbl.map((a) => [a.join(' '), pa(a)])]);
ok('parseArgs valid values parsed', pa(tbl[0])[0] === 4000 && pa(tbl[1])[1] === 100000);
ok('parseArgs invalid values rejected', tbl.slice(2).every((a) => pa(a)[2] !== null));
const launch = [['nav', ['http://x']], ['nav', []], ['newtab', ['u']], ['newtab', []], ['newtab', ['']], ['audit', ['u']], ['audit', []], ['compare', ['a', 'b']], ['compare', ['a']], ['text', ['u']], ['back', []], ['grant', ['o', 'p']], ['tabs', []], [undefined, []]];
const lt = launch.map(([v, a]) => [v ?? null, a.join('|'), isLaunchCapable(v, a)]);
res.push(['isLaunchCapable table', true, lt]);
ok('isLaunchCapable exactly nav/newtab/audit with url, compare with two', JSON.stringify(lt.filter((x) => x[2]).map((x) => x[0])) === JSON.stringify(['nav', 'newtab', 'audit', 'compare']));
const calls = { spawnFresh: 0, afterAttach: 0, fn: 0 };
let rej;
try { await withSessionFlow({ mayLaunch: false, noSession: () => new NoSessionError('text'), readState: async () => undefined, spawnFresh: async () => { calls.spawnFresh++; return 's'; }, afterAttach: async () => { calls.afterAttach++; }, fn: async () => { calls.fn++; }, gate: async () => {}, reattach: async () => 's', selfHeal: async () => 's' }); } catch (e) { rej = e; }
ok('withSessionFlow no state + mayLaunch false: NoSessionError, nothing spawned', rej && rej.name === 'NoSessionError' && calls.spawnFresh + calls.afterAttach + calls.fn === 0, { calls, msg: rej && rej.message });
ok('NoSessionError message exact (em dash)', rej && rej.message === 'no active browser session \u2014 "text" needs an open page and does not start one. Start a session with: sutradhar nav <url>');
const nav = (before, after, kind = 'go_back') => decideNavigationVerdict({ kind, before, after });
const backEdge = nav({ url: 'a', loaderId: 'L', index: 0, count: 3 }, { url: 'a', loaderId: 'L', index: 0, count: 3 });
const fwdEdge = nav({ url: 'a', loaderId: 'L', index: 2, count: 3 }, { url: 'a', loaderId: 'L', index: 2, count: 3 }, 'go_forward');
const fwdNotMoved = nav({ url: 'a', loaderId: 'L', index: 0, count: 2 }, { url: 'a', loaderId: 'L', index: 0, count: 2 }, 'go_forward');
const moved = nav({ url: 'b', loaderId: 'L', index: 1, count: 2 }, { url: 'a#x', loaderId: 'L', index: 0, count: 2 });
const names = (v) => v.checks.map((c) => c.check);
res.push(['probe checks', true, { backEdge: names(backEdge), fwdEdge: names(fwdEdge), fwdNotMoved: names(fwdNotMoved), moved: names(moved) }]);
ok('probe: back edge has history-edge right after history-index', JSON.stringify(names(backEdge).slice(1, 3)) === JSON.stringify(['go_back.history-index', 'go_back.history-edge']));
ok('probe: forward edge has go_forward.history-edge', names(fwdEdge).includes('go_forward.history-edge'));
ok('probe: not-moved and moved carry no edge check', !names(fwdNotMoved).some((c) => c.endsWith('history-edge')) && !names(moved).some((c) => c.endsWith('history-edge')));
const vEdge = { success: true, tier: 'contradicted', reason: 'expectation replaced reason', evidence: { checks: backEdge.checks.concat([{ check: 'expect.urlChanged', outcome: 'fail' }]) } };
ok('classifier: edge from the check, exit 1 even with a failed expectation', classifyHistoryOutcome('back', vEdge) === 'edge' && historyExitCode('edge', vEdge, true) === 1);
ok('classifier: moved', classifyHistoryOutcome('back', { evidence: { checks: moved.checks } }) === 'moved');
ok('classifier: not-moved', classifyHistoryOutcome('forward', { evidence: { checks: fwdNotMoved.checks } }) === 'not-moved');
ok('classifier: no checks -> unconfirmed', classifyHistoryOutcome('back', { evidence: { checks: [] } }) === 'unconfirmed' && classifyHistoryOutcome('back', undefined) === 'unconfirmed');
const jo = historyOutput('back', { url: 'chrome://new-tab-page/', title: 't', verification: { success: false, tier: 'contradicted', reason: 'r', evidence: { checks: backEdge.checks } } }, { jsonMode: true, expectGiven: false });
ok('json at edge: one JSON doc on stdout, edge line on stderr, exit 1', jo.exitCode === 1 && jo.stdout.length === 1 && !!JSON.parse(jo.stdout[0]) && jo.stderr[0] === 'Back: no history entry to go back to (still on chrome://new-tab-page/)');
const f = { waitForSelector() { throw new Error("Attempted to use detached Frame 'X'."); } };
let threwSync = false, p; try { p = frameCall(f, (x) => x.waitForSelector('a')); } catch { threwSync = true; }
const settled = threwSync ? 'sync-throw' : await p.then(() => 'resolved', (e) => 'rejected:' + e.message);
ok('frameCall turns a synchronous throw into a rejection', !threwSync && settled.startsWith('rejected:Attempted'), settled);
const nt = ['#5', '[#5]', ' #5 ', '5', '#05', '#a5', 'div#x', '#5 > span'].map((t) => { try { return [t, normalizeTarget(t)]; } catch (e) { return [t, 'ERR:' + e.name]; } });
const ntBad = ['#5]', '[#5'].map((t) => { try { normalizeTarget(t); return [t, 'NO-ERR']; } catch (e) { return [t, e.name]; } });
res.push(['normalizeTarget table', true, nt.concat(ntBad)]);
ok('normalizeTarget #N/[#N] mapped verbatim, others untouched, half-bracketed rejected', nt[0][1] === '[data-sd-node-id="5"]' && nt[1][1] === '[data-sd-node-id="5"]' && nt[2][1] === '[data-sd-node-id="5"]' && nt[4][1] === '[data-sd-node-id="05"]' && nt[5][1] === '#a5' && nt[6][1] === 'div#x' && nt[7][1] === '#5 > span' && ntBad.every((x) => x[1] === 'InvalidSelectorError'), nt.concat(ntBad));
const line = JSON.stringify(res);
console.log(line);
console.log(`checks=${res.length} fails=${fails} sha256=${createHash('sha256').update(line).digest('hex')} node=${process.version} platform=${process.platform}`);
process.exitCode = fails === 0 ? 0 : 1;
