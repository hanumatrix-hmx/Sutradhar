// A/B: SDK default dialog behaviour (no config, no option) on HEAD vs master bundle.
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { startObserver } from './observer-server.mjs';
const obs = await startObserver();
for (const [name, sdk] of [['head', process.argv[2]], ['master', process.argv[3]]]) {
  const { launch } = await import(pathToFileURL(sdk).href);
  const b = await launch({});
  const pg = (await b.pages())[0];
  await pg.goto('http://127.0.0.1:' + obs.port + '/p?c=ab-' + name);
  const t = performance.now();
  let err; try { await pg.click('#pr'); } catch (e) { err = e.message.slice(0, 120); }
  const ms = Math.round(performance.now() - t);
  await new Promise((r) => setTimeout(r, 500));
  console.log(JSON.stringify({ build: name, clickMs: ms, err, prompt: obs.beacons('ab-' + name, 'prompt') }));
  await b.close();
}
await obs.close(); process.exit(0);
