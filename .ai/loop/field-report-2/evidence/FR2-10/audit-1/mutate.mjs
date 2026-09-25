// Auditor mutation driver: apply one textual mutation, run the relevant vitest, restore, verify hash.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const outDir = path.join(root, '.ai/loop/field-report-2/evidence/FR2-10/audit-1/mutations');
fs.mkdirSync(outDir, { recursive: true });
const SR = 'packages/mcp-server/src/session-resolution.ts';
const TOOLS = 'packages/mcp-server/src/tools.ts';
const RT = 'packages/capability-runtime/src/runtime.ts';

const mutations = [
  // --- required by the audit brief: one break per file ---
  { id: 'M1-sr-inflight-ignored', file: SR, pkg: 'mcp-server',
    from: "if (view.lifecycleOpsInFlight > 0) return { ok: false, message: msgInFlight(view.lifecycleOpsInFlight, lines) };",
    to: "if (false) return { ok: false, message: msgInFlight(view.lifecycleOpsInFlight, lines) };" },
  { id: 'M2-tools-wrapper-bypassed', file: TOOLS, pkg: 'mcp-server',
    from: 'const server = withSessionResolution(mcpServer, runtime);',
    to: 'const server = mcpServer; void withSessionResolution;' },
  { id: 'M3-rt-listSessions-counter-zero', file: RT, pkg: 'capability-runtime',
    from: 'return { sessions, lifecycleOpsInFlight: this.lifecycleOpsInFlight };',
    to: 'return { sessions, lifecycleOpsInFlight: 0 };' },
  // --- auditor's own probes of test discrimination ---
  { id: 'M4-rt-no-prune', file: RT, pkg: 'capability-runtime',
    from: 'this.clientSessions.delete(id); // crashed / reaped behind our back',
    to: '/* no prune */' },
  { id: 'M5-rt-no-sort', file: RT, pkg: 'capability-runtime',
    from: 'sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sessionId.localeCompare(b.sessionId));',
    to: '/* no sort */' },
  { id: 'M6-rt-shutdown-no-counter', file: RT, pkg: 'capability-runtime',
    from: "  public async shutdown(sessionId: string, reason = 'Runtime shutdown'): Promise<void> {\n    this.lifecycleOpsInFlight++;",
    to: "  public async shutdown(sessionId: string, reason = 'Runtime shutdown'): Promise<void> {\n    this.lifecycleOpsInFlight += 0;",
    alsoFrom: "      this.clientSessions.delete(sessionId);\n    } finally {\n      this.lifecycleOpsInFlight--;",
    alsoTo: "      this.clientSessions.delete(sessionId);\n    } finally {\n      this.lifecycleOpsInFlight -= 0;" },
  { id: 'M7-rt-attach-no-counter', file: RT, pkg: 'capability-runtime',
    from: "  public async attach(options: AttachOptions): Promise<LaunchResult> {\n    this.lifecycleOpsInFlight++;",
    to: "  public async attach(options: AttachOptions): Promise<LaunchResult> {\n    this.lifecycleOpsInFlight += 0;" },
  { id: 'M8-rt-attach-counts-as-launched', file: RT, pkg: 'capability-runtime',
    from: "this.clientSessions.set(session.id, 'attached');",
    to: "this.clientSessions.set(session.id, 'launched');" },
  { id: 'M9-sr-explicit-copied-not-same-ref', file: SR, pkg: 'mcp-server',
    from: 'if (args?.sessionId !== undefined) return cb(args, extra);',
    to: 'if (args?.sessionId !== undefined) return Promise.resolve(cb({ ...args }, extra));' },
  { id: 'M10-sr-empty-string-treated-omitted', file: SR, pkg: 'mcp-server',
    from: 'if (args?.sessionId !== undefined) return cb(args, extra);',
    to: 'if (args?.sessionId) return cb(args, extra);' },
  { id: 'M11-sr-no-note', file: SR, pkg: 'mcp-server',
    from: 'text: `sessionId omitted: used "${r.sessionId}", the only live browser session.`,',
    to: 'text: ``,' },
];

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const results = [];
for (const m of mutations) {
  const fp = path.join(root, m.file);
  const orig = fs.readFileSync(fp, 'utf8');
  const origSha = sha(fp);
  // runtime.ts may be CRLF on disk (autocrlf) — normalise the needle.
  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  const from = m.from.replace(/\n/g, eol), to = m.to.replace(/\n/g, eol);
  if (!orig.includes(from)) { results.push({ id: m.id, error: 'needle not found' }); continue; }
  let mutated = orig.replace(from, to);
  if (m.alsoFrom) {
    const af = m.alsoFrom.replace(/\n/g, eol);
    if (!mutated.includes(af)) { results.push({ id: m.id, error: 'alsoFrom needle not found' }); continue; }
    mutated = mutated.replace(af, m.alsoTo.replace(/\n/g, eol));
  }
  fs.writeFileSync(fp, mutated);
  let r;
  try {
    r = spawnSync(path.join(root, 'node_modules/.bin/vitest.cmd'), ['run', '--globals'], {
      cwd: path.join(root, 'packages', m.pkg), encoding: 'utf8', shell: true, timeout: 300000,
    });
  } finally {
    fs.writeFileSync(fp, orig);
  }
  const restored = sha(fp) === origSha;
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(path.join(outDir, `${m.id}.txt`), out);
  // eslint-disable-next-line no-control-regex
  const clean = out.replace(/\u001b\[[0-9;]*m/g, '');
  const tests = clean.match(/Tests\s+(.*)/)?.[1]?.trim();
  const failedNames = [...clean.matchAll(/^\s*(?:×|FAIL)\s+(.+)$/gm)].map((x) => x[1].trim()).slice(0, 40);
  results.push({ id: m.id, pkg: m.pkg, exit: r.status, tests, restored, failedNames });
  console.log(m.id, '|', tests, '| restored:', restored);
}
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(results, null, 2));
