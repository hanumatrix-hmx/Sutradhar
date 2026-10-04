// Orchestrator: fills driver-brief.md's {SLOT}/{TASKS} per protocol 3.1/5.1; writes runs/<slot>/brief.md + brief.sha256.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const brief = readFileSync('driver-brief.md', 'utf8');
const sel = JSON.parse(readFileSync('selection.json', 'utf8'));
const fields = JSON.parse(readFileSync('task-fields.json', 'utf8'));
const proto = readFileSync('protocol.md', 'utf8').replace(/\r\n/g, '\n');
const probe = {};
const sec = proto.slice(proto.indexOf('### 2.6'), proto.indexOf('### 2.7'));
for (const line of sec.split('\n')) { const m = line.match(/^\| (\d+) \|[^|]*\|[^|]*\| (.*) \|$/); if (m) probe[m[1]] = m[2]; }
const block = (t, withProbe) => {
  const f = fields[String(t.id)]; if (!f) throw new Error('no fields for ' + t.id);
  const rf = f.map(x => `${x.key} x${x.min}`).join(', ');
  let b = `### Task ${t.id}\nstartingUrl: ${t.startingUrl}\nrequiredFields: ${rf}\n${t.task}`;
  if (withProbe) { if (!probe[String(t.id)]) throw new Error('no probe for ' + t.id); b += `\nprobe: ${probe[String(t.id)]}`; }
  return b;
};
const slots = { B1: sel.primary.slice(0, 6), B2: sel.primary.slice(6, 12), B3: sel.primary.slice(12, 18), B4: sel.primary.slice(18, 24), B5: sel.primary.slice(24, 30), B6: sel.retest };
for (const [slot, tasks] of Object.entries(slots)) {
  // Substitute only below the header's '---' line: the header itself names the placeholders literally.
  const cut = brief.replace(/\r\n/g, '\n').indexOf('\n---\n');
  if (cut < 0) throw new Error('no header separator');
  const norm = brief.replace(/\r\n/g, '\n');
  const head = norm.slice(0, cut + 5), body = norm.slice(cut + 5);
  const filled = head + body.split('{SLOT}').join(slot).split('{TASKS}').join(tasks.map(t => block(t, slot === 'B6')).join('\n\n'));
  mkdirSync(`runs/${slot}`, { recursive: true });
  writeFileSync(`runs/${slot}/brief.md`, filled);
  const h = createHash('sha256').update(filled).digest('hex');
  writeFileSync(`runs/${slot}/brief.sha256`, `${h}  runs/${slot}/brief.md\n`);
  console.log(slot, tasks.map(t => t.id).join(','), h.slice(0, 12), filled.includes('{') && /\{(SLOT|TASKS)\}/.test(filled) ? 'UNFILLED!' : 'ok');
}

// Slot K (canary reserves R31 1414 and R32 1310, protocol 4.4), same format, no probes.
{
  const ids = ['1414', '1310'];
  const tasks = ids.map(id => sel.reserve.find(t => String(t.id) === id));
  if (tasks.some(t => !t)) throw new Error('reserve missing');
  const norm = brief.replace(/\r\n/g, '\n'); const cut = norm.indexOf('\n---\n');
  const filled = norm.slice(0, cut + 5) + norm.slice(cut + 5).split('{SLOT}').join('K').split('{TASKS}').join(tasks.map(t => block(t, false)).join('\n\n'));
  mkdirSync('runs/K', { recursive: true });
  writeFileSync('runs/K/brief.md', filled);
  const h = createHash('sha256').update(filled).digest('hex');
  writeFileSync('runs/K/brief.sha256', `${h}  runs/K/brief.md\n`);
  console.log('K', ids.join(','), h.slice(0, 12));
}
