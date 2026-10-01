// Negative control for attack-gen.mjs: a root whose browser / cli "redactors" are the identity. The generator must report every cell leaking
// (proof that its canary search can see a leak and that a pass is not the generator being blind). Usage: node mkidentity-attack-gen.cjs <outRoot>
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
fs.mkdirSync(path.join(out, 'packages/browser/dist'), { recursive: true });
fs.mkdirSync(path.join(out, 'packages/cli/dist'), { recursive: true });
fs.writeFileSync(
  path.join(out, 'packages/browser/dist/index.js'),
  'export const redactHistoryText = (x) => x;\nexport const redactHistoryUrl = (x) => x;\nexport const evalCodePreview = (x) => x;\n' +
    'export const sanitizeHistoryEntry = (e) => JSON.parse(JSON.stringify(e));\n',
);
fs.writeFileSync(
  path.join(out, 'packages/cli/dist/history-file.js'),
  'export const redactCliArgs = (verb, args) => [...args];\nexport const buildHistoryLine = (i) => ({ ...i });\n' +
    'export const formatHistoryHuman = (r) => JSON.stringify(r);\nexport const redactCwd = (c) => c;\n',
);
console.log('identity root at', out);
