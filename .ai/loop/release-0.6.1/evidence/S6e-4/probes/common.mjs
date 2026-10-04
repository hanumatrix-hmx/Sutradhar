// S4 auditor helpers. Pure: no side effects at import time.
import fsp from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
export const P = (tag, p, extra = '') => console.log(`[cleanup] probe ${tag} path="${p}"${extra ? ' ' + extra : ''}`);
export function header(name) { console.log(`== ${name} node=${process.version} platform=${process.platform} tmpdir=${os.tmpdir()} pid=${process.pid}`); }
export async function tree(dir) {
  const map = new Map();
  async function walk(d, rel) {
    let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { map.set(rel + '/<unreadable:' + e.code + '>', -1); return; }
    for (const e of ents) {
      const p = path.join(d, e.name); const r = rel ? rel + '/' + e.name : e.name; let st;
      try { st = await fsp.lstat(p); } catch (err) { map.set(r + '<lstat:' + err.code + '>', -1); continue; }
      if (st.isSymbolicLink()) map.set(r + '@link', 0); else if (st.isDirectory()) { map.set(r + '/', 0); await walk(p, r); } else map.set(r, st.size);
    }
  }
  await walk(dir, ''); let bytes = 0; for (const v of map.values()) if (v > 0) bytes += v;
  return { map, count: map.size, bytes };
}
export function sameTree(a, b) { if (a.count !== b.count || a.bytes !== b.bytes) return false; for (const [k, v] of a.map) if (b.map.get(k) !== v) return false; return true; }
export function missing(a, b) { return [...a.map.keys()].filter((k) => !b.map.has(k)); }
export async function setOld(d, mins = 20) { const past = new Date(Date.now() - mins * 60_000); await fsp.utimes(d, past, past); }
export async function profileDir(d, { lockfile = true, marker } = {}) {
  await fsp.mkdir(path.join(d, 'Default'), { recursive: true });
  await fsp.writeFile(path.join(d, 'Default', 'Preferences'), '{"p":1}');
  await fsp.writeFile(path.join(d, 'Local State'), '{"s":1}');
  if (lockfile) await fsp.writeFile(path.join(d, 'lockfile'), '');
  if (marker !== undefined) await fsp.writeFile(path.join(d, '.sutradhar-owner.json'), JSON.stringify({ chromePid: marker, cliPid: 1, createdAt: new Date().toISOString() }));
  return d;
}
let fails = 0;
export function check(name, ok, detail = '') { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) fails++; return ok; }
export function done() { console.log(`RESULT fails=${fails}`); process.exitCode = fails ? 1 : 0; }
export const exists = (p) => fsp.lstat(p).then(() => true, () => false);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
