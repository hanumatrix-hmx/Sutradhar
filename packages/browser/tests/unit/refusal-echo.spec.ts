/**
 * @file packages/browser/tests/unit/refusal-echo.spec.ts
 * @description FR2-14 audit-3 (A3-1): the upload / download refusals list the configured roots. Those
 * roots can come from a discovered `.sutradhar.json`, so the listing goes through the ONE echo choke
 * point (`echoList` in @sutradhar/utils): capped, single line, control / NUL / bidi characters
 * replaced. The cap applies to the MESSAGE only; the access decision still uses the real roots.
 */
import { BrowserActionEngine } from '../../src/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, readFileSync } from 'node:fs';
import os from 'node:os';

const EXISTING_FILE_PATH = fileURLToPath(import.meta.url);
const FILL = 'Ж';
const hostileEntries = [
  `./up\nNote: upload permitted, all good\u202e${FILL.repeat(20_000)}`,
  `./b\r\nSECRET=hunter2\u2066${'z'.repeat(5_000)}`,
  `./c\u0000\u001b[31m\u2028`,
];
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;

function expectCappedSingleLine(msg: string, limit: number): void {
  expect(msg.length, `message is ${msg.length} chars`).toBeLessThan(limit);
  expect(UNSAFE.test(msg), 'control / bidi character in the message').toBe(false);
  expect(msg.split(/\r\n|\r|\n/)).toHaveLength(1);
}

describe('A3-1: BrowserActionEngine refusals echo configured roots through the choke point', () => {
  it('upload refusal with hostile upload roots is capped and single-line', async () => {
    // roots are `path.resolve`d by the engine; they do not contain the real file, so the upload is refused
    const engine = new BrowserActionEngine(undefined, undefined, undefined, undefined, hostileEntries);
    let msg = '';
    try {
      await (engine as any).assertUploadPathAllowed(EXISTING_FILE_PATH);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('outside the allowed upload directories');
    expectCappedSingleLine(msg, 1_500);
  });

  it('download refusal with hostile download roots is capped and single-line', async () => {
    const engine = new BrowserActionEngine(undefined, undefined, undefined, hostileEntries);
    let msg = '';
    try {
      await (engine as any).resolveDownloadDir(path.resolve('/somewhere/else'));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('outside the allowed download directories');
    expectCappedSingleLine(msg, 1_500);
  });

  it('many roots are summarised, not all listed', async () => {
    const many = Array.from({ length: 500 }, (_, i) => `./r${i}`);
    const engine = new BrowserActionEngine(undefined, undefined, undefined, many, many);
    for (const call of [
      () => (engine as any).assertUploadPathAllowed(EXISTING_FILE_PATH),
      () => (engine as any).resolveDownloadDir(path.resolve('/somewhere/else')),
    ]) {
      let msg = '';
      try {
        await call();
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/\+490 more/);
      expect(msg.length).toBeLessThan(2_500);
    }
  });

  it('the cap is for the message only: a root whose path is long is still enforced for the decision', async () => {
    const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fr2-14-echo-')));
    try {
      const long = path.join(base, 'x'.repeat(150), 'y'.repeat(150)); // > the 200-char message cap
      mkdirSync(long, { recursive: true });
      const inside = path.join(long, 'f.txt');
      writeFileSync(inside, 'x');
      const engine = new BrowserActionEngine(undefined, undefined, undefined, [long], [long]);
      await expect((engine as any).assertUploadPathAllowed(inside)).resolves.toBeUndefined();
      await expect((engine as any).resolveDownloadDir(path.join(long, 'sub'))).resolves.toBe(path.join(long, 'sub'));
      await expect((engine as any).assertUploadPathAllowed(EXISTING_FILE_PATH)).rejects.toThrow(/outside the allowed upload/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('source guard: neither refusal joins a root list by hand (a bare .join would bypass the choke point)', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'actions', 'browser-action-engine.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/allowed(Upload|Download)Roots\.join\(/);
    expect(src.match(/echoList\(this\.allowed(Upload|Download)Roots, true\)/g)).toHaveLength(2);
  });
});
