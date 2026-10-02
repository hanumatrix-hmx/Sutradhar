/**
 * @file packages/capability-runtime/tests/unit/home-boundary.spec.ts
 * @description FR2-14 fix-2 (N2): the home boundary as a PROPERTY. Fix-1 closed one link direction
 * (a cwd junction INSIDE home pointing out); audit-2 found the mirror image (a link ABOVE home
 * pointing INTO home) still loaded a file above home, because the test cells were single
 * hand-written topologies. This suite generates the cross product
 *
 *   {cwd logical in/out of home} x {cwd canonical in/out of home} x {file location}
 *
 * for junctions AND directory symlinks (where the OS allows them) and checks the real discovery
 * against TWO independent oracles: (1) an explicit hand-derived table, and (2) a small
 * fs-based oracle written with `realpathSync` + `path.relative` only (it shares no helper with the
 * loader). The property: when the cwd is inside home by EITHER view, a config whose real directory
 * is strictly above home is never loaded, and never even looked at (`searched`).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjectConfigPath } from '../../src/project-config.js';

const tmpRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fr2-14-hb-')));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));
const CFG = '.sutradhar.json';

type Place = 'above' | 'home' | 'p' | 'out' | 'q' | 'none';
const PLACES: Place[] = ['above', 'home', 'p', 'out', 'q', 'none'];
type LinkType = 'junction' | 'dir';

interface Kind {
  name: string;
  /** Whether the kind needs a link (and so is run once per link type) or is a plain directory. */
  link: boolean;
  /** Where the cwd is, as a logical path (may go through a link). */
  cwd: (S: string) => string;
  /** The link to create: [at, target]. */
  makeLink?: (S: string) => [string, string];
  logicalInHome: boolean;
  canonicalInHome: boolean;
  /** HAND-DERIVED expectation: which placed file (by name) the discovery must load; `undefined` = none. */
  expected: Record<Place, Place | undefined>;
  /** HAND-DERIVED stop reason when nothing is loaded. */
  stop: 'home' | 'git-root';
}

const none: Record<Place, Place | undefined> = { above: undefined, home: undefined, p: undefined, out: undefined, q: undefined, none: undefined };
const kinds: Kind[] = [
  {
    name: 'A  cwd=home/p                 (logical in,  canonical in)',
    link: false,
    cwd: (S) => path.join(S, 'top', 'home', 'p'),
    logicalInHome: true,
    canonicalInHome: true,
    expected: { ...none, home: 'home', p: 'p' },
    stop: 'home',
  },
  {
    name: 'B  cwd=home/jn -> out/q       (logical in,  canonical OUT)  [fix-1 F3 case]',
    link: true,
    cwd: (S) => path.join(S, 'top', 'home', 'jn'),
    makeLink: (S) => [path.join(S, 'top', 'home', 'jn'), path.join(S, 'out', 'q')],
    logicalInHome: true,
    canonicalInHome: false,
    // the link's own target directory is a legitimate project root; nothing ABOVE home is reachable.
    expected: { ...none, home: 'home', q: 'q' },
    stop: 'home',
  },
  {
    name: 'B2 cwd=home/jt -> top         (logical in,  canonical ABOVE home)',
    link: true,
    cwd: (S) => path.join(S, 'top', 'home', 'jt'),
    makeLink: (S) => [path.join(S, 'top', 'home', 'jt'), path.join(S, 'top')],
    logicalInHome: true,
    canonicalInHome: false,
    expected: { ...none, home: 'home' }, // the link target is ABOVE home: its file is never loaded
    stop: 'home',
  },
  {
    name: 'C  cwd=top/jn -> home/p        (logical OUT, canonical in)   [audit-2 N2 case]',
    link: true,
    cwd: (S) => path.join(S, 'top', 'jn'),
    makeLink: (S) => [path.join(S, 'top', 'jn'), path.join(S, 'top', 'home', 'p')],
    logicalInHome: false,
    canonicalInHome: true,
    expected: { ...none, home: 'home', p: 'p' }, // 'above' is the logical parent of the link: NEVER loaded
    stop: 'home',
  },
  {
    name: 'C2 cwd=top/jh -> home          (logical OUT, canonical in = home itself)',
    link: true,
    cwd: (S) => path.join(S, 'top', 'jh'),
    makeLink: (S) => [path.join(S, 'top', 'jh'), path.join(S, 'top', 'home')],
    logicalInHome: false,
    canonicalInHome: true,
    expected: { ...none, home: 'home' },
    stop: 'home',
  },
  {
    name: 'D  cwd=out/q                  (logical OUT, canonical OUT)',
    link: false,
    cwd: (S) => path.join(S, 'out', 'q'),
    logicalInHome: false,
    canonicalInHome: false,
    expected: { ...none, out: 'out', q: 'q' },
    stop: 'git-root',
  },
  {
    name: 'D2 cwd=top/jo -> out/q        (logical OUT, canonical OUT, under the dir above home)',
    link: true,
    cwd: (S) => path.join(S, 'top', 'jo'),
    makeLink: (S) => [path.join(S, 'top', 'jo'), path.join(S, 'out', 'q')],
    logicalInHome: false,
    canonicalInHome: false,
    // home is not involved at all, so the plain upward walk applies (it passes `top`)
    expected: { ...none, above: 'above', q: 'q' },
    stop: 'git-root',
  },
];

const placeDir = (S: string, p: Place): string | undefined =>
  ({
    above: path.join(S, 'top'),
    home: path.join(S, 'top', 'home'),
    p: path.join(S, 'top', 'home', 'p'),
    out: path.join(S, 'out'),
    q: path.join(S, 'out', 'q'),
    none: undefined,
  })[p];

// ── independent oracle: realpath + path.relative only ──
const within = (child: string, root: string): boolean => {
  const r = path.relative(root, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};
function oracle(cwd: string, home: string): { loaded: string | undefined; looked: string[] } {
  const realHome = realpathSync(home);
  const realCwd = realpathSync(cwd);
  const logicalIn = within(path.resolve(cwd), path.resolve(home));
  const canonIn = within(realCwd, realHome);
  const inHome = logicalIn || canonIn;
  let d = !logicalIn && canonIn ? realCwd : path.resolve(cwd);
  const looked: string[] = [];
  for (;;) {
    if (path.dirname(d) === d) return { loaded: undefined, looked };
    const rd = realpathSync(d);
    const strictlyAboveHome = within(realHome, rd) && !within(rd, realHome);
    if (!(inHome && strictlyAboveHome)) {
      const f = path.join(d, CFG);
      looked.push(realpathSync(d));
      if (existsSync(f)) return { loaded: realpathSync(f), looked };
      if (existsSync(path.join(d, '.git'))) return { loaded: undefined, looked };
      if (inHome && within(rd, realHome) && within(realHome, rd)) return { loaded: undefined, looked };
    }
    d = path.dirname(d);
  }
}

let linkTypesSkipped: LinkType[] = [];
const results: Array<{ kind: string; linkType: string; place: Place; got: string | undefined }> = [];
let cells = 0;
let n = 0;

function build(kind: Kind, place: Place, linkType: LinkType): { S: string; cwd: string; home: string } | undefined {
  const S = path.join(tmpRoot, `t${n++}`);
  mkdirSync(path.join(S, '.git'), { recursive: true }); // hermetic outer boundary
  mkdirSync(path.join(S, 'top', 'home', 'p'), { recursive: true });
  mkdirSync(path.join(S, 'out', 'q'), { recursive: true });
  if (kind.makeLink) {
    const [at, target] = kind.makeLink(S);
    try {
      symlinkSync(target, at, linkType);
    } catch {
      return undefined; // this host does not allow this link type; counted and reported below
    }
  }
  const d = placeDir(S, place);
  if (d !== undefined) writeFileSync(path.join(d, CFG), JSON.stringify({ allowedDomains: [`${place}.test`] }));
  return { S, cwd: kind.cwd(S), home: path.join(S, 'top', 'home') };
}

describe('N2: the home boundary holds for every cwd topology x file location x link type', () => {
  for (const linkType of ['junction', 'dir'] as LinkType[]) {
    for (const kind of kinds) {
      if (!kind.link && linkType === 'dir') continue; // plain directories: run once (under 'junction')
      for (const place of PLACES) {
        it(`${kind.name.slice(0, 2).trim()} ${linkType} file@${place}`, async () => {
          const b = build(kind, place, linkType);
          if (b === undefined) {
            if (!linkTypesSkipped.includes(linkType)) linkTypesSkipped.push(linkType);
            return;
          }
          cells++;
          const r = await findProjectConfigPath(b.cwd, { homedir: b.home });
          const got = r.path === undefined ? undefined : realpathSync(r.path);
          const want = kind.expected[place];
          const wantPath = want === undefined ? undefined : realpathSync(path.join(placeDir(b.S, want)!, CFG));
          const o = oracle(b.cwd, b.home);
          const label = `${kind.name} / ${linkType} / file@${place}`;
          // the three must agree: hand table, independent oracle, real loader
          expect({ label, table: wantPath, oracle: o.loaded, loader: got }).toEqual({ label, table: wantPath, oracle: wantPath, loader: wantPath });
          if (got === undefined) {
            expect({ label, stop: r.stoppedAt }).toEqual({ label, stop: kind.stop });
          } else {
            expect(r.stoppedAt).toBe('found');
          }
          // the property itself: when the cwd is in home by either view, no directory strictly above home is even searched
          if (kind.logicalInHome || kind.canonicalInHome) {
            const above = realpathSync(path.join(b.S, 'top'));
            for (const c of r.searched) {
              const real = realpathSync(path.dirname(c));
              expect({ label, searched: c, realDir: real }).not.toEqual({ label, searched: c, realDir: above });
              expect(within(realpathSync(b.home), real) && !within(real, realpathSync(b.home)), `${label}: searched ${c} (real ${real}) above home`).toBe(false);
            }
          }
          results.push({ kind: kind.name.slice(0, 2).trim(), linkType, place, got: want });
        });
      }
    }
  }

  it('the cross product is not vacuous: every plain cell and every junction cell ran; symlink cells ran or are reported as unavailable', () => {
    const plain = kinds.filter((k) => !k.link).length * PLACES.length; // 12
    const linkKinds = kinds.filter((k) => k.link).length; // 5
    const junction = linkKinds * PLACES.length; // 30
    const symlink = linkTypesSkipped.includes('dir') ? 0 : linkKinds * PLACES.length;
    expect(cells).toBe(plain + junction + symlink);
    // eslint-disable-next-line no-console
    console.log(`home-boundary cross product: ${cells} cells ran (plain ${plain}, junction ${junction}, dir-symlink ${symlink}${symlink === 0 ? ' - NOT AVAILABLE on this host' : ''})`);
    expect(cells).toBeGreaterThanOrEqual(plain + junction);
  });

  it('negative control: the audit-2 repro would have loaded the file above home under the old rule (the cell is real)', async () => {
    // C / file@above: logical walk top/jn -> top finds top/.sutradhar.json unless the boundary guards it.
    const b = build(kinds.find((k) => k.name.startsWith('C '))!, 'above', 'junction');
    expect(b).toBeDefined();
    expect(existsSync(path.join(b!.S, 'top', CFG))).toBe(true);
    const r = await findProjectConfigPath(b!.cwd, { homedir: b!.home });
    expect(r.path).toBeUndefined();
    expect(r.stoppedAt).toBe('home');
    // ...while a cwd that is not in home by either view still walks to it (the rule is not "never read top")
    mkdirSync(path.join(b!.S, 'elsewhere-home'));
    const d2 = await findProjectConfigPath(b!.cwd, { homedir: path.join(b!.S, 'elsewhere-home') });
    expect(d2.path).toBe(path.join(b!.S, 'top', CFG));
  });
});
