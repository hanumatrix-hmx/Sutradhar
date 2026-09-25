// Auditor fixture: a raw, UNMARKED puppeteer-core Chrome (not Sutradhar's), then idle.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.resolve(here, '../../../../../../../packages/browser/package.json'));
const puppeteer = req('puppeteer-core');
const b = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
console.log(JSON.stringify({ pid: process.pid, chromePid: b.process()?.pid }));
setInterval(() => {}, 1e9);
