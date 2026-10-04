#!/usr/bin/env node
// transcript-check.mjs: optional strengthening (review-3 finding 8). Cross-checks a subagent's own harness transcript
// (written by Claude Code, not by the subagent) against the drive.mjs raw logs of its slot.
//   node transcript-check.mjs <agent-*.jsonl> <runsDir> <slot> [--json]
// Flags (FAIL):
//   T1 a Bash command that runs cli-bin.js directly, or references a raw/ log path other than through drive.mjs/log-view.mjs,
//      or computes hashes (sha256/createHash/hashlib), or uses curl/wget;
//   T2 a non-Bash tool that browses or fetches (WebFetch, WebSearch, any mcp__* browser tool), or Write/Edit on a raw/ path;
//   T3 a log record of kind cli whose seq never appeared in a transcript tool result as "logged <slot>/<id> <att> seq N exit E"
//      (a record the subagent did not produce through drive.mjs), or a transcript line whose exit differs from the log;
//   T4 more cli records in the log than drive.mjs invocations in the transcript for that task.
// Exit 0 when nothing is flagged.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const [tfile, runsDir, slot] = process.argv.slice(2);
const asJson = process.argv.includes('--json');
if (!tfile || !runsDir || !slot) { console.error('usage: node transcript-check.mjs <agent.jsonl> <runsDir> <slot> [--json]'); process.exit(2); }
const uses = []; const results = new Map();
for (const line of readFileSync(tfile, 'utf8').split('\n').filter(Boolean)) {
  let o; try { o = JSON.parse(line); } catch { continue; }
  const content = o?.message?.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (b.type === 'tool_use') uses.push({ id: b.id, name: b.name, input: b.input ?? {} });
    if (b.type === 'tool_result') results.set(b.tool_use_id, typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
  }
}
const flags = [];
const driveCalls = {};
const seen = new Map(); // key id:seq -> exit
const RAW = new RegExp(`runs[\\\\/]+${slot}[\\\\/]+raw`, 'i');
for (const u of uses) {
  if (u.name === 'Bash' || u.name === 'PowerShell') {
    const cmd = String(u.input.command ?? '');
    const viaDrive = /drive\.mjs/.test(cmd);
    if (/cli-bin\.js/.test(cmd) && !viaDrive) flags.push(`T1 direct cli-bin.js call: ${cmd.slice(0, 160)}`);
    if (RAW.test(cmd) && !/log-view\.mjs/.test(cmd)) flags.push(`T1 command touches raw logs: ${cmd.slice(0, 160)}`);
    if (/sha256|createHash|hashlib/i.test(cmd)) flags.push(`T1 hashing in a command: ${cmd.slice(0, 160)}`);
    if (/\b(curl|wget|Invoke-WebRequest|iwr)\b/i.test(cmd)) flags.push(`T1 HTTP client in a command: ${cmd.slice(0, 160)}`);
    if (viaDrive) {
      const m = /drive\.mjs"?\s+(\S+)\s+(\S+)\s+(\S+)/.exec(cmd);
      if (m && m[1] === slot) driveCalls[m[2]] = (driveCalls[m[2]] ?? 0) + 1;
      const out = results.get(u.id) ?? '';
      for (const g of out.matchAll(/logged (\S+)\/(\S+) (\S+) seq (\d+) exit (-?\d+)/g)) if (g[1] === slot) seen.set(`${g[2]}:${g[4]}`, Number(g[5]));
    }
  } else if (/^(WebFetch|WebSearch)$/.test(u.name) || /^mcp__.*(browser|chrome|Browser|sutradhar|playwright)/i.test(u.name)) {
    flags.push(`T2 forbidden tool ${u.name}`);
  } else if (/^(Write|Edit|NotebookEdit)$/.test(u.name) && RAW.test(String(u.input.file_path ?? ''))) {
    flags.push(`T2 ${u.name} on a raw log: ${u.input.file_path}`);
  }
}
const slotDir = path.join(runsDir, slot, 'raw');
const perTask = [];
if (existsSync(slotDir)) for (const f of readdirSync(slotDir).filter((x) => x.endsWith('.jsonl'))) {
  const id = f.replace('.jsonl', '');
  const log = readFileSync(path.join(slotDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const cli = log.filter((r) => r.kind === 'cli');
  for (const r of cli) {
    const k = `${id}:${r.seq}`;
    if (!seen.has(k)) flags.push(`T3 ${id} seq ${r.seq} (${r.verb}) has no matching drive.mjs output in the transcript`);
    else if (seen.get(k) !== r.exit) flags.push(`T3 ${id} seq ${r.seq} exit ${r.exit} in log vs ${seen.get(k)} in transcript`);
  }
  const calls = driveCalls[id] ?? 0;
  if (cli.length > calls) flags.push(`T4 ${id}: ${cli.length} cli records but only ${calls} drive.mjs calls in the transcript`);
  perTask.push({ id, cliRecords: cli.length, driveCalls: calls });
}
const report = { transcript: tfile, slot, toolUses: uses.length, perTask, flags, pass: flags.length === 0 };
if (asJson) console.log(JSON.stringify(report, null, 2));
else { for (const t of perTask) console.log(`${t.id}: cli records ${t.cliRecords}, drive.mjs calls ${t.driveCalls}`); for (const f of flags) console.log('FLAG ' + f); console.log(report.pass ? 'TRANSCRIPT CHECK OK' : 'TRANSCRIPT CHECK FLAGGED'); }
process.exit(report.pass ? 0 : 1);
