/**
 * @file packages/cli/tests/unit/collect-gc-snapshot.spec.ts
 * @description GAP-186 (audit-2): `collectGcSnapshot`'s own wiring line that feeds
 * `discoverMarkerStateFiles`'s output into the sessions scan (the actual GAP-175 fix) had NO
 * regression test at all — a mutation reverting exactly that one line (M9) passed all 142
 * existing tests, because every other GAP-175 test exercises `planGc` directly against a
 * hand-built `GcSnapshot`, never `collectGcSnapshot` itself. This test drives the real
 * `collectGcSnapshot` against a real scratch filesystem (only `listProcesses` is mocked, since
 * it's the one real-OS-dependent call `collectGcSnapshot` can't avoid) and asserts the
 * discovered custom state file actually shows up in the resulting snapshot's sessions list.
 */
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectGcSnapshot } from '../../src/gc.js';
import { normalizePathForCompare } from '../../src/profile-cleanup.js';

vi.mock('../../src/process-list.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/process-list.js')>('../../src/process-list.js');
  return { ...actual, listProcesses: vi.fn() };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listProcesses } = await import('../../src/process-list.js');

describe('GAP-186: collectGcSnapshot wires discoverMarkerStateFiles output into the sessions scan (M9 regression)', () => {
  let tempRoot: string;
  let customStateDir: string;
  let stateRoot: string;
  let prevTemp: string | undefined;
  let prevTmp: string | undefined;
  let prevStateRoot: string | undefined;
  let prevStateDir: string | undefined;

  beforeEach(async () => {
    tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'fr2-03-m9-root-')));
    customStateDir = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-m9-custom-'));
    stateRoot = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-m9-stateroot-'));
    await writeFile(
      path.join(customStateDir, 'state.json'),
      JSON.stringify({ sessionId: 'm9-session', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/does-not-exist' }),
    );

    prevTemp = process.env.TEMP;
    prevTmp = process.env.TMP;
    prevStateRoot = process.env.SUTRADHAR_CLI_STATE_ROOT;
    prevStateDir = process.env.SUTRADHAR_CLI_STATE_DIR;
    process.env.TEMP = tempRoot;
    process.env.TMP = tempRoot;
    process.env.SUTRADHAR_CLI_STATE_ROOT = stateRoot;
    delete process.env.SUTRADHAR_CLI_STATE_DIR;

    const browserDir = path.join(tempRoot, `sutradhar-cli-${Date.now()}-m9test`);
    await mkdir(browserDir, { recursive: true });
    const stateFilePath = path.join(customStateDir, 'state.json');
    const encoded = Buffer.from(stateFilePath, 'utf-8').toString('base64url');
    vi.mocked(listProcesses).mockResolvedValue({
      ok: true,
      processes: [
        {
          pid: 424242,
          ppid: 1,
          startMs: Date.now(),
          commandLine: `chrome --user-data-dir=${browserDir} --sutradhar-launch=cli --sutradhar-owner-pid=1 --sutradhar-owner-start=1 --sutradhar-state=${encoded}`,
        },
      ],
    });
  });

  afterEach(async () => {
    if (prevTemp === undefined) delete process.env.TEMP; else process.env.TEMP = prevTemp;
    if (prevTmp === undefined) delete process.env.TMP; else process.env.TMP = prevTmp;
    if (prevStateRoot === undefined) delete process.env.SUTRADHAR_CLI_STATE_ROOT; else process.env.SUTRADHAR_CLI_STATE_ROOT = prevStateRoot;
    if (prevStateDir === undefined) delete process.env.SUTRADHAR_CLI_STATE_DIR; else process.env.SUTRADHAR_CLI_STATE_DIR = prevStateDir;
    vi.mocked(listProcesses).mockReset();
    await rm(tempRoot, { recursive: true, force: true });
    await rm(customStateDir, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  });

  it('a marker-discovered custom state file (outside stateRoot, not in extraStateDirs) appears in the collected snapshot\'s sessions list', async () => {
    const snapshot = await collectGcSnapshot();
    const wanted = normalizePathForCompare(path.join(customStateDir, 'state.json'));
    const found = snapshot.sessions.sessions.some((s) => normalizePathForCompare(s.stateFile) === wanted);
    expect(found).toBe(true);
  });
});
