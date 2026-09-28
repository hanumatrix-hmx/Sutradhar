import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const R = fs.mkdtempSync(path.join(os.tmpdir(), 'fr205a1-td-'));
const root = path.join(R, 'root');
const outside = path.join(R, 'outside');
fs.mkdirSync(root); fs.mkdirSync(outside);
fs.symlinkSync(outside, path.join(root, 'jn'), 'junction');
fs.symlinkSync(outside, path.join(root, 'longjunctionname'), 'junction');
const out = {};
const tryf = (f) => { try { return f(); } catch (e) { return `ERR ${e.code ?? ''} ${String(e.stderr ?? e.message).slice(0, 200)}`; } };
try {
  out.nodeRealpathTrailingDot = tryf(() => fs.realpathSync.native(path.join(root, 'jn.')));
  out.nodeLstatTrailingDot = tryf(() => (fs.lstatSync(path.join(root, 'jn.')), 'exists'));
  out.nodeRealpathTrailingSpace = tryf(() => fs.realpathSync.native(path.join(root, 'jn ')));
  // Plain Win32 CreateDirectoryW (no \\?\ prefix) via Python, which does trailing dot/space normalization
  const py = 'import os,sys; os.makedirs(sys.argv[1]); print("ok")';
  out.win32MkdirViaDot = tryf(() => execFileSync('python', ['-c', py, path.join(root, 'jn.', 'viaDot')], { encoding: 'utf8' }).trim());
  out.win32MkdirViaSpace = tryf(() => execFileSync('python', ['-c', py, path.join(root, 'jn ', 'viaSpace')], { encoding: 'utf8' }).trim());
  out.outsideAfter = fs.readdirSync(outside);
  out.rootAfter = fs.readdirSync(root);
  out.shortName = tryf(() => execFileSync('cmd.exe', ['/d', '/c', `for %I in ("${path.join(root, 'longjunctionname')}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true }).trim());
  out.nodeRealpathShort = tryf(() => fs.realpathSync.native(out.shortName));
  console.log(JSON.stringify(out, null, 2));
} finally {
  try { fs.unlinkSync(path.join(root, 'jn')); } catch {}
  try { fs.unlinkSync(path.join(root, 'longjunctionname')); } catch {}
  fs.rmSync(R, { recursive: true, force: true });
  console.log('cleaned', !fs.existsSync(R));
}
