// Builds the live M-B2d / M-B2e mutants as dist patches of the post-S6g cli-bin.js (scratch copies only; the real dist is never written).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [, , src, outDir] = process.argv;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const s = fs.readFileSync(src, 'utf8');
const patches = {
  'cli-bin.mutB2e.js': ['    await stopSpawnedChrome(state, sessionStopDeps());\n  } else {', '    await stopSpawnedChrome(state, sessionStopDeps()).catch(() => {});\n  } else {'],
  'cli-bin.mutB2d.js': ['      await stopSpawnedChrome(state, sessionStopDeps());\n      return spawnFreshSession', '      await stopSpawnedChrome(state, sessionStopDeps()).catch(() => {});\n      return spawnFreshSession'],
};
console.log(`source sha256 ${sha(s)}`);
for (const [name, [from, to]] of Object.entries(patches)) {
  const n = s.split(from).length - 1;
  console.log(`${name}: ANCHOR-COUNT=${n}`);
  if (n !== 1) process.exitCode = 1; else { fs.writeFileSync(path.join(outDir, name), s.replace(from, () => to)); console.log(`  wrote ${name} sha256 ${sha(fs.readFileSync(path.join(outDir, name)))}`); }
}
