// Fresh re-queries used by evidence/FR2-14/run-1/false-pass-analysis.md. Each block asks a LIVE question
// again (real files, real CLI/MCP/SDK processes, a fresh listing) instead of reusing an earlier result, and
// prints the command and its output. Run after a forced build; writes nothing outside a temp root.
//   node tools/scenario-suite/false-pass-checks-fr2-14.mjs > false-pass-checks.out
import fs from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const CLI = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const BUNDLE_CLI = path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'cli-bin.js');
const R = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-14-fp-')));
const env0 = { ...process.env, TEMP: path.join(R, 'temp'), TMP: path.join(R, 'temp'), TMPDIR: path.join(R, 'temp') };
for (const k of ['SUTRADHAR_CONFIG', 'SUTRADHAR_ALLOWED_DOMAINS', 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS', 'SUTRADHAR_IDLE_TIMEOUT_MS']) delete env0[k];
await fs.mkdir(path.join(R, 'temp'), { recursive: true });
const run = (bin, args, cwd, extra = {}) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, env: { ...env0, SUTRADHAR_CLI_STATE_DIR: path.join(R, 'state'), ...extra }, encoding: 'utf-8' });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};
const show = (title, cmd, r) => console.log(`\n### ${title}\n$ ${cmd}\n(exit ${r.code})\n${[r.out, r.err].filter(Boolean).join('\n').replace(new RegExp(R.replace(/\\/g, '\\\\'), 'g'), '<R>')}`);

// A: discovery from a child directory (AC "live CLI picks the config up from a parent directory").
await fs.mkdir(path.join(R, 'proj', '.git'), { recursive: true });
await fs.mkdir(path.join(R, 'proj', 'a', 'b'), { recursive: true });
await fs.writeFile(path.join(R, 'proj', '.sutradhar.json'), JSON.stringify({ allowedDomains: ['localhost'], viewport: { width: 700, height: 500 }, typoKey: 1 }));
console.log(`child dir listing (must contain NO .sutradhar.json): ${JSON.stringify(await fs.readdir(path.join(R, 'proj', 'a', 'b')))}; parent has it: ${existsSync(path.join(R, 'proj', '.sutradhar.json'))}`);
show('A1 doctor from the CHILD dir (dist CLI)', 'sutradhar doctor   (cwd=<R>/proj/a/b)', run(CLI, ['doctor'], path.join(R, 'proj', 'a', 'b')));
show('A2 same through the BUNDLE binary', 'sutradhar(bundle) doctor   (cwd=<R>/proj/a/b)', run(BUNDLE_CLI, ['doctor'], path.join(R, 'proj', 'a', 'b')));
await fs.mkdir(path.join(R, 'noconf', '.git'), { recursive: true });
show('A3 NEGATIVE: a sibling git root with no config reports none (no leakage from <R>/proj)', 'sutradhar doctor   (cwd=<R>/noconf)', run(CLI, ['doctor'], path.join(R, 'noconf')));

// B: unknown key warns, does not fail (AC "unknown keys warn, not error").
show('B1 unknown key: warning on stderr, exit 0 (doctor does not need Chrome)', 'sutradhar doctor   (cwd=<R>/proj)', run(CLI, ['doctor'], path.join(R, 'proj')));

// C: fail-closed domains and malformed inputs: exit 1, a clear message, and NO session was created.
const bad = {
  'empty array': '{"allowedDomains":[]}',
  'wrong type': '{"allowedDomains":"example.com"}',
  'malformed JSON': '{"viewport": {"width": 1,}}',
  'duplicate key': '{"allowedDomains":["a.com"],"allowedDomains":["b.com"]}',
  'comments': '// c\n{}',
};
for (const [name, text] of Object.entries(bad)) {
  const d = path.join(R, `bad-${name.replace(/\W/g, '')}`);
  await fs.mkdir(path.join(d, '.git'), { recursive: true });
  await fs.writeFile(path.join(d, '.sutradhar.json'), text);
  const stateBefore = existsSync(path.join(R, 'state', 'state.json'));
  const r = run(CLI, ['nav', 'http://localhost:1/'], d);
  show(`C ${name}: stops before Chrome`, `sutradhar nav http://localhost:1/   (cwd=<R>/bad-${name.replace(/\W/g, '')})`, r);
  console.log(`state.json exists after: ${existsSync(path.join(R, 'state', 'state.json'))} (before: ${stateBefore})`);
}
// D: hostile discovered config: forbidden directory is not created, with the specific containment message.
const hp = path.join(R, 'hp');
await fs.mkdir(path.join(hp, 'child'), { recursive: true });
await fs.writeFile(path.join(hp, '.sutradhar.json'), JSON.stringify({ downloadDir: '../outside-hp' }));
const dr = run(CLI, ['nav', 'http://localhost:1/'], path.join(hp, 'child'));
show('D1 hostile parent config (downloadDir escapes its own tree)', 'sutradhar nav http://localhost:1/   (cwd=<R>/hp/child; config in <R>/hp)', dr);
console.log(`forbidden dir <R>/outside-hp exists: ${existsSync(path.join(R, 'outside-hp'))}`);
const dx = run(CLI, ['doctor'], path.join(hp, 'child'), { SUTRADHAR_CONFIG: path.join(hp, '.sutradhar.json') });
show('D2 same file loaded EXPLICITLY (trusted like an env var): accepted', 'SUTRADHAR_CONFIG=<R>/hp/.sutradhar.json sutradhar doctor', dx);
// E: precedence on the real CLI binary: flag > env > config, with a reachable-nowhere domain per layer; the runtime error names the winner.
await fs.mkdir(path.join(R, 'prec', '.git'), { recursive: true });
await fs.writeFile(path.join(R, 'prec', '.sutradhar.json'), JSON.stringify({ allowedDomains: ['config.example'] }));
for (const [label, args, extra] of [
  ['config only', [], {}],
  ['env + config', [], { SUTRADHAR_ALLOWED_DOMAINS: 'env.example' }],
  ['flag + env + config', ['--allowlist-domains', 'flag.example'], { SUTRADHAR_ALLOWED_DOMAINS: 'env.example' }],
]) {
  const r = run(CLI, ['nav', 'http://localhost:1/', ...args], path.join(R, 'prec'), extra);
  show(`E ${label}`, `sutradhar nav http://localhost:1/ ${args.join(' ')}   (env: ${JSON.stringify(extra)})`, { ...r, err: r.err.split('\n').filter((l) => /allowlist|Fatal/.test(l)).join('\n').slice(0, 260) });
}
try {
  show('cleanup: close the session the E block opened', 'sutradhar close', run(CLI, ['close'], path.join(R, 'prec')));
  execFileSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
} finally {
  for (let i = 0; i < 15; i++) {
    try { await fs.rm(R, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 400)); }
  }
}
console.log('\n(temp root removed)');
