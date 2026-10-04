import os from 'node:os';
const root = 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const got = os.tmpdir();
if (!got.startsWith(root + '/')) { process.stderr.write(`ISOLATION GUARD (mutant): ${got}\n`); process.exit(97); }
