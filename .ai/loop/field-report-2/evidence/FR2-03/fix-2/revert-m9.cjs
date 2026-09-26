const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const repo = path.resolve(__dirname, '../../../../../..'); const cliDir = path.join(repo, 'packages/cli');
const f = path.join(cliDir, 'src/gc.ts'); const orig = fs.readFileSync(f, 'utf8'); const h0 = crypto.createHash('sha256').update(orig).digest('hex');
const from = `extraStateFiles: [...extraStateDirs.map((d) => path.join(d, 'state.json')), ...discoveredStateFiles],`;
const to = `extraStateFiles: [...extraStateDirs.map((d) => path.join(d, 'state.json'))], // M9: discovered files dropped`;
if (!orig.includes(from)) { console.log('M9 DID NOT APPLY'); process.exit(1); }
fs.writeFileSync(f, orig.replace(from, to));
const r = spawnSync(path.join(repo, 'node_modules/.bin/vitest.cmd'), ['run'], { cwd: cliDir, encoding: 'utf8', shell: true });
fs.writeFileSync(f, orig);
const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
const line = `== M9 GAP-175 wiring: collectGcSnapshot no longer feeds discovered marker state files into the sessions scan (src/gc.ts)\n   vitest exit ${r.status}; ${(out.match(/Tests\s+.*$/m) || [''])[0].trim()}\n   ${out.split('\n').filter((l) => /^\s*FAIL\s/.test(l)).map((l) => l.trim()).join('\n   ') || '(no failing test)'}\n   restored-sha-match: ${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') === h0}\n`;
fs.appendFileSync(path.join(__dirname, 'revert-and-confirm-fix2.txt'), line); console.log(line);
