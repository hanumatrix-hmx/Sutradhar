// lib.mjs: shared, frozen logic for drive.mjs, check-evidence.mjs, make-verify-input.mjs and tests/selftest.
// Everything that decides "is this evidence acceptable" lives here so the wrapper and checker cannot drift apart.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOOP = path.dirname(fileURLToPath(import.meta.url));

// ---------- hash chain
export function genesis(slot, taskId) { return `genesis:${slot}:${taskId}`; }
export function hashRecord(base) { return createHash('sha256').update(base.prevHash + JSON.stringify(base)).digest('hex'); }

// ---------- domains
const TWO_LEVEL = new Set(['co.uk', 'gov.uk', 'ac.uk', 'org.uk', 'com.au', 'gov.au', 'vic.gov.au', 'co.in', 'gov.in',
  'co.jp', 'com.br', 'co.nz', 'com.mx', 'com.cn', 'co.za', 'com.sg', 'nsw.gov.au']);
export function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }
export function regDomain(u) {
  let h = hostOf(u.includes('://') ? u : 'https://' + u);
  if (h.startsWith('www.')) h = h.slice(4);
  const p = h.split('.');
  for (const n of [3, 2]) if (p.length > n && TWO_LEVEL.has(p.slice(-n).join('.'))) return p.slice(-(n + 1)).join('.');
  return p.slice(-2).join('.');
}
// Registrable-domain aliases treated as the same site (same brand, dataset start URL vs. task's "Only use" line).
export const SAME_SITE_ALIASES = { 'aliexpress.us': ['aliexpress.com'], 'aliexpress.com': ['aliexpress.us'], 'shein.com': [], 'europa.eu': [] };

// ---------- tasks (frozen selection + self-test / setup pseudo-tasks)
let _sel;
export function selection() { return (_sel ??= JSON.parse(readFileSync(path.join(LOOP, 'selection.json'), 'utf8'))); }
export const PSEUDO_TASKS = {
  setup: { startingUrl: 'https://example.com/', allowed: ['example.com'] },
  selftest1: { startingUrl: 'https://example.com/', allowed: ['example.com', 'iana.org'] },
  selftest2: { startingUrl: 'https://www.iana.org/help/example-domains', allowed: ['iana.org', 'example.com'] },
};
export function taskInfo(taskId) {
  if (PSEUDO_TASKS[taskId]) return { id: taskId, ...PSEUDO_TASKS[taskId] };
  const s = selection();
  const t = [...s.primary, ...s.reserve, ...s.retest].find((x) => String(x.id) === String(taskId));
  if (!t) return null;
  const d = regDomain(t.startingUrl);
  // The task's "Only use http://X" line may name a sibling domain (e.g. aliexpress.us task says aliexpress.com).
  const only = /Only use (\S+?) to achieve/.exec(t.task)?.[1];
  const allowed = new Set([d, ...(SAME_SITE_ALIASES[d] ?? [])]);
  if (only) allowed.add(regDomain(only));
  return { id: t.id, startingUrl: t.startingUrl, task: t.task, allowed: [...allowed] };
}
export function sameUrl(a, b) { return String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, ''); }

// ---------- text normalisation for verbatim checks (NFKC, quote/dash folding, whitespace collapse)
export function norm(s) {
  return String(s ?? '').normalize('NFKC')
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ').trim();
}

// case-insensitive variant used for echo checks (review-3 finding 3)
export function normLower(s) { return norm(s).toLowerCase(); }
// URL-decoded form of a URL argument ('+' -> space), for echo checks on nav/newtab (review-3 finding 3)
export function urlDecoded(u) { try { return decodeURIComponent(String(u).replace(/\+/g, ' ')); } catch { return String(u).replace(/\+/g, ' '); } }

// ---------- verbs
// Page-reading verbs whose stdout may be cited as evidence. Raw `eval` output is NEVER evidence.
export const EVIDENCE_VERBS = new Set(['text', 'snap', 'axsnap', 'read', 'links', 'attrs']);
// Allow-list (review-3 finding 6): every driver-facing verb in driver-brief.md's table; anything else -> 98.
export const ALLOWED_VERBS = new Set(['nav', 'newtab', 'href', 'text', 'snap', 'axsnap', 'read', 'links', 'attrs', 'count',
  'click', 'clicktext', 'clickrole', 'type', 'press', 'select', 'waitfor', 'wait', 'scroll', 'back', 'tabs', 'focustab',
  'screenshot', 'status', 'eval', 'dialog', 'close', 'doctor']);
// The only `waitfor --js` expression that does not taint (byte-equal; pre-registered interstitial check).
export const INTERSTITIAL_JS = '!/Just a moment|Verif/i.test(document.title)';
// A call that can run driver-authored JavaScript in the page: raw eval, or waitfor --js other than INTERSTITIAL_JS.
export function runsDriverJs(verb, argv) {
  if (verb === 'eval') return true;
  if (verb === 'waitfor') { const i = argv.indexOf('--js'); return i >= 0 && argv[i + 1] !== INTERSTITIAL_JS; }
  return false;
}
// Calls after which the visible document may be a restored/other document rather than a fresh load (bfcache, other tab).
export const HISTORY_VERBS = new Set(['back', 'focustab']);
// Wrapper-authored read-only pseudo-verbs (driver supplies only data, which is embedded via JSON.stringify).
export function pseudoVerb(verb, args) {
  const S = (x) => JSON.stringify(String(x ?? ''));
  switch (verb) {
    case 'href': return { cli: ['eval', "location.href + ' | ' + document.title"], taints: false };
    case 'back': return { cli: ['eval', 'history.back()'], taints: false };
    case 'status': return { cli: ['eval', "JSON.stringify(performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource')).slice(-30).map(e=>[e.name.slice(0,120),e.responseStatus]))"], taints: false };
    case 'count': return { cli: ['eval', `document.querySelectorAll(${S(args[0])}).length`], taints: false };
    case 'read': return { cli: ['eval', `(()=>{const n=[...document.querySelectorAll(${S(args[0])})].slice(0,60);return n.length?n.map(e=>e.innerText.trim()).join('\\n---\\n'):'[read: 0 matches]'})()`], taints: false };
    // attrs <css> <name[,name...]>: one line per match: "innerText | name=value ...". Read-only (getAttribute only).
    case 'attrs': return { cli: ['eval', `(()=>{const names=${S(args[1] ?? '')}.split(',').map(s=>s.trim()).filter(Boolean);const n=[...document.querySelectorAll(${S(args[0])})].slice(0,60);return n.length?n.map(e=>(e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,200)+' | '+names.map(a=>a+'='+(e.getAttribute(a)??'')).join(' ')).join('\\n'):'[attrs: 0 matches]'})()`], taints: false };
    case 'links': return { cli: ['eval', `(()=>{const n=[...document.querySelectorAll(${S(args[0])})].filter(e=>e.href).slice(0,60);return n.length?n.map(e=>e.innerText.trim().replace(/\\s+/g,' ')+' <'+e.href+'>').join('\\n'):'[links: 0 matches]'})()`], taints: false };
    default: return null;
  }
}
// Raw eval: any raw `eval` taints the attempt's evidence until the next driver `nav` (a fresh document),
// because a page mutation cannot be ruled out syntactically (obfuscation). Reads after a taint are not evidence.
export function rawEvalTaints(verb) { return verb === 'eval'; }
// Mutation/obfuscation patterns: used only to label the taint reason in reports (the taint itself is unconditional).
export const MUTATION_RE = /[^=!<>]=[^=]|innerHTML|outerHTML|textContent|innerText\s*=|insertAdjacent|document\.write|append|prepend|createElement|replaceWith|location\.(assign|replace|href\s*=)|\.click\(|submit|dispatchEvent|fetch\(|XMLHttpRequest|atob|fromCharCode|Function\(|eval\(|setAttribute|value\s*=/;

export const FORBIDDEN_VERBS = new Set(['download', 'upload', 'profile', 'grant', 'setclipboard', 'getclipboard', 'compare', 'audit']);
export const FORBIDDEN_FLAGS = ['--user-agent', '--profile', '--headed', '--viewport', '--baseline'];
export const URL_VERBS = new Set(['nav', 'newtab']);
