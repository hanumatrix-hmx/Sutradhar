// Auditor fixture: launch n SDK browsers via the worktree's built sutradhar package, then idle.
import { launch } from '../../../../../../packages/sutradhar/dist/index.js';
const n = Number(process.argv[2] ?? 1);
const browsers = [];
for (let i = 0; i < n; i++) browsers.push(await launch({ headless: true }));
console.log(JSON.stringify({ pid: process.pid, n: browsers.length }));
setInterval(() => {}, 1e9);
