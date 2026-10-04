#!/usr/bin/env node
// check-evidence.mjs (revision 3): mechanical evidence checks (protocol 4.3).
//   node check-evidence.mjs <runsDir> [--blind] [--json]
// <runsDir> contains <slot>/<taskId>.json records and <slot>/raw/<taskId>.jsonl logs.
// --blind omits every class-revealing field from the output (used to build verify-input/).
//
// Checks per task (FAIL codes):
//   C1  log exists; hash chain intact (seq contiguous, prevHash links, hashes recompute); no `gap` records.
//   C2  each answerFields[i] = {field, value, logSeq, excerpt}:
//       a) logSeq is a kind=cli record of a page-reading verb (text|snap|axsnap|read|links) with exit 0;
//          raw `eval` output is never evidence;
//       b) that read is not tainted: no raw `eval` in the same attempt after the attempt's last `nav` before it;
//       c) its attempt began with `nav <task startingUrl>` as the first CLI call;
//       d) norm(excerpt) is a substring of norm(stdout); excerpt length >= 20 chars (or the whole stdout if shorter);
//       e) extract fields: norm(value) is a substring of norm(excerpt) and value length >= 1;
//          summary fields: excerpt length >= 40;
//       f) echo ban: for values of >= 4 chars, norm(value) must not occur in the argv of any `type`, `select`,
//          `press` or raw `eval` call of that attempt, unless it also occurs in the task text;
//       g) domain fence: the page URL of that read (its auto-href record) has a registrable domain in the task's
//          allowed set or the attempt's starting-URL auto-redirect domain; a different domain reached directly
//          after a click/clicktext/clickrole/press is accepted only as `linked-org` (flagged, cannot be strict);
//          anything else FAILs.
//   C3  excerpt <= 300 chars.
//   C4  tool-call counts derived from the log (driver calls only).
//   C5  every attempt with a nav ends with `close` exit 0 followed by a passing check-clean.
//   C6  refused / timed-out / gap records are reported.
//   C7  COMPLETED (blind: any record with answerFields) needs every task-fields.json key covered by `min` DISTINCT
//       values, unless shortList is given (flagged).
// Revision 4 (review-3): attrs is an evidence verb; taint covers waitfor --js and back/focustab after driver JS;
// echo is case-insensitive and includes URL-decoded nav/newtab args (exempt if seen in an earlier page read);
// auto-href fallback for reads; focustab linked-org entry; geo-redirect flag; zero-width chars stripped (lib.norm).
// Revision 5 (review-4): attrs evidence counts only innerText + attribute VALUES (names are driver-supplied and are
// stripped); a value equal to/contained in any driver-supplied attrs/read/links argument is an echo (C2f); the
// "seen earlier" echo exemption counts only untainted reads on allowed domains; C8 checks AGENT-FAIL(evidence-rule)
// claims: needs uncitedValue; no read verb may have failed; visible text missing from `text` makes it SUTRADHAR-FAIL.
// Exit 0 iff every task passes. Self-tested by tests/selftest/run.mjs.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { LOOP, genesis, hashRecord, regDomain, taskInfo, sameUrl, norm, normLower, urlDecoded, EVIDENCE_VERBS, runsDriverJs, HISTORY_VERBS } from './lib.mjs';

const root = process.argv[2];
const blind = process.argv.includes('--blind');
const asJson = process.argv.includes('--json');
const FIELDS = JSON.parse(readFileSync(path.join(LOOP, 'task-fields.json'), 'utf8'));
const CLICKY = new Set(['click', 'clicktext', 'clickrole', 'press']);
const ECHO_VERBS = new Set(['type', 'select', 'press', 'eval', 'nav', 'newtab', 'waitfor']);
// The text a call injected or requested, as an echo source (URL-decoded for nav/newtab; only --js for waitfor).
// For URLs only the driver-chosen free text counts: query string, fragment, and path segments containing encoded
// spaces ('%20' or '+'), e.g. /search/climate%20change. Plain path words (/news/politics) are site structure.
const urlFreeText = (u) => { try { const x = new URL(u); return [x.search, x.hash, ...x.pathname.split('/').filter((p) => /%20|\+/.test(p))].map(urlDecoded).join(' '); } catch { return urlDecoded(u); } };
const echoText = (r) => r.verb === 'nav' || r.verb === 'newtab' ? r.argv.slice(1).filter((x) => !x.startsWith('--')).map(urlFreeText).join(' ')
  : r.verb === 'waitfor' ? (runsDriverJs('waitfor', r.argv) ? r.argv[r.argv.indexOf('--js') + 1] : '') : r.argv.slice(1).join(' ');
// attrs output is "innerText | n1=v1 n2=v2" per line; names come from the driver (dargs[1]). Evidence text keeps
// innerText and the values only, so a driver cannot launder prose through an attribute NAME (review-4 B).
function attrsValueText(r) {
  const names = String(r.dargs?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!names.length) return '';
  return String(r.stdout ?? '').split('\n').map((line) => {
    const i = line.indexOf(' | ');
    if (i < 0) return line;
    let rest = line.slice(i + 3);
    for (const n of names) rest = rest.split(`${n}=`).join('\u0000');
    return line.slice(0, i) + ' | ' + rest.split('\u0000').map((v) => v.trim()).filter(Boolean).join(' | ');
  }).join('\n');
}
// The text of a read that may support a value: full stdout, except attrs (value-only rendering).
const readText = (r) => (r.verb === 'attrs' ? attrsValueText(r) : String(r.stdout ?? ''));
const results = [];

for (const slot of readdirSync(root).filter((d) => statSync(path.join(root, d)).isDirectory())) {
  const dir = path.join(root, slot);
  for (const f of readdirSync(dir).filter((x) => /^[\w-]+\.json$/.test(x) && !x.startsWith('check-'))) {
    const id = f.replace(/\.json$/, '');
    const rec = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const task = taskInfo(id);
    const problems = [];
    const flags = [];
    if (!task) { results.push({ slot, id, pass: false, problems: ['C0 unknown task id'], flags }); continue; }
    const logPath = path.join(dir, 'raw', `${id}.jsonl`);
    let log = [];
    // ---- C1
    if (!existsSync(logPath)) problems.push('C1 no raw log');
    else {
      log = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      let prev = genesis(slot, id);
      log.forEach((r, i) => {
        const { hash, ...base } = r;
        if (r.seq !== i + 1) problems.push(`C1 seq gap at line ${i + 1}`);
        if (r.prevHash !== prev) problems.push(`C1 broken link at seq ${r.seq}`);
        if (hashRecord(base) !== hash) problems.push(`C1 hash mismatch at seq ${r.seq}`);
        if (r.kind === 'gap') problems.push(`C1 unlogged state change before seq ${r.seq}`);
        prev = hash;
      });
    }
    const bySeq = new Map(log.map((r) => [r.seq, r]));
    const ownHref = (seq) => { const a = log.find((r) => r.kind === 'auto-href' && r.forSeq === seq); try { return JSON.parse(a.stdout.trim()).href || null; } catch { return null; } };
    // Fallback (review-3 finding 4): a non-navigating read whose own auto-href failed inherits the previous call's URL.
    const hrefOf = (seq) => {
      const own = ownHref(seq); if (own) return own;
      const r = bySeq.get(seq); if (!r || !EVIDENCE_VERBS.has(r.verb)) return null;
      const prevCli = log.filter((x) => x.kind === 'cli' && x.attempt === r.attempt && x.seq < seq).pop();
      return prevCli ? ownHref(prevCli.seq) : null;
    };
    const attemptInfo = (att) => {
      const a = log.filter((r) => r.attempt === att);
      const cli = a.filter((r) => r.kind === 'cli');
      const first = cli[0];
      const startOk = !!first && first.verb === 'nav' && sameUrl(first.argv.slice(1).find((x) => !x.startsWith('--')), task.startingUrl);
      const redirectHref = first ? hrefOf(first.seq) : null;
      const allowed = new Set(task.allowed);
      if (startOk && redirectHref) allowed.add(regDomain(redirectHref));
      return { a, cli, startOk, allowed };
    };
    // Taint of a read at seq (review-3 finding 2): driver JS after the last nav, or driver JS earlier in the attempt plus
    // back/focustab after the last nav. Returns a reason string or null.
    const taintOf = (r) => {
      const before = log.filter((x) => x.kind === 'cli' && x.attempt === r.attempt && x.seq < r.seq);
      const lastNav = [...before].reverse().find((x) => x.verb === 'nav' && x.exit === 0);
      const afterNav = (x) => !lastNav || x.seq > lastNav.seq;
      const js = before.filter((x) => runsDriverJs(x.verb, x.argv));
      if (js.some(afterNav)) return 'read after driver JavaScript without a fresh nav (tainted)';
      if (js.length && before.some((x) => HISTORY_VERBS.has(x.verb) && afterNav(x))) return 'read after back/focustab in an attempt that ran driver JavaScript (tainted)';
      return null;
    };
    // A read that may count as "seen earlier" for the echo exemption: evidence verb, exit 0, untainted, on an allowed
    // domain of its attempt (review-4 C).
    const cleanRead = (x) => EVIDENCE_VERBS.has(x.verb) && x.exit === 0 && !taintOf(x) && (() => { const h = hrefOf(x.seq); return !!h && attemptInfo(x.attempt).allowed.has(regDomain(h)); })();
    // ---- C2, C3
    const fields = rec.answerFields ?? [];
    for (const [k, af] of fields.entries()) {
      const tag = `answerFields[${k}](${af.field})`;
      const src = bySeq.get(af.logSeq);
      if (!src) { problems.push(`C2a ${tag} logSeq ${af.logSeq} not in log`); continue; }
      if (src.kind !== 'cli' || !EVIDENCE_VERBS.has(src.verb)) { problems.push(`C2a ${tag} seq ${af.logSeq} is ${src.kind}/${src.verb}: not a page-reading verb`); continue; }
      if (src.exit !== 0) problems.push(`C2a ${tag} seq ${af.logSeq} exited ${src.exit}`);
      const { cli, startOk, allowed } = attemptInfo(src.attempt);
      if (!startOk) problems.push(`C2c ${tag} attempt ${src.attempt} did not start with nav to ${task.startingUrl}`);
      const taint = taintOf(src);
      if (taint) problems.push(`C2b ${tag} seq ${af.logSeq} ${taint}`);
      const nStdout = norm(src.stdout);
      const nEx = norm(af.excerpt);
      if (!nStdout.includes(nEx)) problems.push(`C2d ${tag} excerpt not found verbatim in seq ${af.logSeq} output`);
      if (nEx.length < Math.min(20, nStdout.length)) problems.push(`C2d ${tag} excerpt ${nEx.length} chars < 20`);
      const spec = (FIELDS[id] ?? []).find((s) => s.key === af.field);
      if (!spec) problems.push(`C2e ${tag} field key not pre-registered for task ${id}`);
      else if (spec.type === 'extract') {
        if (!norm(af.value) || !nEx.includes(norm(af.value))) problems.push(`C2e ${tag} value not contained in its excerpt`);
      } else if (nEx.length < 40) problems.push(`C2e ${tag} summary support excerpt < 40 chars`);
      // Echo (review-3 finding 3): case-insensitive; sources include URL-decoded nav/newtab args and waitfor --js.
      // Exempt: the value is in the task text, or it appeared in a page-reading output logged before the echoing call.
      const nv = normLower(af.value);
      // attrs: the value must be in the innerText/attribute-VALUE rendering, never only in an echoed attribute name
      if (src.verb === 'attrs' && spec?.type === 'extract' && !normLower(readText(src)).includes(nv)) problems.push(`C2e ${tag} value appears in attrs seq ${af.logSeq} only as driver-supplied attribute-name text, not as page text or an attribute value`);
      // driver-supplied arguments of read/links/attrs (selector, attribute names) are never evidence for that value
      const ownArg = [src].find((r) => ['attrs', 'read', 'links'].includes(r.verb) && nv.length >= 3 && (r.dargs ?? []).some((a) => normLower(a).includes(nv)));
      if (ownArg && spec?.type === 'extract' && !normLower(task.task ?? '').includes(nv)) problems.push(`C2f ${tag} value matches a driver-supplied ${src.verb} argument (seq ${src.seq})`);
      if (spec?.type === 'extract' && nv.length >= 4 && !normLower(task.task ?? '').includes(nv)) {
        const isStart = (r) => r.verb === 'nav' && sameUrl(r.argv.slice(1).find((x) => !x.startsWith('--')), task.startingUrl);
        const echo = cli.filter((r) => r.seq <= src.seq).find((r) => ECHO_VERBS.has(r.verb) && !isStart(r) && normLower(echoText(r)).includes(nv)
          && !cli.some((x) => x.seq < r.seq && cleanRead(x) && normLower(readText(x)).includes(nv)));
        if (echo) problems.push(`C2f ${tag} value occurs in the driver's own ${echo.verb} argv (seq ${echo.seq})`);
      }
      const href = hrefOf(src.seq);
      const d = href ? regDomain(href) : null;
      if (!d) problems.push(`C2g ${tag} no page URL logged for seq ${af.logSeq}`);
      else if (!task.allowed.includes(d) && allowed.has(d)) flags.push(`geo-redirect:${d}@${af.logSeq}`);
      else if (!allowed.has(d)) {
        // linked-org: the first call of this attempt that landed on d must be a click-type call made from a page on
        // an allowed domain, and the attempt must have stayed on d (or allowed domains) since then.
        const upTo = cli.filter((r) => r.seq <= src.seq);
        const entryIdx = upTo.findIndex((r) => hrefOf(r.seq) && regDomain(hrefOf(r.seq)) === d);
        const entry = upTo[entryIdx];
        const fromHref = entryIdx > 0 ? hrefOf(upTo[entryIdx - 1].seq) : null;
        const stayed = upTo.slice(entryIdx).every((r) => { const h = hrefOf(r.seq); return !h || regDomain(h) === d || allowed.has(regDomain(h)); });
        // entry by click from an allowed page; or by focustab onto a tab that appeared after such a click (new-tab links)
        const clickedFromAllowed = (r) => CLICKY.has(r.verb) && (() => { const p = cli.filter((x) => x.seq < r.seq).pop(); const h = p ? hrefOf(p.seq) : null; return !!h && allowed.has(regDomain(h)); })();
        const viaTab = entry && entry.verb === 'focustab' && upTo.slice(0, entryIdx).some(clickedFromAllowed) && !upTo.slice(0, entryIdx).some((r) => r.verb === 'newtab');
        if (entry && ((CLICKY.has(entry.verb) && fromHref && allowed.has(regDomain(fromHref))) || viaTab) && stayed) flags.push(`linked-org:${d}@${af.logSeq}`);
        else problems.push(`C2g ${tag} read on ${d}, outside allowed [${[...allowed].join(', ')}]`);
      }
      if (String(af.excerpt ?? '').length > 300) problems.push(`C3 ${tag} excerpt ${String(af.excerpt).length} chars > 300`);
    }
    // ---- C8 (review-4 A): an AGENT-FAIL(evidence-rule) claim is valid only if every read verb behaved correctly.
    if (!blind && rec.classification === 'AGENT-FAIL' && rec.subflag === 'evidence-rule') {
      const uv = rec.uncitedValue;
      const seen = uv ? bySeq.get(uv.logSeq) : null;
      if (!uv || !uv.value || !seen) problems.push('C8a evidence-rule needs uncitedValue {value, logSeq} pointing at the eval/screenshot that showed it');
      else {
        if (!(seen.kind === 'cli' && ['eval', 'screenshot'].includes(seen.verb))) problems.push(`C8a uncitedValue seq ${uv.logSeq} is ${seen.kind}/${seen.verb}, not an eval/screenshot`);
        const att = seen.attempt;
        const readsInAtt = log.filter((r) => r.kind === 'cli' && r.attempt === att && EVIDENCE_VERBS.has(r.verb));
        const bad = readsInAtt.find((r) => r.exit !== 0 || r.timedOut);
        if (bad) problems.push(`C8b read verb ${bad.verb} seq ${bad.seq} exited ${bad.exit}${bad.timedOut ? ' (timeout)' : ''}: a failed Sutradhar read makes this SUTRADHAR-FAIL, not AGENT-FAIL(evidence-rule)`);
        const v = normLower(uv.value);
        const visibleTextEval = seen.verb === 'eval' && /innerText|textContent/.test(seen.argv.join(' ')) && normLower(seen.stdout).includes(v);
        if (visibleTextEval) {
          const page = hrefOf(seen.seq);
          const missingIn = readsInAtt.find((r) => r.verb === 'text' && r.exit === 0 && hrefOf(r.seq) === page && !normLower(r.stdout).includes(v));
          if (missingIn) problems.push(`C8c value is visible text (eval seq ${seen.seq} innerText/textContent) but text seq ${missingIn.seq} on the same page omits it: a Sutradhar read defect, classify SUTRADHAR-FAIL`);
        }
      }
    }
    // ---- C4
    const driverCli = log.filter((r) => r.kind === 'cli');
    const toolsUsed = {};
    for (const r of driverCli) toolsUsed[r.verb] = (toolsUsed[r.verb] ?? 0) + 1;
    // ---- C5
    for (const att of [...new Set(log.map((r) => r.attempt))]) {
      const a = log.filter((r) => r.attempt === att);
      if (!a.some((r) => r.kind === 'cli' && r.verb === 'nav')) continue;
      const lastCli = [...a].reverse().find((r) => r.kind === 'cli');
      if (!(lastCli && lastCli.verb === 'close' && lastCli.exit === 0)) problems.push(`C5 ${att}: last CLI call is not a successful close`);
      if (!a.slice(a.indexOf(lastCli) + 1).some((r) => r.kind === 'check-clean' && r.exit === 0)) problems.push(`C5 ${att}: no passing check-clean after close`);
    }
    // ---- C7
    // C7 (review-3 finding 5): distinct values; in --blind mode applied to any record that claims answers.
    if (blind ? fields.length > 0 : rec.classification === 'COMPLETED') {
      for (const s of FIELDS[id] ?? []) {
        const n = new Set(fields.filter((x) => x.field === s.key).map((x) => normLower(x.value))).size;
        if (n < s.min) {
          if (rec.shortList?.logSeq) flags.push(`short-list:${s.key}=${n}/${s.min}`);
          else problems.push(`C7 field ${s.key}: ${n} of ${s.min} required values`);
        }
      }
    }
    const out = {
      slot, id, pass: problems.length === 0, problems, flags,
      derived: { toolCalls: driverCli.length, toolsUsed },
      refused: log.filter((r) => r.kind === 'refused').map((r) => `${r.seq}:${r.exit}`),
      timedOut: log.filter((r) => r.timedOut).map((r) => r.seq),
      rawEvals: driverCli.filter((r) => r.verb === 'eval').map((r) => r.seq),
      fingerprints: [...new Set(log.filter((r) => r.kind === 'auto-href').map((r) => { try { const j = JSON.parse(r.stdout.trim()); return `${j.inner}|${j.webdriver}|${j.ua}`; } catch { return null; } }).filter(Boolean))],
    };
    if (!blind) out.classification = rec.classification ?? null;
    results.push(out);
  }
}
if (asJson) console.log(JSON.stringify(results, null, 2));
else for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.slot}/${r.id}${blind ? '' : ' ' + (r.classification ?? '-')} calls=${r.derived?.toolCalls ?? 0}${r.flags.length ? ' flags=' + r.flags.join(',') : ''}${r.problems.length ? ' :: ' + r.problems.join(' | ') : ''}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
