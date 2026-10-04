// S8 auditor: independent enumeration of sync-throwing Puppeteer call sites. Own method list (derived by the auditor from
// puppeteer-core decorators, see audit.md), own scanner (character scan with comment/string awareness OFF, like the
// builder's: comments are listed too), keys file:line:col with col = 1-based column of the '.'.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const WT = process.argv[2]; const OUT = process.argv[3];
const methods = ['frameElement','evaluateHandle','evaluate','locator','$','$$','$eval','$$eval','waitForSelector','waitForFunction','content','addScriptTag','addStyleTag','click','focus','hover','select','tap','type','title',
 'goto','waitForNavigation','setContent','addPreloadScript','addExposedFunctionBinding','removeExposedFunctionBinding','waitForDevicePrompt',
 'getProperty','getProperties','jsonValue','isVisible','isHidden','toElement','clickablePoint','drag','dragEnter','dragOver','drop','dragAndDrop','touchStart','touchMove','touchEnd','press','boundingBox','boxModel','screenshot','isIntersectingViewport','scrollIntoView','asLocator'];
const uniq = [...new Set(methods)];
const files = execFileSync('git', ['-C', WT, 'ls-files', 'packages/*/src/**/*.ts', 'packages/*/src/*.ts'], { encoding: 'utf8' }).split('\n').filter(Boolean).filter(f => !f.includes('/dist/'));
const keys = [];
for (const f of files) {
  const src = readFileSync(`${WT}/${f}`, 'utf8');
  const lineStarts = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '.') continue;
    let j = i + 1; while (j < src.length && /\s/.test(src[j])) j++;
    let k = j; while (k < src.length && /[\w$]/.test(src[k])) k++;
    const name = src.slice(j, k);
    if (!uniq.includes(name)) continue;
    let m = k; while (m < src.length && /\s/.test(src[m])) m++;
    if (src[m] !== '(') continue;
    let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= i) lo = mid; else hi = mid - 1; }
    keys.push(`${f}:${lo + 1}:${i - lineStarts[lo] + 1} .${name}(`);
  }
}
writeFileSync(OUT, keys.join('\n') + '\n');
console.log(`files=${files.length} methods=${uniq.length} keys=${keys.length}`);
