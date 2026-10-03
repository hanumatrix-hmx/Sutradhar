import os from 'node:os'; import path from 'node:path';
const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const root = norm(process.env.SUTRADHAR_ISO_ROOT ?? 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad');
const got = norm(os.tmpdir());
if (!got.startsWith(root + '/')) { process.stderr.write(`ISOLATION GUARD: os.tmpdir()=${got} is not under ${root}; aborting pid ${process.pid}\n`); process.exit(97); }
if (!process.env.SUTRADHAR_ISO_QUIET) process.stderr.write(`[iso-guard] tmpdir=${got} pid=${process.pid}\n`);
