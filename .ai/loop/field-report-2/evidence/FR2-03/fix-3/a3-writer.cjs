// tight writeState-equivalent loop: fs.writeFile (truncate-then-write, non-atomic) of the SAME state, as fast as possible
const fs = require('fs'); const [sf, ms] = [process.argv[2], Number(process.argv[3])]; const body = JSON.stringify(JSON.parse(fs.readFileSync(sf, 'utf8')), null, 2);
const end = Date.now() + ms; let n = 0; (async () => { while (Date.now() < end) { await fs.promises.writeFile(sf, body, 'utf-8'); n++; } process.stdout.write(String(n)); })();
