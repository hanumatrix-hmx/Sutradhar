// AUDIT-1 concurrency + real-kill probe on the append path (cross-process). Evidence -> concurrency.json
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process'; import { pathToFileURL } from 'node:url';
import { here, logPid, delay } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const { readHistoryFile } = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/history-file.js')).href);
const out = {};
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-audit-conc-'));
const child = (args) => { const c = spawn(process.execPath, [path.join(here, 'appender-child.mjs'), ...args], { windowsHide: true }); logPid(c.pid, 'appender ' + args.slice(1, 2)); let o = ''; c.stdout.on('data', (d) => (o += d)); return { c, done: new Promise((r) => c.on('exit', (code) => r({ code, o }))) }; };
// A: 10 parallel appenders x 30 lines, sizes 200B / 5KB / 40KB / 63KB / 70KB (guard -> truncated)
{
  const file = path.join(scratch, 'a', 'history.jsonl');
  const kids = Array.from({ length: 10 }, (_, k) => child([file, `P${k}`, '30', '200,5000,40000,63000,70000']));
  const res = await Promise.all(kids.map((k) => k.done));
  const r = await readHistoryFile(file);
  const raw = await fs.readFile(file, 'utf8');
  const ids = r.lines.map((l) => l.parsed.args[0]);
  const sizes = raw.split('\n').filter(Boolean).map((l) => Buffer.byteLength(l));
  out.A = { exits: res.map((x) => x.code), reported: res.reduce((n, x) => n + x.o.split('\n').filter(Boolean).length, 0), valid: r.lines.length, skipped: r.skipped, unique: new Set(ids).size, maxLineBytes: Math.max(...sizes), over4k: sizes.filter((s) => s > 4096).length, truncatedLines: r.lines.filter((l) => l.parsed.truncated).length, blankLines: raw.split('\n').slice(0, -1).filter((l) => l === '').length };
  console.log('A', JSON.stringify(out.A));
}
// B: real taskkill /F of looping 63 KB appenders, 20 kills at random times, 2 concurrent writers each round
{
  const file = path.join(scratch, 'b', 'history.jsonl');
  const kills = [];
  for (let round = 0; round < 20; round++) {
    const k1 = child([file, `K${round}a`, '0', '63000,5000,200', 'loop']);
    const k2 = child([file, `K${round}b`, '0', '200,40000', 'loop']);
    await delay(250 + Math.floor(Math.random() * 400));
    for (const k of [k1, k2]) { const t = spawnSync('taskkill', ['/F', '/PID', String(k.c.pid)], { encoding: 'utf8' }); kills.push({ pid: k.c.pid, ok: /SUCCESS/.test(t.stdout) }); }
    await Promise.all([k1.done, k2.done]);
  }
  const before = await readHistoryFile(file);
  const rawB = await fs.readFile(file, 'utf8');
  const endsNl = rawB.endsWith('\n');
  // a clean append after the kills must never be glued to a fragment
  const after = child([file, 'AFTER', '3', '200']);
  await after.done;
  const r = await readHistoryFile(file);
  out.B = { kills: kills.length, killsOk: kills.filter((k) => k.ok).length, validBefore: before.lines.length, skippedBefore: before.skipped, fileEndedWithNewline: endsNl, validAfter: r.lines.length, skippedAfter: r.skipped, afterLinesFound: r.lines.filter((l) => String(l.parsed.args[0]).startsWith('AFTER')).length, sizeMB: (rawB.length / 1048576).toFixed(1) };
  // rotation happened? (5 MiB)
  out.B.rotatedExists = r.rotatedExists;
  console.log('B', JSON.stringify(out.B));
}
await fs.writeFile(path.join(here, 'concurrency.json'), JSON.stringify(out, null, 1));
await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
