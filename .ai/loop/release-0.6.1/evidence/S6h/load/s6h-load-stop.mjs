// Stops ONLY the logged load-worker PIDs, after a live CIM CommandLine check that each still carries the marker; then confirms exit.
// mode "query": print how many processes carry the marker (used for the positive control and the final leftover query).
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const SYS = process.env.SystemRoot || 'C:\Windows'; const PS = path.join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); const TK = path.join(SYS, 'System32', 'taskkill.exe');
const marker = fs.readFileSync(process.env.LOAD_MARKER_FILE, 'utf8').trim(); const pids = fs.readFileSync(process.env.LOAD_PIDS_FILE, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const list = () => { const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:LOAD_MARKER) } | ForEach-Object { "$($_.ProcessId)" }'], { encoding: 'utf8', env: { ...process.env, LOAD_MARKER: marker }, timeout: 120_000 }); return (r.stdout ?? '').split(/\s+/).filter(Boolean).map(Number); };
const mode = process.argv[2];
if (mode === 'query') { const l = list(); console.log(`marker-processes=${l.length} pids=${l.join(',')}`); process.exit(0); }
const live = list(); console.log(`before stop: marker-processes=${live.length}; logged=${pids.length}`);
for (const p of pids) { if (!live.includes(p)) { console.log(`pid ${p}: already gone (self-terminated)`); continue; } const r = spawnSync(TK, ['/PID', String(p), '/T', '/F'], { encoding: 'utf8', timeout: 30_000 }); console.log(`pid ${p}: ownership confirmed by marker, taskkill status=${r.status}`); }
const t0 = performance.now(); let left = list(); while (left.length && performance.now() - t0 < 30_000) { await new Promise((r) => setTimeout(r, 500)); left = list(); }
console.log(`after stop: marker-processes=${left.length}`); process.exitCode = left.length ? 1 : 0;
