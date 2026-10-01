// AUDIT-1 child: appends lines through the REAL built appendHistoryLine. argv: file id count sizesCsv [loop]
import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const { buildHistoryLine, appendHistoryLine } = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/history-file.js')).href);
const [file, id, count, sizesCsv, loop] = process.argv.slice(2);
const sizes = sizesCsv.split(',').map(Number);
const mk = (i, bytes) => {
  const nActions = Math.max(0, Math.floor(bytes / 330));
  const actions = Array.from({ length: nActions }, (_, k) => ({ actionType: 'eval', success: true, executionTimeMs: 1, timestamp: '2026-01-01T00:00:00.000Z', target: 'x'.repeat(200), tabId: 't', seq: k + 1 }));
  return buildHistoryLine({ ts: new Date().toISOString(), sessionId: `${id}#${i}`, cwd: 'C:/x', verb: 'eval', args: [`${id}-${i}`], exitCode: 0, durationMs: bytes, actions, actionsEvicted: 0 });
};
let i = 0;
const n = Number(count);
while (loop === 'loop' || i < n) {
  const line = mk(i, sizes[i % sizes.length]);
  const r = await appendHistoryLine(file, line);
  if (!r.ok) { console.error('append failed', r.code); process.exit(2); }
  if (loop !== 'loop') process.stdout.write(`${id}-${i}\n`);
  i++;
}
