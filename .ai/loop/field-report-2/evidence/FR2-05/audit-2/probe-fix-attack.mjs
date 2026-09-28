// FR2-05 audit-2: attack rejectWindowsTrimmedComponents / isPathWithinRoot / canonicalizePath directly,
// using a Win32-normalizing oracle (cmd.exe `mkdir`, which goes through CreateDirectoryW WITHOUT the
// \\?\ prefix, i.e. the same normalization Chrome's download-dir creation gets) to decide what Windows
// ACTUALLY does with each spelling, and the real built product module to decide what Sutradhar allows.
//
// ESCAPE = product ALLOWS the path  AND  Windows physically routes it through the junction to OUTSIDE.
//
// Usage: node probe-fix-attack.mjs   (writes probe-fix-attack.json next to this file)
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..', '..');
const pc = await import(
  pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'actions', 'path-containment.js')).href
);
const { findContainingRoot, isPathWithinRoot, canonicalizePath } = pc;

function cmd(args) {
  try {
    const out = execFileSync('cmd.exe', ['/d', '/s', '/c', `"${args}"`], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message).trim().slice(0, 200) };
  }
}

async function productDecision(candidate, roots) {
  try {
    const hit = await findContainingRoot(candidate, roots);
    return hit ? 'ALLOWED' : 'rejected(outside)';
  } catch (e) {
    return `rejected(throw: ${e.message.slice(0, 90)})`;
  }
}

const results = [];
const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr205-audit2-attack-'));
try {
  // ---- Suffix variants on a junction name: <root>\jn<SUFFIX>\sub ----
  const suffixes = {
    'dot (audit-1 original)': '.',
    'space': ' ',
    'dot-dot': '..',
    'dot-space-dot': '. .',
    'three-dots': '...',
    'ZWSP only': '\u200B',
    'dot+ZWSP': '.\u200B',
    'ZWSP+dot': '\u200B.',
    'dot+ZWNJ': '.\u200C',
    'dot+ZWJ': '.\u200D',
    'dot+BOM/ZWNBSP': '.\uFEFF',
    'dot+word-joiner': '.\u2060',
    'dot+combining-acute': '.\u0301',
    'dot+combining-dot-above': '.\u0307',
    'NBSP': '\u00A0',
    'dot+NBSP': '.\u00A0',
    'ideographic space': '\u3000',
    'en space': '\u2002',
    'mongolian vowel sep': '\u180E',
    'one-dot-leader': '\u2024',
    'fullwidth full stop': '\uFF0E',
    'ideographic full stop': '\u3002',
    'arabic decimal separator': '\u066B',
    'arabic full stop': '\u06D4',
    'syriac full stop': '\u0701',
    'halfwidth ideographic full stop': '\uFF61',
    'small full stop': '\uFE52',
    'dot+LRM': '.\u200E',
    'dot+RLO': '.\u202E',
    'ADS ::$INDEX_ALLOCATION': '::$INDEX_ALLOCATION',
    'ADS :$I30:$INDEX_ALLOCATION': ':$I30:$INDEX_ALLOCATION',
    'dot + ADS': '.::$INDEX_ALLOCATION',
    'dot+colon': '.:',
    'trailing dot then slash-dot': '.\\.',
  };

  let i = 0;
  for (const [label, suffix] of Object.entries(suffixes)) {
    i++;
    const T = path.join(R, `s${i}`);
    const root = path.join(T, 'root');
    const outside = path.join(T, 'outside');
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    const jn = path.join(root, 'jn');
    const mk = cmd(`mklink /J "${jn}" "${outside}"`);
    if (!mk.ok) {
      results.push({ group: 'suffix', label, error: 'mklink failed ' + mk.out });
      continue;
    }
    const candidate = root + '\\jn' + suffix + '\\sub';
    const decision = await productDecision(candidate, [root]);
    const oracle = cmd(`mkdir "${candidate}"`);
    const landedOutside = existsSync(path.join(outside, 'sub'));
    const rootEntries = readdirSync(root);
    const escape = decision === 'ALLOWED' && landedOutside;
    results.push({
      group: 'suffix',
      label,
      suffixCodepoints: [...suffix].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')),
      product: decision,
      win32MkdirOk: oracle.ok,
      win32MkdirOut: oracle.out,
      win32RoutedThroughJunction: landedOutside,
      rootEntriesAfter: rootEntries.map((n) => JSON.stringify(n)),
      ESCAPE: escape,
      falseRejectOfHarmless: decision !== 'ALLOWED' && !landedOutside && oracle.ok,
    });
    console.log(`${escape ? '!!ESCAPE!!' : 'ok        '} ${label.padEnd(34)} product=${decision.slice(0, 40).padEnd(40)} win32Outside=${landedOutside} mkdirOk=${oracle.ok}`);
  }

  // ---- Whole-component forms and legitimate relative-path resolution (point 2a) ----
  {
    const T = path.join(R, 'comp');
    const root = path.join(T, 'root');
    const outside = path.join(T, 'outside');
    await fs.mkdir(path.join(root, 'a'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    cmd(`mklink /J "${path.join(root, 'jn')}" "${outside}"`);
    const cases = [
      ['legit: root\\a\\..\\b (.. before containment)', root + '\\a\\..\\b', 'ALLOWED'],
      ['legit: root\\.\\a\\.\\x (. segments)', root + '\\.\\a\\.\\x', 'ALLOWED'],
      ['legit: forward slashes root/a/x', root.replace(/\\/g, '/') + '/a/x', 'ALLOWED'],
      ['legit: doubled separators', root + '\\\\a\\\\\\x', 'ALLOWED'],
      ['legit: dotted name my.folder\\v1.2', root + '\\my.folder\\v1.2', 'ALLOWED'],
      ['legit: .hidden dir', root + '\\.hidden\\x', 'ALLOWED'],
      ['legit: name with inner space', root + '\\my folder\\x', 'ALLOWED'],
      ['legit: root itself', root, 'ALLOWED'],
      ['legit: root with trailing sep', root + '\\', 'ALLOWED'],
      ['legit: uppercase root spelling', root.toUpperCase() + '\\x', 'ALLOWED'],
      ['attack: root\\..\\outside', root + '\\..\\outside', 'REJECT'],
      ['attack: root\\a\\..\\..\\outside', root + '\\a\\..\\..\\outside', 'REJECT'],
      ['attack: root\\jn\\..\\..\\outside (lexical)', root + '\\jn\\..\\..\\outside', 'REJECT'],
      ['attack: root\\jn\\x (existing junction, new tail)', root + '\\jn\\x', 'REJECT'],
      ['attack: root\\...\\x (all-dots comp)', root + '\\...\\x', 'REJECT'],
      ['attack: root\\ \\x (all-space comp)', root + '\\ \\x', 'REJECT'],
      ['attack: root\\. .\\x', root + '\\. .\\x', 'REJECT'],
      ['attack: root-evil prefix', root + '-evil\\x', 'REJECT'],
    ];
    for (const [label, cand, expect] of cases) {
      const d = await productDecision(cand, [root]);
      const ok = expect === 'ALLOWED' ? d === 'ALLOWED' : d !== 'ALLOWED';
      results.push({ group: 'component', label, candidate: cand, product: d, expected: expect, pass: ok });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(50)} -> ${d}`);
    }
    // relative path with '..' resolved against cwd
    const prevCwd = process.cwd();
    await fs.mkdir(path.join(T, 'other'), { recursive: true });
    process.chdir(path.join(T, 'other'));
    for (const [label, cand, expect] of [
      ['legit relative ..\\root\\x from sibling cwd', '..\\root\\x', 'ALLOWED'],
      ['attack relative ..\\outside\\x', '..\\outside\\x', 'REJECT'],
      ['attack relative ..\\root\\jn.\\x', '..\\root\\jn.\\x', 'REJECT'],
    ]) {
      const d = await productDecision(cand, [root]);
      const ok = expect === 'ALLOWED' ? d === 'ALLOWED' : d !== 'ALLOWED';
      results.push({ group: 'relative', label, candidate: cand, product: d, expected: expect, pass: ok });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(50)} -> ${d}`);
    }
    process.chdir(prevCwd);

    // roots themselves with trailing dot/space (must fail closed, not widen)
    for (const [label, badRoot] of [
      ['root configured as root. (trailing dot)', root + '.'],
      ['root configured as root<space>', root + ' '],
      ['root configured as jn.', path.join(root, 'jn.')],
    ]) {
      const d = await productDecision(path.join(outside, 'x'), [badRoot]);
      const d2 = await productDecision(path.join(root, 'x'), [badRoot]);
      results.push({ group: 'root-trim', label, outsideCandidate: d, insideCandidate: d2, pass: d !== 'ALLOWED' });
      console.log(`${d !== 'ALLOWED' ? 'PASS' : 'FAIL'} ${label.padEnd(50)} outside->${d} inside->${d2}`);
    }
  }

  // ---- 8.3 short name of a junction ----
  {
    const T = path.join(R, 'short');
    const root = path.join(T, 'root');
    const outside = path.join(T, 'outside');
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    cmd(`mklink /J "${path.join(root, 'longjunctionname1')}" "${outside}"`);
    const dx = cmd(`dir /x "${root}"`);
    const m = /\s([A-Z0-9]{1,6}~\d)\s+longjunctionname1/i.exec(dx.out);
    const shortName = m ? m[1] : null;
    let d = 'n/a (8.3 names not generated on this volume)';
    if (shortName) d = await productDecision(path.join(root, shortName, 'sub'), [root]);
    results.push({ group: 'shortname', shortName, product: d, pass: !shortName || d !== 'ALLOWED' });
    console.log(`shortname=${shortName} -> ${d}`);
  }

  // ---- per-directory case sensitivity (ASCII fold assumption) ----
  {
    const T = path.join(R, 'cs');
    await fs.mkdir(T, { recursive: true });
    const en = cmd(`fsutil file setCaseSensitiveInfo "${T}" enable`);
    let detail = { setCaseSensitive: en };
    if (en.ok) {
      const root = path.join(T, 'root');
      const sibling = path.join(T, 'ROOT');
      await fs.mkdir(root);
      await fs.mkdir(sibling);
      const distinct = readdirSync(T);
      const d = await productDecision(path.join(sibling, 'x'), [root]);
      detail = { ...detail, dirEntries: distinct, siblingDecision: d, ESCAPE: d === 'ALLOWED' && distinct.length === 2 };
      cmd(`fsutil file setCaseSensitiveInfo "${T}" disable`);
    }
    results.push({ group: 'case-sensitive-dir', ...detail });
    console.log('case-sensitive dir:', JSON.stringify(detail));
  }

  // ---- Unicode case-folding oddities vs ASCII-only fold (GAP-295 generalisation) ----
  {
    const T = path.join(R, 'uc');
    await fs.mkdir(T, { recursive: true });
    const pairs = [
      ['Kelvin K U+212A', 'work', 'wor\u212A'],
      ['Angstrom U+212B', 'a\u00E5b', 'a\u212Bb'],
      ['Turkish dotless i U+0131', 'win', 'w\u0131n'],
      ['Turkish dotted I U+0130', 'Iron', '\u0130ron'],
      ['long s U+017F', 'desk', 'de\u017Fk'],
      ['sharp s vs ss', 'strasse', 'stra\u00DFe'],
      ['capital sharp s U+1E9E', 'ss1', '\u1E9E1'],
      ['ohm sign U+2126', '\u03C9x', '\u2126x'],
      ['fullwidth A', 'ab', '\uFF41b'],
      ['greek final sigma', 'a\u03C3', 'a\u03C2'],
      ['ligature fi U+FB01', 'fix', '\uFB01x'],
      ['e-acute NFC vs NFD', 'caf\u00E9', 'cafe\u0301'],
      ['Cyrillic a lookalike', 'data', 'd\u0430ta'],
      ['non-ASCII case: E-acute upper', 'caf\u00E9', 'CAF\u00C9'],
    ];
    for (const [label, rootName, lookName] of pairs) {
      const root = path.join(T, rootName + '-r');
      const look = path.join(T, lookName + '-r');
      await fs.mkdir(root, { recursive: true });
      let lookExistedSeparately = false;
      try {
        await fs.mkdir(look);
        lookExistedSeparately = true; // NTFS created a distinct directory
      } catch (e) {
        lookExistedSeparately = e.code !== 'EEXIST' ? `mkdir err ${e.code}` : false;
      }
      // Case A: both exist on disk; Case B: root exists, lookalike tail not yet created
      const dExisting = await productDecision(path.join(look, 'x'), [root]);
      const pure = isPathWithinRoot(path.join(look, 'x'), root, 'win32');
      // Case C: root does NOT exist (pure literal compare path)
      const ghostRoot = path.join(T, 'ghost', rootName + '-g');
      const ghostLook = path.join(T, 'ghost', lookName + '-g', 'x');
      const dGhost = await productDecision(ghostLook, [ghostRoot]);
      const escape = lookExistedSeparately === true && dExisting === 'ALLOWED';
      results.push({
        group: 'unicode-fold',
        label,
        ntfsTreatsAsDistinctDir: lookExistedSeparately,
        productExistingDirs: dExisting,
        pureIsPathWithinRoot: pure,
        productNonexistentRoot: dGhost,
        ESCAPE: escape,
      });
      console.log(`${escape ? '!!ESCAPE!!' : 'ok        '} ${label.padEnd(30)} distinct=${lookExistedSeparately} product=${dExisting.slice(0, 30)} pure=${pure} ghost=${dGhost.slice(0, 30)}`);
    }
  }
} finally {
  // remove every junction first (rmdir on a junction removes only the link), then the tree
  try {
    const walk = async (d) => {
      for (const ent of await fs.readdir(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isSymbolicLink()) {
          await fs.rm(p, { force: true, recursive: false }).catch(async () => fs.rmdir(p).catch(() => {}));
        } else if (ent.isDirectory()) await walk(p);
      }
    };
    await walk(R);
  } catch {}
  // trailing-dot directories created by the oracle: remove via cmd (Win32 rmdir can't address them; use \\?\)
  cmd(`rmdir /s /q "\\\\?\\${R}"`);
  await fs.rm(R, { recursive: true, force: true }).catch(() => {});
  console.log('cleanup: R exists after =', existsSync(R));
}

await fs.writeFile(path.join(here, 'probe-fix-attack.json'), JSON.stringify(results, null, 2), 'utf-8');
const escapes = results.filter((r) => r.ESCAPE === true);
const fails = results.filter((r) => r.pass === false);
console.log(`\nESCAPES: ${escapes.length}  expectation-FAILs: ${fails.length}  total rows: ${results.length}`);
