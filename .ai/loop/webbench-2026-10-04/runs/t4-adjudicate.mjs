// Orchestrator: per task, compare drive.mjs invocations in the driver's own transcript with distinct logged seqs.
import { readFileSync, readdirSync } from 'node:fs';
const [slot, transcript] = process.argv.slice(2);
const cmds = [];
for (const l of readFileSync(transcript, 'utf8').split('\n').filter(Boolean)) {
  let j; try { j = JSON.parse(l); } catch { continue; }
  const c = j.message?.content; if (!Array.isArray(c)) continue;
  for (const p of c) if (p.type === 'tool_use' && p.input?.command) cmds.push(p.input.command);
}
const calls = {};
const re = new RegExp(String.raw`drive\.mjs"?\s+${slot}\s+(\d+)\s+(a\d)`, 'g');
for (const c of cmds) { let m; re.lastIndex = 0; while ((m = re.exec(c))) calls[m[1]] = (calls[m[1]] || 0) + 1; }
const rows = [];
for (const f of readdirSync(`runs/${slot}/raw`)) {
  const id = f.replace('.jsonl', '');
  const recs = readFileSync(`runs/${slot}/raw/${f}`, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  // auto-href records are written by the wrapper itself after a nav; every other kind is one driver invocation.
  const invocations = recs.filter(r => r.kind !== 'auto-href' && r.kind !== 'gap').length;
  const kinds = [...new Set(recs.map(r => r.kind))].join(',');
  rows.push(`${id}: invocations=${invocations} transcriptCalls=${calls[id] || 0} ${invocations === (calls[id] || 0) ? 'OK' : 'DIFF'} kinds=${kinds}`);
}
console.log(slot, '\n  ' + rows.join('\n  '));
