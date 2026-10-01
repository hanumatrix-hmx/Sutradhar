// AUDIT-1 privacy canary probe, CLI surface (one process per command, real Chrome). Usage: node privacy-cli.mjs <cli-js> <label>
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { here, startServer, runCli, canariesIn, logPid } from './lib.mjs';
const [cliPath, label = 'cli'] = process.argv.slice(2);
const cli = path.resolve(cliPath);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-audit-cli-'));
const stateDir = path.join(scratch, 'state');
const upDir = path.join(scratch, 'CNRYcliupdir'); await fs.mkdir(upDir, { recursive: true });
const upFile = path.join(upDir, 'CNRYcliupname.txt'); await fs.writeFile(upFile, 'hello');
const srv = await startServer();
const P = srv.port;
const env = { SUTRADHAR_CLI_STATE_DIR: stateDir };
const log = [];
const run = async (...args) => { const r = await runCli(cli, args, { env, cwd: scratch }); log.push({ args, code: r.code, ms: r.ms, out: r.out.slice(0, 600), err: r.err.slice(0, 600) }); console.log(`[${r.code}] ${r.ms}ms ${args.join(' ').slice(0, 90)}`); return r; };
let chromePid;
try {
  await run('nav', `http://aud:CNRYcliuserpass@127.0.0.1:${P}/p?token=CNRYcliquery#CNRYclifrag`);
  try { const st = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8')); chromePid = st.chromePid; logPid(chromePid, 'chrome (cli-spawned, from state.json) ' + label); } catch {}
  await run('type', '#pw', 'CNRYclitype');
  await run('type', '#mangle', 'CNRYclimangle');
  await run('select', '#sel', 'CNRYselval');
  await run('setclipboard', 'CNRYcliclip');
  await run('getclipboard');
  await run('eval', "document.getElementById('pw').value + '|' + document.getElementById('sel').value");
  await run('eval', "throw new Error('boom')");
  await run('upload', '#file', upFile);
  await run('download', '#dl', path.join(scratch, 'CNRYclidldir'));
  await run('click', '#prompt');
  await run('dialog', 'accept', 'CNRYcliprompt');
  await run('waitfor', '0', '--text', 'CNRYcliwait');
  await run('click', '#btn', '--expect-text', 'CNRYcliexp');
  await run('nav', `127.0.0.1:${P}/p?token=CNRYnoscheme`);
  await run('type', '#pw', 'ab');
  await run('press', '#pw', 'Enter');
  await run('newtab', `http://127.0.0.1:${P}/p?token=CNRYclinewtab`);
  await run('tabs');
  const hist = await run('history');
  const histJ = await run('history', '--json');
  const file = await fs.readFile(path.join(stateDir, 'history.jsonl'), 'utf8');
  const MUST_NOT = ['CNRYcliuserpass', 'CNRYcliquery', 'CNRYclifrag', 'CNRYclitype', 'CNRYclimangle', 'CNRYCLIMANGLE', 'CNRYselval', 'CNRYcliclip', 'CNRYcliprompt', 'CNRYcliupdir', 'CNRYclidldir', 'CNRYnoscheme', 'CNRYclinewtab'];
  const DOCUMENTED = ['CNRYcliwait', 'CNRYcliexp', 'CNRYcliupname', 'CNRYdlname'];
  const found = { file: canariesIn(file), human: canariesIn(hist.out + hist.err), json: canariesIn(histJ.out) };
  const all = [...new Set([...found.file, ...found.human, ...found.json])];
  const unexpected = all.filter((f) => !DOCUMENTED.some((d) => f === d || f.startsWith(d)));
  const lines = file.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const jsonIdentical = histJ.out.replace(/\r\n/g, '\n') === file;
  const ls = spawnSync('ls', ['-la', stateDir], { encoding: 'utf8' }).stdout;
  const icacls = spawnSync('icacls', [path.join(stateDir, 'history.jsonl')], { encoding: 'utf8' }).stdout;
  const summary = { label, lines: lines.length, verbs: lines.map((l) => `${l.verb}:${l.exitCode}:${l.args.join(' ').slice(0, 60)}:[${l.actions.map((a) => a.actionType).join(',')}]`), found, unexpectedLeaks: unexpected, jsonIdentical, ls, icacls };
  await fs.writeFile(path.join(here, `privacy-${label}.json`), JSON.stringify({ summary, log, historyJsonl: file, human: hist.out }, null, 1));
  console.log(JSON.stringify({ unexpected, found, jsonIdentical, lines: lines.length }, null, 0));
  console.log(summary.verbs.join('\n'));
  console.log(ls, icacls);
} finally {
  const c = await run('close');
  const after = await run('history');
  console.log('after close history head:', after.out.split('\n').slice(0, 2).join(' | '), 'state.json exists:', await fs.stat(path.join(stateDir, 'state.json')).then(() => true, () => false));
  await srv.close();
  await fs.writeFile(path.join(here, `privacy-${label}-log.json`), JSON.stringify(log, null, 1));
  if (chromePid) { const alive = spawnSync('tasklist', ['/FI', `PID eq ${chromePid}`], { encoding: 'utf8' }).stdout.includes(String(chromePid)); console.log('chrome pid', chromePid, 'alive after close:', alive); }
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}
