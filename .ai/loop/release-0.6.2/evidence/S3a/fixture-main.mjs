// Runs the S1 fixture server in its OWN process (a harness that drives the CLI with spawnSync blocks its own event loop,
// so an in-process server could not answer Chrome). Protocol: prints one JSON line {"port":N,"url":"..."} on stdout;
// reads commands on stdin, one per line: "pdf <abs file>" (serve that file's bytes at /pdf; replies "ok pdf"), "quit".
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (fixture-main)'); process.exit(97); }
const { start } = await import(pathToFileURL(`${WT}/.ai/loop/release-0.6.2/evidence/fixtures/fixture-server.mjs`).href);
const f = await start();
process.stdout.write(JSON.stringify({ port: f.port, url: f.url }) + '\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (line.startsWith('pdf ')) { f.setPdf(readFileSync(line.slice(4))); process.stdout.write('ok pdf\n'); }
  else if (line === 'quit') { rl.close(); await f.close(); process.exit(0); }
});
rl.on('close', async () => { await f.close(); process.exit(0); });
