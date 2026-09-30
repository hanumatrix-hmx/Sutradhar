// AUDIT-1: exact-count concurrency under the rotation threshold, and loss accounting across rotation.
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { spawn } from 'node:child_process'; import { pathToFileURL } from 'node:url';
import { here, logPid } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const { readHistoryFile } = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/history-file.js')).href);
const child = (args) => { const c = spawn(process.execPath, [path.join(here, 'appender-child.mjs'), ...args], { windowsHide: true }); logPid(c.pid, 'appender2 ' + args[1]); let o = ''; c.stdout.on('data', (d) => (o += d)); return new Promise((r) => c.on('exit', (code) => r({ code, o }))); };
const out = {};
for (const [name, procs, per, sizes] of [['under5MiB', 12, 10, '200,5000,40000,63000,70000'], ['acrossRotation', 10, 30, '200,5000,40000,63000,70000']]) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-audit-c2-'));
  const file = path.join(scratch, 'history.jsonl');
  const res = await Promise.all(Array.from({ length: procs }, (_, k) => child([file, `${name}${k}`, String(per), sizes])));
  const cur = await readHistoryFile(file);
  let rot = { lines: [], skipped: 0 };
  try { rot = await readHistoryFile(path.join(scratch, 'history.1.jsonl')); } catch {}
  const rotBytes = await fs.stat(path.join(scratch, 'history.1.jsonl')).then((s) => s.size, () => 0);
  const curBytes = (await fs.stat(file)).size;
  out[name] = { appended: res.reduce((n, x) => n + x.o.split('\n').filter(Boolean).length, 0), exits: [...new Set(res.map((x) => x.code))], current: cur.lines.length, rotated: rot.lines.length, skipped: cur.skipped + rot.skipped, lost: res.reduce((n, x) => n + x.o.split('\n').filter(Boolean).length, 0) - cur.lines.length - rot.lines.length, curMB: (curBytes / 1048576).toFixed(2), rotMB: (rotBytes / 1048576).toFixed(2) };
  console.log(name, JSON.stringify(out[name]));
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}
await fs.writeFile(path.join(here, 'concurrency2.json'), JSON.stringify(out, null, 1));
