// A/B of UC-12 (headed saucedemo add-to-cart click) between the PRE-change build (master 75b29c6, temp dir) and this branch.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const roots = { base: 'E:/AI-Cache/tmp/fr208-master', mine: 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041' };
const out = process.argv[2];
const rows = [];
for (let round = 1; round <= Number(process.argv[3] ?? 4); round++) for (const name of ['base', 'mine']) {
  const o = `${out}.${name}-${round}.json`;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['tools/scenario-suite/run-cli.mjs'], { cwd: roots[name], env: { ...process.env, SCENARIO_FILTER: 'UC-12', SCENARIO_OUTPUT_PATH: o }, encoding: 'utf8', timeout: 400000 });
  let res; try { res = JSON.parse(fs.readFileSync(o, 'utf8'))[0]; } catch { res = { error: 'no output' }; }
  const row = { name, round, success: res.success, ms: res.ms, click: String(res.detail?.clickReportedSuccess ?? '').slice(0, 60), error: res.error, wall: Date.now() - t0 };
  rows.push(row); console.log(JSON.stringify(row));
}
fs.writeFileSync(out + '.summary.json', JSON.stringify(rows, null, 2));
