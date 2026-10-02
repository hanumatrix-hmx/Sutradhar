// Builds the real directory tree of .sutradhar.json files the FR2-14 live-verify runs from.
// Every file is a REAL file in a real temp directory; nothing is mocked.
import fs from 'node:fs/promises';
import path from 'node:path';

/** @returns {Promise<Record<string,string>>} named absolute paths */
export async function buildTree(R) {
  const p = (...s) => path.join(R, ...s);
  const mk = (...s) => fs.mkdir(p(...s), { recursive: true });
  const cfg = (dir, obj) => fs.writeFile(path.join(p(dir), '.sutradhar.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));

  // The main project: a git root (boundary) with a config exercising every key (+ one typo'd key).
  await mk('proj', '.git');
  await mk('proj', 'a', 'b', 'c');
  await mk('proj', 'up');
  await fs.writeFile(p('proj', 'up', 'ok.txt'), 'ok-content');
  await mk('elsewhere');
  await fs.writeFile(p('elsewhere', 'x.txt'), 'x-content');
  await cfg('proj', {
    $schema: 'urn:sutradhar:config:1',
    allowedDomains: ['localhost'],
    downloadDir: './dl',
    allowedUploadRoots: ['./up'],
    viewport: { width: 700, height: 500 },
    dialog: { mode: 'dismiss' },
    idleTimeoutMs: 4000,
    allowedDomian: ['x.com'],
  });

  // A git root with no config at all (the default layer).
  await mk('proj0', '.git');

  // A config ABOVE a git root that must NOT be reached from inside the repo (worktree-style .git FILE).
  await mk('outer', 'repo', 'sub');
  await cfg('outer', { allowedDomains: ['127.0.0.1'] });
  await fs.writeFile(p('outer', 'repo', '.git'), 'gitdir: x');

  // Invalid files: every one must stop the command with a clear message.
  await mk('bad-empty', '.git');
  await cfg('bad-empty', { allowedDomains: [] });
  await mk('bad-json', '.git');
  await cfg('bad-json', '{"viewport": {"width": 1,}}');
  await mk('bad-idle', '.git');
  await cfg('bad-idle', { idleTimeoutMs: 30 });
  await mk('bad-type', '.git');
  await cfg('bad-type', { allowedDomains: 'example.com' });
  await mk('bad-domain', '.git');
  await cfg('bad-domain', { allowedDomains: ['https://localhost'] });
  await mk('bad-dup', '.git');
  await cfg('bad-dup', '{"allowedDomains":["localhost"],"allowedDomains":["other.test"]}');
  await mk('bad-comment', '.git');
  await cfg('bad-comment', '// hi\n{}');
  await mk('bad-big', '.git');
  await cfg('bad-big', '{"viewport":{"width":1,"height":1}}' + ' '.repeat(70000));
  await mk('bad-dir', '.git');
  await mk('bad-dir', '.sutradhar.json');
  await mk('bom', '.git');
  await fs.writeFile(p('bom', '.sutradhar.json'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"viewport":{"width":611,"height":422}}')]));
  await mk('proto', '.git');
  await cfg('proto', '{"__proto__":{"allowedDomains":["x.test"]}}');
  await mk('secret', '.git');
  await cfg('secret', { apiKey: 'sk-live-SECRET-xyz', dialog: { mode: 'accept', promptText: 'hunter2-SECRET' } });
  await mk('secret-bad', '.git');
  await cfg('secret-bad', '{"token": SECRET-sk-live-xyz}'); // an unquoted value: the JS engine message would quote this text

  // Hostile configs. escape/hooks sit at a git root; hp* sit in a PARENT of the cwd (found by walking up).
  await mk('escape', '.git');
  await cfg('escape', { downloadDir: '../outside' });
  await mk('hooks', '.git');
  await cfg('hooks', { downloadDir: '.git/hooks' });
  await mk('auto', '.git');
  await cfg('auto', { dialog: { mode: 'auto' } });
  await mk('hp', 'child');
  await cfg('hp', { downloadDir: '../outside-hp' });
  await mk('hp2', 'child');
  await cfg('hp2', { downloadDir: './dl', dialog: { mode: 'accept' } });
  await mk('hp3', 'child');
  await cfg('hp3', { allowedDownloadRoots: [p('outside-hp3')] });
  await mk('hp4', 'child');
  await cfg('hp4', { allowedDownloadRoots: ['./dl', '.git/x'] });

  // A fake home with a personal config, a sibling without, and a config ABOVE both (must never be read).
  await mk('fakehome', 'p', 'q');
  await cfg('fakehome', { viewport: { width: 640, height: 480 } });
  await mk('nohome', 'p', 'q');
  await cfg('.', { viewport: { width: 1, height: 1 } }); // R/.sutradhar.json

  // Two nested configs: the nearest must win.
  await mk('near', '.git');
  await mk('near', 'x', 'y');
  await cfg('near', { allowedDomains: ['localhost'] });
  await cfg(path.join('near', 'x'), { allowedDomains: ['127.0.0.1'] });

  // fix-1: a huge viewport (F8), a 20 KB unknown key (F4), and a config ABOVE a home that will hold a junction cwd (F3).
  await mk('vphuge', '.git');
  await cfg('vphuge', { viewport: { width: 1000000000, height: 1000000000 } });
  await mk('longkey', '.git');
  await cfg('longkey', '{"' + 'k'.repeat(20000) + '": 1}');
  await mk('f3top', 'home');
  await mk('f3top', '.git');
  await cfg('f3top', { allowedDomains: ['above-home.test'] });

  // Misc.
  await mk('n15', '.git');
  await mk('temp');
  await mk('state');
  return {
    proj: p('proj'), cwdC: p('proj', 'a', 'b', 'c'), projCfg: p('proj', '.sutradhar.json'), proj0: p('proj0'),
    outerRepoSub: p('outer', 'repo', 'sub'), outerCfg: p('outer', '.sutradhar.json'), elsewhereX: p('elsewhere', 'x.txt'),
    upOk: p('proj', 'up', 'ok.txt'),
  };
}
