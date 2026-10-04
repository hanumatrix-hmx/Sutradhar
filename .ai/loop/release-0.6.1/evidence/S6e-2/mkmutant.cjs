// scratch-only: builds a mutated COPY of temp-profile.ts (scan failure treated as []) for the wsl-a7b negative control
const fs = require('fs');
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
const a = "result: lines === null ? 'null' : lines.length });\n  return lines;\n}";
if (s.split(a).length !== 2) throw new Error('anchor count ' + (s.split(a).length - 1));
s = s.replace(a, "result: lines === null ? 'null' : lines.length });\n  return lines ?? [];\n}");
fs.writeFileSync(f, s);
console.log('mutated copy written: runScan returns lines ?? []');
