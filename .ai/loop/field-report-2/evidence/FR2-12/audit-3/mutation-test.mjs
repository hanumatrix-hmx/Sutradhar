// FR2-12 audit-3: auditor-authored source mutations of fix-2's NEW code, each run against the owning
// package's full vitest suite. Source restored from an in-memory copy after every mutation and
// sha256-verified. Touches ONLY packages/*/src files listed below (never dist, never evidence dirs
// other than audit-3). Writes audit-3/mutation-results.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-3')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const RT = path.join(root, 'packages/capability-runtime/src/runtime.ts');
const DJR = path.join(root, 'packages/cli/src/dialog-json-routing.ts');
const CLI = path.join(root, 'packages/cli/src/cli.ts');
const BT = path.join(root, 'packages/browser/src/session/browser-tab.ts');
const pkgOf = { [RT]: 'capability-runtime', [DJR]: 'cli', [CLI]: 'cli', [BT]: 'browser' };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const MUTS = [
  ['A1_no_mainframe_filter', RT, "if (event?.frame?.parentId) return; // ignore subframes", "// MUT removed subframe filter"],
  ['A2_listen_samedoc_too', RT, "await client.send('Page.enable');", "client.on('Page.navigatedWithinDocument', () => { navCommittedAt = new Date().toISOString(); }); await client.send('Page.enable');"],
  ['A3_first_commit_wins', RT, "navCommittedAt = new Date().toISOString();\n          });", "navCommittedAt ??= new Date().toISOString();\n          });"],
  ['A4_no_detach', RT, "await navCdpSession.detach().catch(() => {});", "/* MUT no detach */"],
  ['A5_remove_unscoped_lookup_push', RT, "brokenRequests.push({ url: mainDocumentResponse.url, status: mainDocumentResponse.status });", "/* MUT dropped */"],
  ['A6_lookup_first_not_last', RT, "const mainDocumentResponse = [...tab.getNetworkLog()]\n      .reverse()\n      .find(", "const mainDocumentResponse = [...tab.getNetworkLog()]\n      .find("],
  ['A7_lookup_ignore_resourceType', RT, "n.phase === 'response' && n.resourceType === 'document' && n.url === url", "n.phase === 'response' && n.url === url"],
  ['A8_lookup_ignore_url', RT, "n.phase === 'response' && n.resourceType === 'document' && n.url === url", "n.phase === 'response' && n.resourceType === 'document'"],
  ['A9_commit_listener_in_current_page_mode_too', RT, "options.url !== undefined && typeof", "typeof"],
  ['A10_since_ignores_commit', RT, "navCommittedAt,\n      timeOrigin:", "navCommittedAt: null,\n      timeOrigin:"],
  ['B1_guard_never_sets', DJR, "  guardState.printed = true;\n", "\n"],
  ['B2_guard_reset_each_call', DJR, "  if (guardState.printed) return false;", "  if (false) return false;"],
  ['B3_success_path_bypasses_guard', CLI, "writeJsonStdoutOnce(JSON.stringify(report, null, 2));", "console.log(JSON.stringify(report, null, 2));"],
  ['B4_preempt_bypasses_guard', CLI, "printDialogBlockedJsonOnce(blockedMessage, raced.pending);", "console.log(dialogBlockedJsonDoc(blockedMessage, raced.pending));"],
  ['B5_catch_bypasses_guard', CLI, "if (printDialogBlockedJsonOnce((err as Error).message, pending)) {", "if ((console.log(dialogBlockedJsonDoc((err as Error).message, pending)), true)) {"],
  ['C1_response_resourceType_dropped', BT, "        resourceType,\n        timestamp: new Date().toISOString(),\n      };\n      this.networkLog.push(entry);", "        timestamp: new Date().toISOString(),\n      };\n      this.networkLog.push(entry);"],
];

const results = [];
const originals = new Map();
for (const f of [RT, DJR, CLI, BT]) originals.set(f, await fs.readFile(f));
const preSha = Object.fromEntries([...originals].map(([f, b]) => [path.relative(root, f), sha(b)]));
function vitest(pkg) {
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: path.join(root, 'packages', pkg), encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  const txt = (r.stdout ?? '') + (r.stderr ?? '');
  const clean = txt.replace(/\x1b\[[0-9;]*m/g, '');
  const m = clean.match(/Tests\s+(.*)\n/);
  const failed = [...clean.matchAll(/(?:×|FAIL|✗)\s+(.+)/g)].map((x) => x[1].trim()).slice(0, 6);
  return { status: r.status, summary: m ? m[1].trim() : clean.slice(-400), failed };
}
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const OUTF = path.join(here, ONLY ? 'mutation-results-rerun.json' : 'mutation-results.json');
try {
  for (const [id, file, from0, to0] of MUTS) {
    if (ONLY && !ONLY.includes(id)) continue;
    const crlf = originals.get(file).toString('utf8').includes('\r\n');
    const from = crlf ? from0.replace(/\n/g, '\r\n') : from0;
    const to = crlf ? to0.replace(/\n/g, '\r\n') : to0;
    const orig = originals.get(file).toString('utf8');
    const count = orig.split(from).length - 1;
    if (count !== 1) { results.push({ id, error: `anchor matched ${count} times` }); continue; }
    await fs.writeFile(file, orig.replace(from, to));
    const v = vitest(pkgOf[file]);
    await fs.writeFile(file, originals.get(file));
    results.push({ id, file: path.relative(root, file), killed: v.status !== 0, ...v });
    console.log(id, v.status !== 0 ? 'KILLED' : 'SURVIVED', v.summary);
    await fs.writeFile(OUTF, JSON.stringify({ preSha, results }, null, 2));
  }
} finally {
  for (const [f, b] of originals) await fs.writeFile(f, b);
  const postSha = Object.fromEntries(await Promise.all([...originals.keys()].map(async (f) => [path.relative(root, f), sha(await fs.readFile(f))])));
  await fs.writeFile(OUTF, JSON.stringify({ preSha, postSha, restoredIdentical: JSON.stringify(preSha) === JSON.stringify(postSha), results }, null, 2));
}
