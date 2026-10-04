// query: count marker processes. stop: taskkill /PID only logged PIDs that the live CIM query still shows with the marker; confirm.
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const PS = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', TK = 'C:/Windows/System32/taskkill.exe';
const marker = fs.readFileSync(process.env.MARKER_FILE, 'utf8').trim(); const logged = fs.readFileSync(process.env.PIDS_FILE, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const list = () => execFileSync(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'marker.ps1')], { env: { ...process.env, LOAD_MARKER: marker }, encoding: 'utf8', timeout: 60000 }).split(/\s+/).filter(Boolean).map(Number);
if (process.argv[2] === 'query') { const l = list(); console.log(`marker-processes=${l.length} pids=${l.join(',')}`); process.exit(0); }
const live = list(); console.log(`before stop: marker-processes=${live.length} logged=${logged.length}`);
for (const p of logged) { if (!live.includes(p)) { console.log(`pid ${p}: not live with marker (self-terminated) - not killed`); continue; } try { execFileSync(TK, ['/PID', String(p), '/F'], { stdio: 'pipe' }); console.log(`pid ${p}: marker confirmed, taskkill ok`); } catch (e) { console.log(`pid ${p}: taskkill ${String(e.stderr ?? e.message).trim()}`); } }
const t0 = performance.now(); let left = list(); while (left.length && performance.now() - t0 < 30000) { await new Promise((r) => setTimeout(r, 500)); left = list(); }
console.log(`after stop: marker-processes=${left.length}`); process.exitCode = left.length ? 1 : 0;
