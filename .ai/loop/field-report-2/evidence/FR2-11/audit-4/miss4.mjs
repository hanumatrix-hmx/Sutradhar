// AUDIT-4 missing-session cases: (1) state.json deleted under a live session -> history still reads, no (current), next command
// starts a new session and its line carries the new id; (2) state.json pointing at a dead endpoint -> the command self-heals and the
// line records the post-heal session id. Usage: node miss4.mjs <cli-js>
import fs from 'node:fs/promises'; import fsS from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { here, runCli } from './lib4.mjs';
const cli = path.resolve(process.argv[2]);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-a4miss-'));
const stateDir = path.join(scratch, 'state'); const env = { SUTRADHAR_CLI_STATE_DIR: stateDir };
const run = (...a) => runCli(cli, a, { env, cwd: scratch });
const st = () => JSON.parse(fsS.readFileSync(path.join(stateDir, 'state.json'), 'utf8'));
const lines = () => fsS.readFileSync(path.join(stateDir, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const out = {};
try {
  await run('eval', '1');
  const s1 = st();
  const saved = fsS.readFileSync(path.join(stateDir, 'state.json'), 'utf8');
  await fs.rm(path.join(stateDir, 'state.json'));
  const h = await run('history');
  out.deleted = { code: h.code, current: (h.out.match(/\(current\)/g) ?? []).length, header: h.out.split('\n')[0].replace(scratch, '<scratch>') };
  // restore the state so the first Chrome can be closed cleanly later; then point it at a dead endpoint
  const dead = { ...JSON.parse(saved), wsEndpoint: 'ws://127.0.0.1:9/devtools/browser/dead' };
  await fs.writeFile(path.join(stateDir, 'state.json'), saved);
  await run('close');
  await fs.writeFile(path.join(stateDir, 'state.json'), JSON.stringify(dead));
  const r = await run('eval', '2');
  const s2 = st(); const ls = lines();
  out.stale = { code: r.code, err: r.err.trim().split('\n')[0]?.slice(0, 160), newSession: s2.sessionId !== s1.sessionId, lastLineSession: ls.at(-1).sessionId === s2.sessionId, lastVerb: ls.at(-1).verb, lastActions: ls.at(-1).actions.map((a) => a.actionType), sessions: [...new Set(ls.map((l) => l.sessionId))].length };
  await run('close');
} finally { await fs.rm(scratch, { recursive: true, force: true }).catch(() => {}); }
await fs.writeFile(path.join(here, 'miss4.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
