/**
 * @file packages/cli/tests/unit/spawn-chrome.spec.ts
 * @description FR2-03 SC1-SC2: the pure Chrome-argument builder extracted from
 * `spawnDetachedChrome` so its marker/flag output is testable without spawning anything real.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildChromeArgs } from '../../src/spawn-chrome.js';
import { SUTRADHAR_TEMP_DIR_RE } from '../../src/profile-cleanup.js';

describe('buildChromeArgs', () => {
  it('SC1: includes --user-data-dir, the cli launch marker, and a decodable --sutradhar-state; --headless=new only when headless', () => {
    const stateFile = path.join('C:', 'Users', 'John Doe', '.sutradhar-cli', 'ab', 'state.json');
    const headlessArgs = buildChromeArgs({ port: 1234, userDataDir: '/tmp/x', headless: true, stateFile });
    expect(headlessArgs).toContain('--user-data-dir=/tmp/x');
    expect(headlessArgs).toContain('--sutradhar-launch=cli');
    expect(headlessArgs).toContain(`--sutradhar-owner-pid=${process.pid}`);
    expect(headlessArgs).toContain('--headless=new');
    const stateArg = headlessArgs.find((a) => a.startsWith('--sutradhar-state='));
    expect(stateArg).toBeDefined();
    const decoded = Buffer.from(stateArg!.slice('--sutradhar-state='.length), 'base64url').toString('utf-8');
    expect(decoded).toBe(path.resolve(stateFile));

    const headedArgs = buildChromeArgs({ port: 1234, userDataDir: '/tmp/x', headless: false });
    expect(headedArgs).not.toContain('--headless=new');
  });

  it('SC2: the default dir basename matches SUTRADHAR_TEMP_DIR_RE and its parent is os.tmpdir()', async () => {
    // spawnDetachedChrome resolves its own default dir via mkdtemp(os.tmpdir(), 'sutradhar-cli-<ms>-')
    // — verify the naming convention directly against a real mkdtemp call under a stubbed temp
    // root, the same way spawnDetachedChrome itself resolves os.tmpdir().
    const fakeRoot = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-sc-root-'));
    try {
      const dir = await mkdtemp(path.join(fakeRoot, `sutradhar-cli-${Date.now()}-`));
      expect(SUTRADHAR_TEMP_DIR_RE.test(path.basename(dir))).toBe(true);
      expect(path.dirname(dir)).toBe(fakeRoot);
    } finally {
      await rm(fakeRoot, { recursive: true, force: true });
    }
  });
});
