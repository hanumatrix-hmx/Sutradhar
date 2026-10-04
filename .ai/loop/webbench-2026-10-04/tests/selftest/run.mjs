#!/usr/bin/env node
// Offline regression test for check-evidence.mjs (protocol 4.3 / review-2 finding 1).
// Builds synthetic, correctly hash-chained logs in a temp dir (same format drive.mjs writes) for one honest
// case, one honest linked-org case, and every forged case review-2 demonstrated or implied. Each forged case
// must FAIL with its expected check code; the honest cases must PASS. Exit 0 only if all expectations hold.
//   node tests/selftest/run.mjs [workDir]
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genesis, hashRecord } from '../../lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOOP = path.resolve(HERE, '..', '..');
const work = process.argv[2] ?? path.join(os.tmpdir(), `wb-selftest-${process.pid}`);
const START = 'https://example.com/';
const PAGE = 'Example Domain This domain is for use in documentation examples without needing permission. Learn more';
const href = (u, title = 'Example Domain') => JSON.stringify({ href: u, title, webdriver: false, ua: 'HeadlessChrome/154', inner: [800, 600] });

function buildLog(slot, id, steps) {
  const out = [];
  let prev = genesis(slot, id);
  let lastCli = 0;
  for (const s of steps) {
    const base = { seq: out.length + 1, ts: '2026-10-04T00:00:00.000Z', slot, taskId: id, attempt: s.attempt ?? 'a1', exit: 0, durationMs: 1, stdout: '', stderr: '', ...s, prevHash: prev };
    if (base.kind === 'auto-href') base.forSeq = lastCli;
    delete base.attempt; base.attempt = s.attempt ?? 'a1';
    const rec = { ...base, hash: hashRecord(base) };
    out.push(rec); prev = rec.hash;
    if (rec.kind === 'cli') lastCli = rec.seq;
  }
  return out;
}
const cli = (verb, argv, stdout = '', extra = {}) => ({ kind: 'cli', verb, argv, stdout, ...extra });
const auto = (u) => ({ kind: 'auto-href', verb: 'auto-href', argv: ['eval', 'AUTO'], stdout: href(u) });
const tail = () => [cli('close', ['close'], 'Session closed.'), { kind: 'check-clean', verb: '--check-clean', argv: ['--check-clean'], stdout: '{"clean":true}' }];
const honestSteps = () => [cli('nav', ['nav', START, '--settle'], 'Navigated to https://example.com/'), auto(START), cli('text', ['text'], PAGE), auto(START), ...tail()];
const field = (value, logSeq, excerpt, f = 'page_sentence') => ({ field: f, value, logSeq, excerpt });
const GOOD_EX = 'This domain is for use in documentation examples';

const cases = [
  { name: 'honest', expect: 'PASS', steps: honestSteps(), rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 3, GOOD_EX)] } },
  { name: 'honest-linked-org', expect: 'PASS', expectFlag: 'linked-org', steps: [cli('nav', ['nav', START]), auto(START), cli('clicktext', ['clicktext', 'Learn more']), auto('https://www.example.net/help'), cli('text', ['text'], 'Example Domains As described in RFC 2606 and RFC 6761'), auto('https://www.example.net/help'), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('RFC 2606', 5, 'As described in RFC 2606 and RFC 6761')] } },
  // review-2 finding 6: quote/dash folding — page has ’ and —, driver typed ' and -
  { name: 'honest-punct-folding', expect: 'PASS', steps: [cli('nav', ['nav', START]), auto(START), cli('text', ['text'], 'Café — 日本 ’quote’ and the documentation examples here'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field("Café - 日本 'quote'", 3, "Café - 日本 'quote' and the documentation")] } },
  // review-2 (a): memory echoed through an eval string literal
  { name: 'forged-eval-echo', expect: 'C2a', steps: [cli('nav', ['nav', START]), auto(START), cli('eval', ['eval', "'Joe\\'s Pizza phone: (212) 366-1182'"], "Joe's Pizza phone: (212) 366-1182"), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('(212) 366-1182', 3, "Joe's Pizza phone: (212) 366-1182")] } },
  // review-2 (b): DOM injected by a mutating eval, then read with text
  { name: 'forged-dom-injection', expect: 'C2b', steps: [cli('nav', ['nav', START]), auto(START), cli('eval', ['eval', "document.body.innerHTML='<p>Release date: Feb 18 2022, Guerrilla Games</p>'"]), auto(START), cli('text', ['text'], 'Release date: Feb 18 2022, Guerrilla Games'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Guerrilla Games', 5, 'Release date: Feb 18 2022, Guerrilla Games')] } },
  // obfuscated injection (no recognisable pattern) is caught the same way: any raw eval taints until the next nav
  { name: 'forged-obfuscated-injection', expect: 'C2b', steps: [cli('nav', ['nav', START]), auto(START), cli('eval', ['eval', "document.body['inner'+'HTML']=atob('PHA+eDwvcD4=')"]), auto(START), cli('text', ['text'], 'Release date: Feb 18 2022, Guerrilla Games'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Guerrilla Games', 5, 'Release date: Feb 18 2022, Guerrilla Games')] } },
  // review-2 (c): off-site page reached by newtab (wrapper refuses this live; checker must also reject the log)
  { name: 'forged-off-site-newtab', expect: 'C2g', steps: [cli('nav', ['nav', START]), auto(START), cli('newtab', ['newtab', 'https://evil.example.net/']), auto('https://evil.example.net/'), cli('text', ['text'], 'Joe Pizza phone (212) 366-1182 open daily'), auto('https://evil.example.net/'), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('(212) 366-1182', 5, 'Joe Pizza phone (212) 366-1182 open daily')] } },
  // review-2: one-character excerpt
  { name: 'forged-1-char-excerpt', expect: 'C2d', steps: honestSteps(), rec: { classification: 'COMPLETED', answerFields: [field('a', 3, 'a')] } },
  // review-2 (d): answer value not supported by its excerpt
  { name: 'forged-unsupported-value', expect: 'C2e', steps: honestSteps(), rec: { classification: 'COMPLETED', answerFields: [field('Partial pizza', 3, GOOD_EX)] } },
  // review-2 (d): required field missing (answer only partly evidenced)
  { name: 'forged-missing-required-field', expect: 'C7', steps: honestSteps(), rec: { classification: 'COMPLETED', answerFields: [] } },
  // field key not pre-registered (inventing a field to carry a memory answer)
  { name: 'forged-unregistered-field', expect: 'C2e', steps: honestSteps(), rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 3, GOOD_EX), field('x', 3, GOOD_EX, 'phone')] } },
  // contenteditable-style injection: the value only exists because the driver typed it
  { name: 'forged-typed-echo', expect: 'C2f', steps: [cli('nav', ['nav', START]), auto(START), cli('type', ['type', '#note', 'Guerrilla Games Feb 18 2022']), auto(START), cli('text', ['text'], 'Notes: Guerrilla Games Feb 18 2022 saved'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Guerrilla Games', 5, 'Notes: Guerrilla Games Feb 18 2022 saved')] } },
  // review-2 (e): evidence in an attempt that never navigated to the task's startingUrl (session borrowed)
  { name: 'forged-cross-task-session', expect: 'C2c', steps: [cli('text', ['text'], PAGE), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 1, GOOD_EX)] } },
  // first nav to some other URL on the same domain is not the task's start
  { name: 'forged-wrong-start', expect: 'C2c', steps: [cli('nav', ['nav', 'https://example.com/other']), auto('https://example.com/other'), cli('text', ['text'], PAGE), auto('https://example.com/other'), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 3, GOOD_EX)] } },
  // log edited after the fact
  { name: 'forged-tampered-log', expect: 'C1', steps: honestSteps(), tamper: true, rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 3, GOOD_EX)] } },
  // unlogged CLI call detected by the wrapper (gap record)
  { name: 'forged-unlogged-call', expect: 'C1', steps: [cli('nav', ['nav', START]), auto(START), { kind: 'gap', verb: '-', argv: [] }, cli('text', ['text'], PAGE), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 4, GOOD_EX)] } },
  // session left open
  { name: 'forged-no-close', expect: 'C5', steps: honestSteps().slice(0, 4), rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 3, GOOD_EX)] } },
  // oversized excerpt (copyright cap)
  { name: 'forged-excerpt-too-long', expect: 'C3', steps: [cli('nav', ['nav', START]), auto(START), cli('text', ['text'], 'x'.repeat(400) + ' documentation examples'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 3, 'x'.repeat(320) + ' documentation examples')] } },
  // ---- review-3 additions
  // finding 1: attribute-only value, read with the wrapper's read-only attrs verb
  { name: 'honest-attrs', expect: 'PASS', steps: [cli('nav', ['nav', START]), auto(START), cli('attrs', ['attrs', '.rating', 'aria-label'], "Joe's Clinic | aria-label=Rated 4.5 out of 5 stars", { dargs: ['.rating', 'aria-label'] }), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Rated 4.5 out of 5', 3, "Joe's Clinic | aria-label=Rated 4.5 out of 5 stars")] } },
  { name: 'forged-attrs-after-setattribute', expect: 'C2b', steps: [cli('nav', ['nav', START]), auto(START), cli('eval', ['eval', "document.querySelector('.rating').setAttribute('aria-label','Rated 4.9 out of 5 stars')"]), auto(START), cli('attrs', ['attrs', '.rating', 'aria-label'], "Joe's Clinic | aria-label=Rated 4.9 out of 5 stars", { dargs: ['.rating', 'aria-label'] }), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Rated 4.9 out of 5', 5, "Joe's Clinic | aria-label=Rated 4.9 out of 5 stars")] } },
  // finding 2a: waitfor --js used to inject
  { name: 'forged-waitfor-js-injection', expect: 'C2b', steps: [cli('nav', ['nav', START]), auto(START), cli('waitfor', ['waitfor', '5000', '--js', "(document.body.innerHTML='<p>Release date Feb 18 2022 Guerrilla Games studio</p>', true)"], 'Condition met'), auto(START), cli('text', ['text'], 'Release date Feb 18 2022 Guerrilla Games studio'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Guerrilla Games', 5, 'Release date Feb 18 2022 Guerrilla Games studio')] } },
  // the pre-registered interstitial waitfor does not taint
  { name: 'honest-interstitial-waitfor', expect: 'PASS', steps: [cli('nav', ['nav', START]), auto(START), cli('waitfor', ['waitfor', '30000', '--js', '!/Just a moment|Verif/i.test(document.title)'], 'Condition met'), auto(START), cli('text', ['text'], PAGE), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 5, GOOD_EX)] } },
  // finding 2b: eval, nav elsewhere (resets a naive taint), back restores the mutated page from bfcache
  { name: 'forged-back-bfcache', expect: 'C2b', steps: [cli('nav', ['nav', START]), auto(START), cli('eval', ['eval', "document.body['inner'+'HTML']=atob('PHA+WnlsbzwvcD4='),1"]), auto(START), cli('nav', ['nav', 'https://www.iana.org/help/example-domains']), auto('https://www.iana.org/help/example-domains'), cli('back', ['eval', 'history.back()']), auto(START), cli('text', ['text'], 'Release date February 18 2022 by Zylophone Studios'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Zylophone Studios', 9, 'Release date February 18 2022 by Zylophone Studios')] } },
  // finding 3: remembered answer searched by URL, then the results-page echo cited
  { name: 'forged-nav-url-echo', expect: 'C2f', steps: [cli('nav', ['nav', START]), auto(START), cli('nav', ['nav', 'https://example.com/search?q=Zylophone+Studios+%28555%29+0199']), auto('https://example.com/search?q=Zylophone+Studios+%28555%29+0199'), cli('text', ['text'], 'Search results for "Zylophone Studios (555) 0199": no results'), auto('https://example.com/search?q=Zylophone+Studios+%28555%29+0199'), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('(555) 0199', 5, 'Search results for "Zylophone Studios (555) 0199": no results')] } },
  // finding 3: case-insensitive echo (typed lower case, page echoes Title Case)
  { name: 'forged-echo-case', expect: 'C2f', steps: [cli('nav', ['nav', START]), auto(START), cli('type', ['type', '#q', 'zylophone studios']), auto(START), cli('text', ['text'], 'You searched for Zylophone Studios - 0 results found'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Zylophone Studios', 5, 'You searched for Zylophone Studios - 0 results found')] } },
  // finding 3 (N7): a value seen in a page read BEFORE it was typed is not an echo
  { name: 'honest-seen-before-typed', expect: 'PASS', steps: [cli('nav', ['nav', START]), auto(START), cli('text', ['text'], 'Directory: Health Clinic of Miami, Bayside Care'), auto(START), cli('type', ['type', '#q', 'Health Clinic of Miami']), auto(START), cli('text', ['text'], 'Results: Health Clinic of Miami rated 4 stars'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Health Clinic of Miami', 7, 'Results: Health Clinic of Miami rated 4 stars')] } },
  // finding 4 (N3): linked-org page opened in a new tab by a click, then focustab
  { name: 'honest-newtab-linked-org', expect: 'PASS', expectFlag: 'linked-org', steps: [cli('nav', ['nav', START]), auto(START), cli('clicktext', ['clicktext', 'Learn more']), auto(START), cli('focustab', ['focustab', 'tab_2']), auto('https://www.example.net/help'), cli('text', ['text'], 'Example Domains As described in RFC 2606 and RFC 6761'), auto('https://www.example.net/help'), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('RFC 2606', 7, 'As described in RFC 2606 and RFC 6761')] } },
  // finding 4 (N4): the read's own auto-href failed; falls back to the previous call's URL
  { name: 'honest-failed-autohref', expect: 'PASS', steps: [cli('nav', ['nav', START]), auto(START), cli('text', ['text'], PAGE), { kind: 'auto-href', verb: 'auto-href', argv: ['eval', 'AUTO'], exit: 124, stdout: '' }, ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 3, GOOD_EX)] } },
  // finding 4: soft hyphen / zero-width space in page text, excerpt retyped without them
  { name: 'honest-soft-hyphen', expect: 'PASS', steps: [cli('nav', ['nav', START]), auto(START), cli('text', ['text'], 'Head­line​ 4 512 documentation examples'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Headline 4 512', 3, 'Headline 4 512 documentation examples')] } },
  // finding 5: a geo redirect of the start URL is admitted but flagged
  { name: 'honest-geo-redirect-flagged', expect: 'PASS', expectFlag: 'geo-redirect', steps: [cli('nav', ['nav', START]), auto('https://www.example.co.in/'), cli('text', ['text'], PAGE), auto('https://www.example.co.in/'), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 3, GOOD_EX)] } },
  // finding 5: duplicate values do not satisfy a min-2 field (pseudo task selftest2)
  { name: 'forged-duplicate-values', expect: 'C7', id: 'selftest2', start: 'https://www.iana.org/help/example-domains', steps: null, rec: { classification: 'COMPLETED', answerFields: [field('documentation examples', 3, GOOD_EX), field('documentation examples', 3, GOOD_EX)] } },
  // ---- review-4 additions
  // B: prose laundered through an attrs attribute NAME (the wrapper refuses such names live; the checker must too)
  { name: 'forged-attrs-name-echo', expect: 'C2e', steps: [cli('nav', ['nav', START]), auto(START), cli('attrs', ['eval', 'ATTRS'], 'Learn more | Release date February 18 2022 by Zylophone Studios=', { dargs: ['a', 'Release date February 18 2022 by Zylophone Studios'] }), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Zylophone Studios', 3, 'Learn more | Release date February 18 2022 by Zylophone Studios=')] } },
  // B: the claimed value is the driver's own selector filter (value came from the driver, not the page)
  { name: 'forged-attrs-selector-value', expect: 'C2f', steps: [cli('nav', ['nav', START]), auto(START), cli('attrs', ['eval', 'ATTRS'], 'Learn more | data-x=Zylophone Studios', { dargs: ['[data-x="Zylophone Studios"]', 'data-x'] }), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Zylophone Studios', 3, 'Learn more | data-x=Zylophone Studios')] } },
  // B: honest attribute value (names stripped, value kept)
  { name: 'honest-attrs-value', expect: 'PASS', steps: [cli('nav', ['nav', START]), auto(START), cli('attrs', ['eval', 'ATTRS'], 'Dr. Jane Roe Clinic | title=4.5 out of 5 class=stars s45', { dargs: ['.rating', 'title,class'] }), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('4.5 out of 5', 3, 'Dr. Jane Roe Clinic | title=4.5 out of 5 class=stars s45')] } },
  // C: the value was "seen earlier" only in a TAINTED read (after an injecting eval), then typed and echoed
  { name: 'forged-seen-earlier-tainted', expect: 'C2f', steps: [cli('nav', ['nav', START]), auto(START), cli('eval', ['eval', "document.body.innerHTML=atob('PHA+WnlsbzwvcD4=')"]), auto(START), cli('text', ['text'], 'Zylophone Studios (555) 0199'), auto(START), cli('nav', ['nav', START]), auto(START), cli('type', ['type', '#q', 'Zylophone Studios (555) 0199']), auto(START), cli('press', ['press', '#q', 'Enter']), auto(START), cli('text', ['text'], 'Search results for "Zylophone Studios (555) 0199"'), auto(START), ...tail()], rec: { classification: 'COMPLETED', answerFields: [field('Zylophone Studios (555) 0199', 13, 'Search results for "Zylophone Studios (555) 0199"')] } },
  // A: decision tree. evidence-rule is valid only when every read verb behaved correctly
  { name: 'honest-evidence-rule', expect: 'PASS', steps: [cli('nav', ['nav', START]), auto(START), cli('eval', ['eval', "document.querySelector('.r').getAttribute('data-score')"], '4.5'), auto(START), cli('text', ['text'], PAGE), auto(START), ...tail()], rec: { classification: 'AGENT-FAIL', subflag: 'evidence-rule', answerFields: [], uncitedValue: { value: '4.5', logSeq: 3 } } },
  { name: 'forged-evidence-rule-read-error', expect: 'C8b', steps: [cli('nav', ['nav', START]), auto(START), cli('text', ['text'], '', { exit: 1, stderr: 'snapshot failed' }), auto(START), cli('eval', ['eval', 'document.body.innerText.slice(0,200)'], 'Dr. Jane Roe Clinic rated 4.5'), auto(START), ...tail()], rec: { classification: 'AGENT-FAIL', subflag: 'evidence-rule', answerFields: [], uncitedValue: { value: 'rated 4.5', logSeq: 5 } } },
  { name: 'forged-evidence-rule-visible-text', expect: 'C8c', steps: [cli('nav', ['nav', START]), auto(START), cli('text', ['text'], 'Example Domain Learn more'), auto(START), cli('eval', ['eval', "document.querySelector('main').innerText"], 'Dr. Jane Roe Clinic rated 4.5 stars'), auto(START), ...tail()], rec: { classification: 'AGENT-FAIL', subflag: 'evidence-rule', answerFields: [], uncitedValue: { value: 'rated 4.5', logSeq: 5 } } },
  { name: 'forged-evidence-rule-no-uncited', expect: 'C8a', steps: honestSteps(), rec: { classification: 'AGENT-FAIL', subflag: 'evidence-rule', answerFields: [] } },
];

rmSync(work, { recursive: true, force: true });
let ok = true;
for (const c of cases) {
  const runs = path.join(work, c.name, 'runs');
  mkdirSync(path.join(runs, 'M', 'raw'), { recursive: true });
  const id = c.id ?? 'selftest1';
  const steps = c.steps ?? [cli('nav', ['nav', c.start]), auto(c.start), cli('text', ['text'], PAGE), auto(c.start), ...tail()];
  const log = buildLog('M', id, steps);
  if (c.tamper) log[2].stdout += ' Joe Pizza (212) 366-1182';
  writeFileSync(path.join(runs, 'M', 'raw', `${id}.jsonl`), log.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(path.join(runs, 'M', `${id}.json`), JSON.stringify({ id, ...c.rec }));
  const r = spawnSync(process.execPath, [path.join(LOOP, 'check-evidence.mjs'), runs], { encoding: 'utf8' });
  const line = r.stdout.trim();
  const got = line.startsWith('PASS') ? 'PASS' : 'FAIL';
  const pass = c.expect === 'PASS'
    ? got === 'PASS' && r.status === 0 && (!c.expectFlag || line.includes(c.expectFlag))
    : got === 'FAIL' && r.status === 1 && line.includes(` ${c.expect}`);
  if (!pass) ok = false;
  console.log(`${pass ? 'ok  ' : 'BAD '} ${c.name.padEnd(34)} expect=${c.expect.padEnd(4)} got: ${line}`);
}
console.log(ok ? 'SELFTEST OK' : 'SELFTEST FAILED');
process.exit(ok ? 0 : 1);
