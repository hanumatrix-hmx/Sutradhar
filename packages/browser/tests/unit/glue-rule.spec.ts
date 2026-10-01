/**
 * @file packages/browser/tests/unit/glue-rule.spec.ts
 * @description FR2-11 fix-3 (audit-3 A3-F1): GLUED tokens. audit-3 showed that in a token with no whitespace the userinfo strip handled only
 * the first URL's authority and a leading `scheme://` exempted the WHOLE token from the path rule, so
 * `['https://h.test/a','https://u:PASS@h2.test/p']`, a JSON.stringify'd config with a db URL, or a URL glued to a local path stored PASS or
 * the full path. The rule now (a) splits the path rule's tokens on quotes, backtick, comma, parentheses, brackets, braces, angle brackets,
 * pipe, caret and any Unicode format character (Cf), (b) strips `userinfo@` for EVERY `@` of a token (back to the previous slash), and
 * (c) limits the `scheme://` exemption to its own URL. Two kinds of test:
 *  - PROPERTY tests: a SEEDED generator (tools/scenario-suite/lib/fr2-11-glue.mjs) glues 2-3 URLs / local paths with every delimiter, in
 *    JSON / JS array / object / call text, with a secret in every slot; no secret may appear in ANY stored field;
 *  - ISOLATED cells: each is protected by exactly ONE new rule, so dropping that rule fails a cell that exists only for it.
 */
import {
  redactHistoryText,
  redactHistorySelector,
  sanitizeHistoryEntry,
  evalCodePreview,
  type ActionHistoryEntry,
} from '../../src/index.js';
import { generate, matrix, cfChars, GLUE_SEED, KEEP_CASES, DELIMS } from '../../../../tools/scenario-suite/lib/fr2-11-glue.mjs';

type Case = { id: string; text: string; secrets: string[]; shape: string };
const N_RANDOM = 6000;
const random = generate(GLUE_SEED, N_RANDOM) as Case[];
const grid = matrix(GLUE_SEED + 1) as Case[];

const entryWith = (t: string): ActionHistoryEntry =>
  ({
    actionType: 'click',
    selector: t,
    target: t,
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
const evalEntry = (t: string): ActionHistoryEntry => ({ actionType: 'eval', target: t, success: false, error: t, executionTimeMs: 1, timestamp: 't' }) as unknown as ActionHistoryEntry;

/**
 * Every stored FREE-TEXT form of `t` in one JSON string (free text, selector variant, MCP / SDK entry fields, eval preview). The structured
 * `url` / navigate `target` fields hold one real URL (FR2-09 D5: origin + pathname), never glued text, so a glued string is not run through them.
 */
const allStored = (t: string): string =>
  JSON.stringify([
    redactHistoryText(t),
    redactHistorySelector(t),
    sanitizeHistoryEntry(entryWith(t)),
    sanitizeHistoryEntry(evalEntry(t)),
    evalCodePreview(`fetch(${JSON.stringify(t)})`),
    evalCodePreview(t),
  ]);

const leaksOf = (cases: Case[]): { id: string; shape: string; text: string; secret: string }[] => {
  const out: { id: string; shape: string; text: string; secret: string }[] = [];
  for (const c of cases) {
    const stored = allStored(c.text);
    for (const s of c.secrets) if (stored.includes(s)) out.push({ id: c.id, shape: c.shape, text: c.text, secret: s });
  }
  return out;
};

describe(`FR2-11 fix-3 glue property test (seed ${GLUE_SEED}, ${N_RANDOM} random + ${grid.length} grid strings)`, () => {
  it('the generator is deterministic for a seed, varies with it, and every secret is present in its own text (not vacuous)', () => {
    expect(generate(GLUE_SEED, 40)).toEqual(generate(GLUE_SEED, 40));
    expect(generate(GLUE_SEED + 1, 40)).not.toEqual(generate(GLUE_SEED, 40));
    for (const c of [...random, ...grid]) {
      expect(c.secrets.length).toBeGreaterThan(0);
      for (const s of c.secrets) expect(c.text.includes(s) || c.text.includes(encodeURIComponent(s))).toBe(true);
    }
  });
  it('covers 2 and 3 items, every delimiter and every Unicode format character', () => {
    expect(new Set(random.map((c) => c.shape.split('/')[1]))).toEqual(new Set(['n2', 'n3']));
    const all = random.map((c) => c.text).join('') + grid.map((c) => c.text).join('');
    for (const d of DELIMS) expect(all.includes(d)).toBe(true);
    expect(cfChars().length).toBeGreaterThan(30);
  });
  it('random glue: no secret in ANY stored field', () => {
    const leaks = leaksOf(random);
    expect(leaks.slice(0, 6)).toEqual([]);
    expect(leaks.length).toBe(0);
  });
  it('exhaustive grid (every delimiter x every URL slot x URL / path neighbour x both orders, every path form): no secret in ANY stored field', () => {
    const leaks = leaksOf(grid);
    expect(leaks.slice(0, 6)).toEqual([]);
    expect(leaks.length).toBe(0);
  });
  it('EVERY Unicode format character (category Cf) between a URL and a local path, and inside a password, leaks nothing', () => {
    const bad: string[] = [];
    let i = 0;
    for (const cf of cfChars()) {
      i++;
      const a = `CGLF${i}a`;
      const b = `CGLF${i}b`;
      const cases = [
        `https://h.test/a${cf}C:\\Users\\${a}\\doc.txt`,
        `https://h.test/a${cf}/home/${a}/doc.txt`,
        `https://h.test/a${cf}https://u:${a}@h2.test/p`,
        `https://u:${a}${cf}${b}@h2.test/p`,
        `https://h.test/a${cf}\\\\srv\\share\\${a}\\f.txt`,
      ];
      for (const t of cases) if (allStored(t).includes(a) || allStored(t).includes(b)) bad.push(`U+${cf.codePointAt(0)!.toString(16)} ${JSON.stringify(t)}`);
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });
  it('the rule is idempotent on glued text and keeps what is readable (not an eraser)', () => {
    for (const c of random.slice(0, 1500)) {
      const once = redactHistoryText(c.text);
      expect(redactHistoryText(once)).toBe(once);
    }
    for (const k of KEEP_CASES as { text: string; keep: string[] }[]) {
      const out = redactHistoryText(k.text);
      for (const piece of k.keep) expect(out).toContain(piece);
    }
  });
});

describe('FR2-11 fix-3 ISOLATED cells (each protected by ONE new rule)', () => {
  const bs = '\\';
  /** The clean origin + path survives and the secret does not. */
  const cell = (text: string, secret: string, keep: string[]): void => {
    const out = redactHistoryText(text);
    expect(out).not.toContain(secret);
    for (const k of keep) expect(out).toContain(k);
    expect(allStored(text)).not.toContain(secret);
  };

  describe('split on quotes only', () => {
    it("single quote: a URL glued to a path by '", () => cell("https://h.test/a'/home/CGLUQ1x/doc.txt'", 'CGLUQ1x', ['https://h.test/a', 'doc.txt']));
    it('double quote, Windows path', () => cell('https://h.test/a"C:/Users/CGLUQ2x/doc.txt"', 'CGLUQ2x', ['https://h.test/a', 'doc.txt']));
    it('double quote, URL then path (no other delimiter)', () => cell('https://h.test/a"/home/CGLUQ3x/doc.txt"', 'CGLUQ3x', ['https://h.test/a', 'doc.txt']));
    it('backtick', () => cell('https://h.test/a`/home/CGLUQ4x/doc.txt`', 'CGLUQ4x', ['https://h.test/a', 'doc.txt']));
  });
  describe('split on commas only', () => {
    it('comma', () => cell('https://h.test/a,/home/CGLUC1x/doc.txt', 'CGLUC1x', ['https://h.test/a', 'doc.txt']));
    it('comma, Windows path', () => cell('https://h.test/a,C:/Users/CGLUC2x/doc.txt', 'CGLUC2x', ['https://h.test/a', 'doc.txt']));
  });
  describe('split on parentheses only', () => {
    it('open parenthesis', () => cell('https://h.test/a(/home/CGLUP1x/doc.txt', 'CGLUP1x', ['https://h.test/a', 'doc.txt']));
    it('close parenthesis', () => cell('https://h.test/a)/home/CGLUP2x/doc.txt', 'CGLUP2x', ['https://h.test/a', 'doc.txt']));
  });
  describe('split on brackets only', () => {
    it('open bracket', () => cell('https://h.test/a[/home/CGLUB1x/doc.txt', 'CGLUB1x', ['https://h.test/a', 'doc.txt']));
    it('close bracket', () => cell('https://h.test/a]/home/CGLUB2x/doc.txt', 'CGLUB2x', ['https://h.test/a', 'doc.txt']));
  });
  describe('split on braces only', () => {
    it('open brace', () => cell('https://h.test/a{/home/CGLUR1x/doc.txt', 'CGLUR1x', ['https://h.test/a', 'doc.txt']));
    it('close brace', () => cell('https://h.test/a}/home/CGLUR2x/doc.txt', 'CGLUR2x', ['https://h.test/a', 'doc.txt']));
  });
  describe('split on angle brackets only', () => {
    it('less-than', () => cell('https://h.test/a</home/CGLUA1x/doc.txt', 'CGLUA1x', ['https://h.test/a', 'doc.txt']));
    it('greater-than', () => cell('https://h.test/a>/home/CGLUA2x/doc.txt', 'CGLUA2x', ['https://h.test/a', 'doc.txt']));
  });
  describe('split on pipe and caret only', () => {
    it('pipe', () => cell('https://h.test/a|/home/CGLUV1x/doc.txt', 'CGLUV1x', ['https://h.test/a', 'doc.txt']));
    it('caret', () => cell('https://h.test/a^/home/CGLUV2x/doc.txt', 'CGLUV2x', ['https://h.test/a', 'doc.txt']));
  });
  describe('split on Unicode format characters (Cf) only', () => {
    it('soft hyphen U+00AD (not whitespace, not in any space class)', () => cell('https://h.test/a\u00ad/home/CGLUF1x/doc.txt', 'CGLUF1x', ['https://h.test/a', 'doc.txt']));
    it('Arabic letter mark U+061C', () => cell('https://h.test/a\u061c/home/CGLUF2x/doc.txt', 'CGLUF2x', ['https://h.test/a', 'doc.txt']));
    it('isolate U+2066', () => cell('https://h.test/a\u2066/home/CGLUF3x/doc.txt', 'CGLUF3x', ['https://h.test/a', 'doc.txt']));
    it('tag character U+E0041 (astral)', () => cell('https://h.test/a\u{e0041}/home/CGLUF4x/doc.txt', 'CGLUF4x', ['https://h.test/a', 'doc.txt']));
    it('zero-width space U+200B and BOM U+FEFF', () => {
      cell('https://h.test/a\u200b/home/CGLUF5x/doc.txt', 'CGLUF5x', ['https://h.test/a', 'doc.txt']);
      cell('https://h.test/a\ufeff/home/CGLUF6x/doc.txt', 'CGLUF6x', ['https://h.test/a', 'doc.txt']);
    });
    // A3-F4: the bidi controls U+202A..U+202E are not JS whitespace. audit-3 mutant N13 (drop U+2028..U+202F from the split set)
    // re-joined a URL and a path through them and leaked the path; under the new rule the Cf class splits them even then.
    it('A3-F4: each of U+202A..U+202E between a URL and a path', () => {
      for (const [i, cp] of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e].entries()) {
        const ch = String.fromCodePoint(cp);
        cell(`https://h.test/p${ch}/home/CGLUN${i}x/f.txt`, `CGLUN${i}x`, ['https://h.test/p', 'f.txt']);
        cell(`https://h.test/p${ch}C:${bs}Users${bs}CGLUM${i}x${bs}f.txt`, `CGLUM${i}x`, ['https://h.test/p', 'f.txt']);
      }
    });
  });
  describe('userinfo stripped for EVERY @ (not only the first authority)', () => {
    it('second URL in a glued token, no delimiter between', () => cell('https://h.test/a+https://u:CGLUU1x@h2.test/p', 'CGLUU1x', ['https://h.test/a', 'h2.test/p']));
    it('third URL', () => cell('https://h.test/a+https://x@h2.test/b+https://u:CGLUU2x@h3.test/c', 'CGLUU2x', ['https://h.test/a', 'h3.test/c']));
    it('audit-3 shape: a JS array', () => cell("['https://h.test/a','https://u:CGLUU3x@h2.test/p'].length", 'CGLUU3x', ['https://h.test/a', 'h2.test/p']));
    it('audit-3 shape: a JSON.stringify of a config with a database URL', () =>
      cell("throw new Error(JSON.stringify({api:'https://h.test/x',db:'postgres://admin:CGLUU4x@db:5432/app'}))", 'CGLUU4x', ['https://h.test/x', 'db:5432/app']));
    it('bare PASS@ (no user) in the second URL', () => cell('https://h.test/a+https://CGLUU5x@h2.test/p', 'CGLUU5x', ['h2.test/p']));
    it('a password that itself holds delimiter characters: the strip runs back to the slash, through them', () => {
      cell('postgres://admin:CGLUW1x(CGLUW2x)@db:5432/app', 'CGLUW1x', ['db:5432/app']);
      cell("postgres://admin:CGLUW3x'CGLUW4x@db:5432/app", 'CGLUW4x', ['db:5432/app']);
      cell('https://u:CGLUW5x,CGLUW6x@h2.test/p', 'CGLUW6x', ['h2.test/p']);
      cell('https://u:CGLUW7x\u00adCGLUW8x@h2.test/p', 'CGLUW7x', ['h2.test/p']);
      cell('https://u:CGLUW9x\u200bCGLUWAx@h2.test/p', 'CGLUW9x', ['h2.test/p']);
    });
    it('percent-encoded @ (decoded text)', () => cell('https://h.test/a+https://u:CGLUU6x%40h3@h2.test/p', 'CGLUU6x', ['h2.test/p']));
    it('an @ in a URL path keeps the rest of the path', () => expect(redactHistoryText('https://medium.test/@user/post')).toContain('/post'));
  });
  describe('the scheme:// exemption ends with its own URL', () => {
    it('a backslash local path glued to a URL with no delimiter at all', () => cell(`https://h.test/aC:${bs}Users${bs}CGLUE1x${bs}doc.txt`, 'CGLUE1x', ['https://h.test/a', 'doc.txt']));
    it('a UNC path glued to a URL', () => cell(`https://h.test/a${bs}${bs}srv${bs}share${bs}CGLUE2x${bs}f.txt`, 'CGLUE2x', ['https://h.test/a', 'f.txt']));
    it('a JSON-escaped URL keeps its escaped slashes', () => expect(redactHistoryText(`{"u":"https:${bs}/${bs}/h.test${bs}/p"}`)).toContain('h.test'));
  });
  describe('IPv6 literal host: the ONE bracket group that does not split (orchestrator-approved refinement)', () => {
    it('(a) http://[::1]:5000/p?token=S keeps the origin and path and drops the token', () => {
      const out = redactHistoryText('http://[::1]:5000/p?token=CGLUI0x');
      expect(out).toBe('http://[::1]:5000/p[redacted]');
      for (const [l, r] of [['(', ')'], ['[', ']'], ["'", "'"], ['{', '}'], ['"', '"']]) expect(redactHistoryText(`${l}http://[2001:db8::1]:8080/p?token=CGLUI0y${r}`)).toContain('http://[2001:db8::1]:8080/p');
      expect(redactHistoryText('see http://u:CGLUI0z@[::1]:9/a/b done')).toBe('see http://[::1]:9/a/b done');
    });
    it('(b1) a bracket group that is not hex (`[xyz]`) splits, so the glued path is reduced', () => cell('https://[xyz]/home/CGLUI1x/doc.txt', 'CGLUI1x', ['doc.txt']));
    it('(b2) a bracket that does not directly follow // or @ splits even when its content is hex', () => cell('https://h.test/a[::1]/home/CGLUI2x/doc.txt', 'CGLUI2x', ['https://h.test/a', 'doc.txt']));
    it('(b3) the group must close: `//[::1/home/N/f.txt` splits', () => cell('https://[::1/home/CGLUI3x/doc.txt', 'CGLUI3x', ['doc.txt']));
    it('(b4) x//[not hex!] splits and redacts', () => cell('x//[not hex!]/home/CGLUI4x/doc.txt', 'CGLUI4x', ['doc.txt']));
    it('(b5) a bracket group after the host (`https://h/a[/home/N/f.txt]`) splits', () => cell('https://h.test/a[/home/CGLUI5x/f.txt]', 'CGLUI5x', ['https://h.test/a', 'f.txt']));
  });
  describe('idempotency of the <dir> placeholder (its angle brackets are not delimiters)', () => {
    it('a second pass over `file://…/<dir>` and `<dir>` changes nothing', () => {
      const once = redactHistoryText("'file:/home/CGLUD1x/a b.docx' x");
      expect(once).toContain('file://…/<dir>');
      expect(redactHistoryText(once)).toBe(once);
      expect(redactHistoryText('C:/Users/CGLUD2x/docs/x')).toBe('<dir>');
      expect(redactHistoryText('<dir>')).toBe('<dir>');
      expect(redactHistoryText('a <dir> b')).toBe('a <dir> b');
    });
    it('a real angle bracket still splits (`<` and `>` outside the placeholder)', () => cell('https://h.test/a</home/CGLUD3x/doc.txt>', 'CGLUD3x', ['doc.txt']));
  });
  describe('a password that holds delimiters: the strip runs back to the slash, through them (defect 2)', () => {
    for (const [name, ch] of [['parentheses', '(CGLUW1y)'], ['comma', ','], ['single quote', "'"], ['pipe', '|'], ['double quote', '"'], ['brackets', '[x]'], ['braces', '{x}'], ['angle', '<x>'], ['backtick', '`'], ['caret', '^']] as const) {
      it(name, () => {
        const out = redactHistoryText(`postgres://admin:CGLUW1x${ch}CGLUW1z@db:5432/app`);
        expect(out).not.toMatch(/CGLUW1/);
        expect(out).toContain('db:5432/app');
      });
    }
    it('the classic p(a)ss', () => expect(redactHistoryText('postgres://admin:p(a)ss@db/app')).toBe('postgres://db/app'));
  });
  describe('a JSON-escaped quote in the userinfo (defect 3): only a slash stops the strip, not a backslash', () => {
    it('JSON.stringify of a config whose password holds a quote', () => {
      const text = JSON.stringify({ db: 'postgres://admin:CGLUJ1x"CGLUJ1y@db:5432/app' });
      expect(text).toContain(bs + '"');
      cell(text, 'CGLUJ1x', ['db:5432/app']);
      expect(redactHistoryText(text)).not.toContain('CGLUJ1y');
    });
    it('u:S\\"S2@h (the audit shape)', () => cell('https://u:CGLUJ2x' + bs + '"CGLUJ2y@h2.test/p', 'CGLUJ2x', ['h2.test/p']));
  });
  describe('a data: / javascript: body glued behind a prefix: the prefix goes through the whole rule (fuzz-found)', () => {
    it('a query before it is cut', () => cell('https://h.test/p?token=CGLUO1x,data:text/plain,x', 'CGLUO1x', ['https://h.test/p']));
    it('a local path before it is reduced', () => cell("['/home/CGLUO2x/f.txt',data:text/plain,x]", 'CGLUO2x', ['f.txt']));
    it('an encoded fragment before it is cut', () => cell("https://h.test/p%23CGLUO3x>'data:text/plain,x", 'CGLUO3x', ['https://h.test/p']));
    it('javascript: behind a Windows path', () => cell('C:/Users/CGLUO4x/doc.txt|javascript:alert(1)', 'CGLUO4x', ['doc.txt', 'javascript:']));
    it('the body itself is still dropped and a lone data: URL keeps its marker', () => {
      expect(redactHistoryText('see data:text/plain;base64,QUJD now')).toBe('see data:…');
      expect(redactHistoryText('x,data:text/plain,CGLUO5x')).not.toContain('CGLUO5x');
    });
  });
  describe('fuzz-found: placeholders stay stable and JSON-escaped whitespace ends a word', () => {
    it('a file: URL with no basename is idempotent (NFKC turns the ellipsis into three dots)', () => {
      for (const t of ['file:///', 'file://[fe80::1%25eth0]/p', "['file:///']"]) {
        const once = redactHistoryText(t);
        expect(redactHistoryText(once)).toBe(once);
      }
    });
    it('a JSON-escaped tab before data: / file: does not glue the marker to a word', () => {
      const t = JSON.stringify('C:/x/a.txt,\t' + 'data:text/plain,CGLUT1x');
      expect(t).toContain(bs + 't');
      expect(redactHistoryText(t)).not.toContain('CGLUT1x');
      const f = JSON.stringify('x\tfile:///C:/Users/CGLUT2x/doc.txt');
      expect(redactHistoryText(f)).not.toContain('CGLUT2x');
    });
  });
  describe('a path glued in FRONT of file: / blob: (fuzz-found): reduced, and the marker stays findable (idempotent)', () => {
    it('file:', () => {
      const t = '/home/CGLUP1x/f.txt' + bs + 'file:///C:/Users/CGLUP2x/doc.txt';
      cell(t, 'CGLUP1x', ['f.txt', 'file://…/doc.txt']);
      expect(redactHistoryText(t)).not.toContain('CGLUP2x');
      const once = redactHistoryText(t);
      expect(redactHistoryText(once)).toBe(once);
    });
    it('blob:', () => {
      const t = '/home/CGLUP3x/f.txt' + bs + 'blob:https://a.test/CGLUP4x';
      cell(t, 'CGLUP3x', ['f.txt', 'blob:https://a.test']);
      const once = redactHistoryText(t);
      expect(redactHistoryText(once)).toBe(once);
    });
  });
  describe('what the splitting must NOT break (documented exceptions)', () => {
    it('the selector variant keeps #id and [a=b]', () => {
      expect(redactHistorySelector('#bump')).toBe('#bump');
      expect(redactHistorySelector('button[data-k=go]')).toBe('button[data-k=go]');
      expect(redactHistorySelector('a[href="/x"],b[type=text]')).toBe('a[href="/x"],b[type=text]');
      expect(redactHistorySelector('div > #main, [role=button]')).toBe('div > #main, [role=button]');
    });
    it('the selector variant strips every userinfo and path in a glued selector', () => {
      const out = redactHistorySelector('a[href="https://h.test/a"],b[x="https://u:CGLUS1x@h2.test/p"]');
      expect(out).not.toContain('CGLUS1x');
    });
    it('the wait_for selector keeps its engine key text="', () => {
      const e = sanitizeHistoryEntry({ actionType: 'wait_for', selector: 'text="Ready" AND urlContains="/done"', success: true, executionTimeMs: 1, timestamp: 't' } as unknown as ActionHistoryEntry);
      expect(String(e.selector)).toContain('text="');
    });
    it('a URL with a path and a plain sentence are untouched', () => {
      expect(redactHistoryText('Current URL http://127.0.0.1:5123/p/q does not contain "x"')).toBe('Current URL http://127.0.0.1:5123/p/q does not contain "x"');
    });
    it('A3-F3 (known limit, documented): in a path with spaces the middle words survive', () => {
      // the rule splits on whitespace first, so only the first and last words of a spaced path are reduced
      expect(redactHistoryText("open 'E:/x/Acme Secret Project/s.png'")).toBe("open '<dir> Secret s.png'");
    });
  });
});
