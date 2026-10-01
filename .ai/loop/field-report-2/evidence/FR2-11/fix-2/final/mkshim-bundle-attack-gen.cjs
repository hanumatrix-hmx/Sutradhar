// Builds a shim "root" from BUNDLE files so the auditor's attack-gen.mjs (which imports packages/browser/dist/index.js and
// packages/cli/dist/history-file.js) can run UNMODIFIED against the code that is inside the shipped bundles.
// Usage: node mkshim.cjs <bundle-with-browser-code> <bundle-with-cli-code> <outRoot>
const fs = require('fs');
const path = require('path');
const [browserBundle, cliBundle, outRoot] = process.argv.slice(2);
const section = (file, startPrefix, endPrefix) => {
  const L = fs.readFileSync(file, 'utf8').split('\n');
  const find = (prefix, from = 0) => { for (let i = from; i < L.length; i++) if (L[i].startsWith(prefix)) return i; throw new Error('marker ' + prefix + ' in ' + file); };
  const a = find(startPrefix);
  const b = find(endPrefix, a + 1);
  return L.slice(a + 1, b).join('\n');
};
const browserSrc = section(browserBundle, '// ../browser/dist/session/action-history.js', '// ../browser/dist/session/browser-tab.js');
const cliSrc = section(cliBundle, '// ../cli/src/history-file.ts', '// ../cli/src/spawn-chrome.ts');
const src = [
  'const displayFrameUrl = (x) => x;',
  browserSrc,
  cliSrc,
  'export { redactHistoryText, sanitizeHistoryEntry, redactHistoryUrl, evalCodePreview, redactCliArgs, buildHistoryLine, formatHistoryHuman, redactCwd };',
].join('\n');
fs.mkdirSync(path.join(outRoot, 'packages/browser/dist'), { recursive: true });
fs.mkdirSync(path.join(outRoot, 'packages/cli/dist'), { recursive: true });
fs.writeFileSync(path.join(outRoot, 'shim.mjs'), src);
const url = 'file:///' + path.join(outRoot, 'shim.mjs').replace(/\\/g, '/');
fs.writeFileSync(path.join(outRoot, 'packages/browser/dist/index.js'), `export * from ${JSON.stringify(url)};\n`);
fs.writeFileSync(path.join(outRoot, 'packages/cli/dist/history-file.js'), `export * from ${JSON.stringify(url)};\n`);
console.log('shim: browser code from', browserBundle, '; cli code from', cliBundle);
