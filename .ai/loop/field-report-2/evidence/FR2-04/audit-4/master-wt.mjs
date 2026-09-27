// FR2-04 audit-4: build a TEMPORARY git worktree of master (7073142) so the overhead comparison is
// against a CLI dist built from master's own sources (fix-3 compared against the main checkout's
// dist, whose build state nobody controls). node_modules are provided by junctions: third-party
// entries point at THIS worktree's pnpm store (read-only use); every @sutradhar/* entry is re-pointed
// at the master worktree's own package (the originals are absolute junctions into this worktree).
// Every junction created is recorded in a manifest; teardown unlinks exactly those junctions
// (after lstat-confirming each is a link), then re-scans the tree to prove no link remains BEFORE
// `git worktree remove` -- so the removal can never recurse into this worktree's node_modules.
// usage: node master-wt.mjs setup|teardown <wtDir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [mode, wt] = process.argv.slice(2);
const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..', '..', '..', '..');
const manifest = path.join(wt + '.links.json');
const git = (...a) => execFileSync('git', a, { cwd: SRC, encoding: 'utf-8' });

if (mode === 'setup') {
  git('worktree', 'add', '--detach', wt, '7073142');
  const links = [];
  const link = (target, at) => { fs.symlinkSync(target, at, 'junction'); links.push(at); };
  link(path.join(SRC, 'node_modules'), path.join(wt, 'node_modules'));
  for (const pkg of fs.readdirSync(path.join(SRC, 'packages'))) {
    const srcNm = path.join(SRC, 'packages', pkg, 'node_modules');
    if (!fs.existsSync(srcNm) || !fs.existsSync(path.join(wt, 'packages', pkg))) continue;
    const dstNm = path.join(wt, 'packages', pkg, 'node_modules');
    fs.mkdirSync(dstNm, { recursive: true });
    for (const ent of fs.readdirSync(srcNm)) {
      if (ent === '.vite') continue;
      const s = path.join(srcNm, ent);
      if (ent.startsWith('@')) {
        fs.mkdirSync(path.join(dstNm, ent), { recursive: true });
        for (const sub of fs.readdirSync(s)) {
          const target = ent === '@sutradhar' || ent === '@hanumatrix' ? path.join(wt, 'packages', sub === 'dev-runtime' ? 'dev-runtime' : sub) : fs.realpathSync(path.join(s, sub));
          link(target, path.join(dstNm, ent, sub));
        }
      } else if (ent === '.bin') {
        continue; // tsc is invoked via the root node_modules/.bin through turbo/pnpm scripts
      } else {
        link(fs.realpathSync(s), path.join(dstNm, ent));
      }
    }
  }
  fs.writeFileSync(manifest, JSON.stringify(links, null, 2));
  console.log('setup ok, links:', links.length);
} else if (mode === 'teardown') {
  const links = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf-8')) : [];
  let removed = 0;
  for (const l of links) {
    try { const st = fs.lstatSync(l); if (st.isSymbolicLink()) { fs.unlinkSync(l); removed++; } else console.log('NOT A LINK, left alone:', l); } catch {}
  }
  // re-scan: refuse to remove the worktree if ANY link/junction is still inside it
  const remaining = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); const st = fs.lstatSync(p); if (st.isSymbolicLink()) remaining.push(p); else if (st.isDirectory()) walk(p); } };
  if (fs.existsSync(wt)) walk(wt);
  if (remaining.length) { console.log('ABORT: links remain', remaining.slice(0, 10)); process.exit(2); }
  git('worktree', 'remove', '--force', wt);
  fs.rmSync(manifest, { force: true });
  console.log('teardown ok, removed links:', removed, 'worktree removed:', !fs.existsSync(wt));
  console.log(git('worktree', 'list'));
}
