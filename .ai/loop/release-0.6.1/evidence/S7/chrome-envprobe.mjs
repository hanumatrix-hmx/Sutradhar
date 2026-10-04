// Scratch experiment (not evidence of product behaviour): does Chrome start with (a) a long --user-data-dir, (b) USERPROFILE/HOME overridden?
import { spawn, spawnSync } from 'node:child_process'; import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs'; import net from 'node:net';
const ISO = path.resolve(os.tmpdir()); const SYS = process.env.SystemRoot || 'C:\Windows';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port0 = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function trial(label, subLen, overrideHome) {
  // pad the dir name so the full path hits subLen characters
  const root = path.join(ISO, 'ep'); fs.mkdirSync(root, { recursive: true });
  let name = 'sutradhar-cli-1791077256031-Hp05PL';
  let dir = path.join(root, name);
  if (subLen) { const pad = Math.max(0, subLen - (dir.length)); dir = path.join(root, 'x'.repeat(pad > 1 ? pad - 1 : 0), name); }
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env }; if (overrideHome) { const h = path.join(ISO, 'ephome'); fs.mkdirSync(h, { recursive: true }); if (overrideHome === true || overrideHome === 'up') env.USERPROFILE = h; if (overrideHome === true || overrideHome === 'home') env.HOME = h; }
  const port = await port0();
  const child = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'], { env, stdio: 'ignore', windowsHide: true });
  let exited = null; child.on('exit', (c) => { exited = c; });
  const t0 = performance.now(); let up = false;
  while (performance.now() - t0 < 15000 && exited === null) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { up = true; break; } } catch {} await new Promise((r) => setTimeout(r, 250)); }
  console.log(`${label}: dirlen=${dir.length} overrideHome=${overrideHome} up=${up} exited=${exited} ms=${Math.round(performance.now() - t0)}`);
  spawnSync(path.join(SYS, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
}
await trial('E0 baseline short, no override', 0, false);
await trial('E1 short + USERPROFILE+HOME override', 0, true);
await trial('E2 len 217, no override', 217, false);
await trial('E3 len 217 + USERPROFILE+HOME override', 217, true);
await trial('E4 USERPROFILE only', 0, 'up');
await trial('E5 HOME only', 0, 'home');
