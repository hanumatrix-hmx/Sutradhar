/**
 * @file packages/cli/tests/unit/legacy-probe.spec.ts
 * @description GAP-194 (FR2-03 audit-4, fix-4): `probeLegacyChromeReachable` and its wiring into
 * `collectGcSnapshot`'s `legacyProbes` field. GAP-195 (audit-4) specifically flagged that this
 * loop's prior wiring points (`discoverMarkerStateFiles` into `extraStateFiles`) had zero test
 * coverage for the actual production wiring, only for the pure decision function -- this file
 * exists so the same mistake isn't repeated for GAP-194's fix. Exercises the real filesystem (a
 * real `DevToolsActivePort` file) and a real listening HTTP server standing in for Chrome's
 * `/json/version` endpoint, not just a hand-built `GcSnapshot`.
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probeLegacyChromeReachable, collectGcSnapshot } from '../../src/gc.js';
import { normalizePathForCompare } from '../../src/profile-cleanup.js';

describe('probeLegacyChromeReachable (pure function)', () => {
  let udd: string;
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise((r) => server!.close(r));
      server = undefined;
    }
    if (udd) await rm(udd, { recursive: true, force: true });
  });

  it('returns true when DevToolsActivePort names a port that actually answers /json/version', async () => {
    udd = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-fix4-legacyprobe-'));
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server!.address() as { port: number }).port;
    await writeFile(path.join(udd, 'DevToolsActivePort'), `${port}\n/devtools/browser/fake-id\n`);
    await expect(probeLegacyChromeReachable(udd)).resolves.toBe(true);
  });

  it('returns false when the DevToolsActivePort file is absent (genuinely orphaned legacy dir -- no regression for G12)', async () => {
    udd = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-fix4-legacyprobe-'));
    await expect(probeLegacyChromeReachable(udd)).resolves.toBe(false);
  });

  it('returns false when the named port refuses the connection (stale file, Chrome long gone)', async () => {
    udd = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-fix4-legacyprobe-'));
    // Port 1 is a reserved/unlikely-to-be-listening port on every platform this suite runs on.
    await writeFile(path.join(udd, 'DevToolsActivePort'), '1\n/devtools/browser/fake-id\n');
    await expect(probeLegacyChromeReachable(udd)).resolves.toBe(false);
  });

  it('returns false for a garbled (non-numeric) port line rather than throwing', async () => {
    udd = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-fix4-legacyprobe-'));
    await writeFile(path.join(udd, 'DevToolsActivePort'), 'not-a-port\n/x\n');
    await expect(probeLegacyChromeReachable(udd)).resolves.toBe(false);
  });
});

vi.mock('../../src/process-list.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/process-list.js')>('../../src/process-list.js');
  return { ...actual, listProcesses: vi.fn() };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listProcesses } = await import('../../src/process-list.js');

describe('GAP-194: collectGcSnapshot wires probeLegacyChromeReachable into legacyProbes (production wiring, not just planGc)', () => {
  let tempRoot: string;
  let server: Server;
  let browserDir: string;
  let prevTemp: string | undefined;
  let prevTmp: string | undefined;
  let prevStateRoot: string | undefined;
  let prevStateDir: string | undefined;

  beforeEach(async () => {
    tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'fr2-03-fix4-collect-root-')));
    prevTemp = process.env.TEMP;
    prevTmp = process.env.TMP;
    prevStateRoot = process.env.SUTRADHAR_CLI_STATE_ROOT;
    prevStateDir = process.env.SUTRADHAR_CLI_STATE_DIR;
    process.env.TEMP = tempRoot;
    process.env.TMP = tempRoot;
    process.env.SUTRADHAR_CLI_STATE_ROOT = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-fix4-collect-sr-'));
    delete process.env.SUTRADHAR_CLI_STATE_DIR;

    // Pure legacy (pre-0.5.0) naming -- no marker suffix -- matching SUTRADHAR_TEMP_DIR_RE.
    browserDir = path.join(tempRoot, `sutradhar-cli-${Date.now()}`);
    await mkdir(browserDir, { recursive: true });

    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    await writeFile(path.join(browserDir, 'DevToolsActivePort'), `${port}\n/devtools/browser/fake-id\n`);

    // Unmarked (no --sutradhar-* flags at all) -- exactly the legacy shape GAP-194 is about.
    vi.mocked(listProcesses).mockResolvedValue({
      ok: true,
      processes: [{ pid: 555111, ppid: 1, startMs: Date.now(), commandLine: `chrome --user-data-dir=${browserDir}` }],
    });
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    if (prevTemp === undefined) delete process.env.TEMP; else process.env.TEMP = prevTemp;
    if (prevTmp === undefined) delete process.env.TMP; else process.env.TMP = prevTmp;
    if (prevStateRoot === undefined) delete process.env.SUTRADHAR_CLI_STATE_ROOT; else process.env.SUTRADHAR_CLI_STATE_ROOT = prevStateRoot;
    if (prevStateDir === undefined) delete process.env.SUTRADHAR_CLI_STATE_DIR; else process.env.SUTRADHAR_CLI_STATE_DIR = prevStateDir;
    vi.mocked(listProcesses).mockReset();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('a real, reachable legacy Chrome\'s profile dir shows up as legacyProbes[dir] === true in the collected snapshot', async () => {
    const snapshot = await collectGcSnapshot();
    const key = normalizePathForCompare(browserDir);
    expect(snapshot.legacyProbes?.[key]).toBe(true);
  });
});
