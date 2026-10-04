// S7 L12m dist-patch anchor, counted in a given cli-bin.js (must be exactly 1 for each of the post-S6g and negative-control bundles).
const fs = require('fs');
const anchor = '        await runtime.shutdown(sessionId);\n      } catch {\n      }\n    }\n    await clearState();';
for (const f of process.argv.slice(2)) { const s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); console.log(`ANCHOR-COUNT=${s.split(anchor).length - 1} ${f.split('/').slice(-3).join('/')}`); }
