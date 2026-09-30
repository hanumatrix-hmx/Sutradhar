/**
 * @file packages/browser/tests/unit/char-rule.spec.ts
 * @description FR2-11 fix-2: the CHARACTER RULE. audit-2 found that shape-recognising redaction (fix-0: a character-class
 * regex, fix-1: a list of URL markers) is fail-OPEN: every unlisted shape kept its tail. The rule is now shape-independent:
 *   tokens split on ANY Unicode whitespace; per token: cut from the first `?` `#` `;` (the rest of the text after the cut goes
 *   too), a token that still contains `=` or `&` is replaced whole, `userinfo@` is stripped, a path token is reduced to its last
 *   segment; percent-, double-percent-, JSON- and fullwidth encodings of those characters are decoded first.
 * Two kinds of test live here:
 *  - PROPERTY tests: thousands of SEEDED random strings (`prefix + delimiter + SECRET`) must never store SECRET in any field;
 *  - ISOLATED cells: each one is protected by exactly ONE rule, so deleting that rule fails a cell that exists only for it
 *    (the B2 / B3 / B4 audit-2 mutants survived the 1,600-cell fix-1 matrix because every cell carried a second marker).
 */
import {
  redactHistoryText,
  redactHistoryUrl,
  sanitizeHistoryEntry,
  evalCodePreview,
  REDACTED_PLACEHOLDER,
  type ActionHistoryEntry,
} from '../../src/index.js';
import { generate, DEFAULT_SEED, KEEP_CASES, makeRng } from '../../../../tools/scenario-suite/lib/fr2-11-property.mjs';

const N_CASES = 6000;
const cases = generate(DEFAULT_SEED, N_CASES) as { id: string; kind: string; secret: string; text: string }[];
const P = REDACTED_PLACEHOLDER;

/**
 * The two documented selector leniencies (a CSS `#id` and a `[attr=value]` are the selector, not a secret): the selector FIELD of
 * a string that is only that is stored as written. Every other field, and every string with a URL-shaped part, is checked.
 */
const URL_SHAPED_BEFORE = /[/\\@%]|:[0-9/]|:$/;
const selectorExempt = (t: string, secret: string): boolean => {
  const before = t.slice(0, Math.max(0, t.indexOf(secret)));
  if (URL_SHAPED_BEFORE.test(before)) return false;
  return before.endsWith('#') || /\[[^\]\s]*=$/.test(before);
};

const entryWith = (t: string, secret: string): ActionHistoryEntry =>
  ({
    actionType: 'click',
    selector: selectorExempt(t, secret) ? 'x' : t,
    target: t,
    url: t,
    error: t,
    success: false,
    executionTimeMs: 1,
    timestamp: 't',
    verification: {
      verified: false,
      urlChanged: false,
      elementFound: false,
      confidence: 0,
      reason: `Action failed: ${t}`,
      evidence: { tier: 'contradicted', checks: [{ check: 'c', outcome: 'fail', expected: t, observed: t, detail: t }] },
    },
  }) as unknown as ActionHistoryEntry;

const navEntry = (t: string): ActionHistoryEntry => ({ actionType: 'navigate', target: t, success: true, executionTimeMs: 1, timestamp: 't' }) as unknown as ActionHistoryEntry;
const evalEntry = (t: string): ActionHistoryEntry => ({ actionType: 'eval', target: t, success: false, error: t, executionTimeMs: 1, timestamp: 't' }) as unknown as ActionHistoryEntry;

/** Every surface of the stored form of `text` in one JSON string. */
const allStored = (t: string, secret: string): string =>
  JSON.stringify([
    redactHistoryText(t),
    redactHistoryUrl(t),
    sanitizeHistoryEntry(entryWith(t, secret)),
    sanitizeHistoryEntry(navEntry(t)),
    sanitizeHistoryEntry(evalEntry(t)),
    evalCodePreview(`fetch(${JSON.stringify(t)})`),
    evalCodePreview(t),
  ]);

describe(`FR2-11 fix-2 property test (seed ${DEFAULT_SEED}, ${N_CASES} generated strings)`, () => {
  it('the generator is deterministic for a seed and varies with the seed', () => {
    expect(generate(DEFAULT_SEED, 50)).toEqual(generate(DEFAULT_SEED, 50));
    expect(generate(DEFAULT_SEED + 1, 50)).not.toEqual(generate(DEFAULT_SEED, 50));
    expect(makeRng(1).next()).toBe(makeRng(1).next());
  });
  it('covers every kind and every secret is present in its own text (the check is not vacuous)', () => {
    expect(new Set(cases.map((c) => c.kind))).toEqual(new Set(['delim', 'path', 'other']));
    expect(new Set(cases.map((c) => c.secret)).size).toBe(N_CASES);
    const missing = cases.filter((c) => !c.text.includes(c.secret));
    // a secret that is itself percent-encoded inside the text would be missing; the generator never does that
    expect(missing.map((c) => c.id)).toEqual([]);
  });
  it('SECRET is absent from every stored field of every generated string', () => {
    const leaks = cases.filter((c) => allStored(c.text, c.secret).includes(c.secret));
    expect(leaks.slice(0, 8).map((c) => ({ id: c.id, text: c.text, out: redactHistoryText(c.text) }))).toEqual([]);
    expect(leaks.length).toBe(0);
  });
  it('the property check catches an identity redactor on every case (negative control)', () => {
    const identity = cases.filter((c) => JSON.stringify([c.text]).includes(c.secret));
    expect(identity.length).toBe(N_CASES);
  });
  it('redaction is idempotent on every generated string', () => {
    const bad = cases.filter((c) => redactHistoryText(redactHistoryText(c.text)) !== redactHistoryText(c.text));
    expect(bad.slice(0, 5).map((c) => c.text)).toEqual([]);
  });
  it('the rule is not an eraser: ordinary URLs, words and file names survive', () => {
    for (const k of KEEP_CASES as { text: string; keep: string[] }[]) {
      const out = redactHistoryText(k.text);
      for (const s of k.keep) expect(out).toContain(s);
    }
  });
});

describe('FR2-11 fix-2 ISOLATED cells: one rule each (delete the rule and the named cell fails)', () => {
  const S = 'CNRYiso1X';
  const gone = (text: string, field: 'text' | 'entry' = 'text'): void => {
    expect(field === 'text' ? redactHistoryText(text) : allStored(text, S)).not.toContain(S);
  };
  it('rule (a) cut at `#`: a bare fragment with no URL (only rule a protects it)', () => {
    gone(`#${S}`);
    expect(redactHistoryText(`#${S}`)).toBe(P);
  });
  it('rule (a) cut at `?`: a bare `?=S` (no `=` left after the cut, no URL, no path)', () => {
    gone(`?=${S}`);
    expect(redactHistoryText(`?=${S}`)).toBe(P);
    gone(`?${S}`);
  });
  it('rule (a) cut at `;`: a path parameter', () => {
    gone(`x;${S}`);
    expect(redactHistoryText(`x;${S}`)).toBe(`x${P}`);
  });
  it('rule (a) custom scheme redirect (audit-2 A2-F1) and about:blank#S', () => {
    gone(`com.example.app:/cb#access_token=${S}`, 'entry');
    gone(`about:blank#${S}`, 'entry');
    gone(`intranet:8080/p#${S}`, 'entry');
    expect(redactHistoryText(`committed at about:blank#${S}`)).toBe(`committed at about:blank${P}`);
  });
  it('rule (a) swallows what follows the cut: a space inside the query or the URL', () => {
    gone(`https://x.test/cb?q=ab ${S}`);
    gone(`https://x.test/cb?q=ab ${S}.example.com/`);
    gone(`https://x.test/my dir#${S}`);
    gone(`https://x.test/p?a=1\n${S}`);
    gone(`https://x.test/p?a=1\u00a0${S}`);
  });
  it('rule (b): a form token `a=S` (no cut character, no URL, no path)', () => {
    gone(`a=${S}`);
    expect(redactHistoryText(`a=${S}`)).toBe(P);
    gone(`a=1&b=${S}`);
    gone(`a=1&token=my ${S}`); // a `&` body swallows what follows it
  });
  it('rule (c): userinfo is stripped (no cut character, no `=`, and a trailing `/` so the path rule has nothing to reduce)', () => {
    gone(`user:${S}@host/`);
    expect(redactHistoryText(`user:${S}@host/`)).toBe('host/');
    gone(`https://user:${S}@host.test/p`);
    expect(redactHistoryText(`https://user:${S}@host.test/p`)).toBe('https://host.test/p');
    gone(`${S}@host/`);
  });
  it('decoding: `%23S`, `%3FS`, `%3BS` and the double-encoded forms', () => {
    gone(`http://h.test/p%23${S}`);
    gone(`http://h.test/p%3F${S}`);
    gone(`http://h.test/p%3B${S}`);
    gone(`http://h.test/p%253F${S}`);
    gone(`http://h.test/p%2523${S}`);
    gone(`http://h.test/p\\u0023${S}`);
    gone(`http://h.test/p\uff03${S}`);
    gone(`%23${S}`, 'entry');
  });
  it('the path rule: a path segment is the ONLY thing that protects a canary in a directory', () => {
    for (const t of [`/home/${S}/f.txt`, `C:\\Users\\${S}\\f.txt`, `c:/Users/${S}/f.txt`, `\\\\srv\\share\\${S}\\f.txt`, `//srv/share/${S}/f.txt`, `~/${S}/f.txt`, `..\\${S}\\f.txt`]) {
      gone(t);
      expect(redactHistoryText(t)).toBe('f.txt');
    }
    // the last segment of a path with no extension is a directory name (a home directory, a user name) and goes too
    expect(redactHistoryText(`C:\\Users\\${S}`)).toBe('<dir>');
    gone(`C:\\Users\\${S}`);
    gone(`/home/${S}`);
  });
  it('input cap: a token cut off by the 8,000-character input cap is not kept (its separator or delimiter may be past the cut)', () => {
    const k = 'CNRYcap1X';
    const out = redactHistoryText('x'.repeat(7990) + ` C:${k}\\f.txt`);
    expect(out).not.toContain(k);
    expect(out.endsWith(P)).toBe(true);
    expect(redactHistoryText('x'.repeat(9000))).toBe(P); // a single huge token is cut, so it is dropped (deviation D-fix2-4)
    expect(redactHistoryText('word '.repeat(2000) + 'tail')).toContain('word word'); // a long text of ordinary words is otherwise kept
  });
  it('whitespace: every Unicode whitespace splits tokens, so a neighbour of a redacted token survives (keep cells)', () => {
    for (const ws of [' ', '\t', '\u00a0', '\u200b', '\u3000', '\n', '\u2003']) {
      const out = redactHistoryText(`keepword${ws}a=${S}`);
      expect(out).toContain('keepword');
      expect(out).not.toContain(S);
    }
    // and a separator is what limits `a=S`: the whole-token replacement must not eat the preceding word
    expect(redactHistoryText(`ok a=${S}`)).toBe(`ok ${P}`);
  });
  it('plain text, plain URLs and plain words are NOT erased (over-redaction is bounded)', () => {
    expect(redactHistoryText('No element found for selector')).toBe('No element found for selector');
    expect(redactHistoryText('Current URL http://127.0.0.1:5123/p/q does not contain x')).toBe('Current URL http://127.0.0.1:5123/p/q does not contain x');
    expect(redactHistoryText('saved to C:\\out\\dir\\shot.png now')).toBe('saved to shot.png now');
  });
});

describe('FR2-11 fix-2 selectors keep their shape; everything else in free text follows the rule', () => {
  const sel = (s: string): string => sanitizeHistoryEntry({ actionType: 'click', selector: s, success: true, executionTimeMs: 1, timestamp: 't' } as unknown as ActionHistoryEntry).selector as string;
  it('real CSS selectors are stored as written', () => {
    for (const s of ['#bump', 'input[type=file]', 'div > a.btn:hover', 'ul li:nth-child(2) #k', 'a[href="/x"]', '[data-id=7]', 'button#save']) expect(sel(s)).toBe(s);
  });
  it('a URL in a selector is cut like anywhere else', () => {
    const S = 'CNRYsel1X';
    for (const s of [`https://x.test/p?t=${S}`, `about:blank#${S}`, `com.example.app:/cb#access_token=${S}`, `https://x.test/p\t#${S}`, `intranet:8080/p#${S}`, `a=1&token=my ${S}`]) {
      expect(sel(s)).not.toContain(S);
    }
  });
  it('free text (error, reason) does NOT get the selector leniency: `#S` is redacted there', () => {
    const S = 'CNRYsel2X';
    expect(JSON.stringify(sanitizeHistoryEntry({ actionType: 'click', error: `#${S}`, success: false, executionTimeMs: 1, timestamp: 't' } as unknown as ActionHistoryEntry))).not.toContain(S);
  });
});

describe('FR2-11 fix-2 upload_file target: the basename, unless it has no extension (a user / home directory name)', () => {
  const up = (t: string): string => sanitizeHistoryEntry({ actionType: 'upload_file', target: t, success: false, executionTimeMs: 1, timestamp: 't' } as unknown as ActionHistoryEntry).target as string;
  it('report.pdf is kept; a name with no extension is <dir>; a query on a name is cut', () => {
    expect(up('report.pdf')).toBe('report.pdf');
    expect(up('CNRYup1X')).toBe('<dir>');
    expect(up('f.txt?t=CNRYup2X')).not.toContain('CNRYup2X');
  });
});

describe('FR2-11 fix-2 structured target: FR2-09 D5 (origin + pathname) then the rule', () => {
  it('http(s) targets keep origin + pathname and nothing else; an encoded delimiter in the path is cut too', () => {
    expect(redactHistoryUrl('http://127.0.0.1:5/p/q?x=(a)&t=1#f')).toBe('http://127.0.0.1:5/p/q');
    expect(redactHistoryUrl('https://a.test/p;jsessionid=Z/q')).toBe('https://a.test/p');
    expect(redactHistoryUrl('http://a.test/p%3Ftoken%3DCNRYd1X')).not.toContain('CNRYd1X');
    expect(redactHistoryUrl('about:blank#CNRYd2X')).toBe('about:blank');
    expect(redactHistoryUrl('com.example.app:/cb#access_token=CNRYd3X')).not.toContain('CNRYd3X');
  });
  it('the rule and D5 agree: for every generated case the bare URL function and the text function both drop the secret', () => {
    const bad = cases.filter((c) => redactHistoryUrl(c.text).includes(c.secret) || redactHistoryText(c.text).includes(c.secret));
    expect(bad.length).toBe(0);
  });
});

describe('FR2-11 fix-2 eval preview (decision: keep a redacted preview, per spec H5 / R2; log deviation D-fix2-3)', () => {
  it('ordinary short code is kept; code with `;` `=` `?` `/` degrades predictably and never stores a URL tail', () => {
    expect(evalCodePreview('1+1')).toBe('1+1');
    expect(evalCodePreview('document.title')).toBe('document.title');
    expect(evalCodePreview('2+0 /*t1*/')).toBe('2+0 <dir>');
    // a statement separator cuts the rest (fail-closed: what follows `;` could be a token)
    expect(evalCodePreview('const x = 1; fetch("https://t.test/?k=CNRYe1X")')).toBe(`const x ${P} 1${P}`);
    expect(evalCodePreview('  a\n b ')).toBe('a b');
  });
  it('whitespace is collapsed and the preview is capped at 200 characters', () => {
    const long = evalCodePreview('x '.repeat(5000));
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });
  it('an eval target and an eval error never hold a secret that follows a delimiter', () => {
    const S = 'CNRYe2X';
    const e = sanitizeHistoryEntry(evalEntry(`fetch("https://t.test/?k=${S}#${S}");localStorage.k=${S}`));
    expect(JSON.stringify(e)).not.toContain(S);
  });
});
