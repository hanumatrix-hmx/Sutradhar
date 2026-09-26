/**
 * @file packages/cli/tests/unit/sessions.spec.ts
 * @description FR2-03 S1-S10 (subset): pure classification, endpoint probing against a real
 * local HTTP server, and state-file scanning.
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifySession, probeEndpoint, scanStateFiles } from '../../src/sessions.js';

describe('classifySession (FR2-03 §0.3)', () => {
  it('S1: reachable -> live', () => {
    expect(classifySession({ reachable: true, pidAlive: true, pidMatchesProfile: true })).toBe('live');
  });
  it('S2: unreachable + dead -> stale', () => {
    expect(classifySession({ reachable: false, pidAlive: false, pidMatchesProfile: null })).toBe('stale');
  });
  it('S3: unreachable + alive + match -> unresponsive', () => {
    expect(classifySession({ reachable: false, pidAlive: true, pidMatchesProfile: true })).toBe('unresponsive');
  });
  it('S4: unreachable + alive + mismatch -> stale', () => {
    expect(classifySession({ reachable: false, pidAlive: true, pidMatchesProfile: false })).toBe('stale');
  });
  it('S5: unreachable + alive + enumeration unavailable -> unknown', () => {
    expect(classifySession({ reachable: false, pidAlive: true, pidMatchesProfile: null })).toBe('unknown');
  });
  it('S6: legacy state (pidMatchesProfile derived from tempdir prefix) + alive + match -> unresponsive', () => {
    expect(classifySession({ reachable: false, pidAlive: true, pidMatchesProfile: true })).toBe('unresponsive');
  });
});

describe('probeEndpoint (S7)', () => {
  let server: Server;
  let port: number;
  let browserId: string;

  beforeEach(async () => {
    browserId = 'abc-123';
    server = createServer((req, res) => {
      if (req.url === '/json/version') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:0/devtools/browser/${browserId}` }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('S7: same browser id -> reachable', async () => {
    const result = await probeEndpoint(`ws://127.0.0.1:${port}/devtools/browser/${browserId}`);
    expect(result.reachable).toBe(true);
  });

  it('S7: different id -> unreachable (browser-id-mismatch)', async () => {
    const result = await probeEndpoint(`ws://127.0.0.1:${port}/devtools/browser/OTHER`);
    expect(result).toEqual({ reachable: false, reason: 'browser-id-mismatch' });
  });

  it('S7: a closed port gives unreachable in under 1000ms', async () => {
    const closedPort = port;
    await new Promise((resolve) => server.close(resolve));
    const start = Date.now();
    const result = await probeEndpoint(`ws://127.0.0.1:${closedPort}/devtools/browser/${browserId}`);
    expect(result.reachable).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  }, 2000);
});

describe('scanStateFiles (S8)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-scan-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('S8: valid + legacy + corrupt state.json plus a stray plain file gives exactly 3 entries', async () => {
    await mkdir(path.join(root, 'a'));
    await writeFile(
      path.join(root, 'a', 'state.json'),
      JSON.stringify({ sessionId: 's1', wsEndpoint: 'ws://x', profileDir: '/tmp/x', cwd: '/proj', createdAt: new Date().toISOString() }),
    );
    await mkdir(path.join(root, 'b'));
    await writeFile(path.join(root, 'b', 'state.json'), JSON.stringify({ sessionId: 's2', wsEndpoint: 'ws://y' }));
    await mkdir(path.join(root, 'c'));
    await writeFile(path.join(root, 'c', 'state.json'), '{not json');
    await writeFile(path.join(root, 'stray.txt'), 'hello');

    const scanned = await scanStateFiles(root, path.join(root, 'a', 'state.json'));
    expect(scanned).toHaveLength(3);
    const corrupt = scanned.find((s) => s.stateFile === path.join(root, 'c', 'state.json'));
    expect(corrupt?.parseOk).toBe(false);
  });

  it('S8: an ENOENT root gives []', async () => {
    const scanned = await scanStateFiles(path.join(root, 'does-not-exist'), '/x/state.json');
    expect(scanned).toEqual([]);
  });

  it('GAP-188 (FR2-03 fix-3): a state.json that fails to READ (not just parse) is unified into the same protected `unreadable` outcome, instead of being silently dropped -- here simulated with a directory named state.json (stat succeeds, readFile throws EISDIR), the same OS-level shape as a locked/exclusive-open file failing readFile rather than stat', async () => {
    await mkdir(path.join(root, 'locked'));
    await mkdir(path.join(root, 'locked', 'state.json')); // state.json is itself a directory
    const scanned = await scanStateFiles(root, '/nope');
    expect(scanned).toHaveLength(1);
    expect(scanned[0]!.parseOk).toBe(false);
    expect(scanned[0]!.raw).toBeUndefined();
  });

  it('GAP-188: a state-file path that genuinely does not exist at all (ENOENT on stat) is still silently skipped -- not every non-parse case becomes a phantom `unreadable` entry, only a real I/O failure on a path that DOES exist', async () => {
    // No 'ghost' directory created at all -- stat(root/ghost/state.json) is a plain ENOENT.
    const scanned = await scanStateFiles(root, '/nope');
    expect(scanned).toEqual([]);
  });

  describe('GAP-189 (FR2-03 fix-3): viaMarker tagging', () => {
    it('a path found ONLY via markerStateFiles (not under stateRoot, not in extraStateFiles) is tagged viaMarker:true', async () => {
      const markerDir = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-marker-'));
      const markerFile = path.join(markerDir, 'state.json');
      await writeFile(markerFile, JSON.stringify({ sessionId: 's', wsEndpoint: 'ws://x' }));
      const scanned = await scanStateFiles(root, '/nope', [], [markerFile]);
      expect(scanned).toHaveLength(1);
      expect(scanned[0]!.viaMarker).toBe(true);
      await rm(markerDir, { recursive: true, force: true });
    });

    it('a path found via the trusted stateRoot scan is tagged viaMarker:false even when the SAME path is also passed in markerStateFiles (trusted route wins, and it is never double-counted)', async () => {
      await mkdir(path.join(root, 'trusted'));
      const trustedFile = path.join(root, 'trusted', 'state.json');
      await writeFile(trustedFile, JSON.stringify({ sessionId: 's', wsEndpoint: 'ws://x' }));
      const scanned = await scanStateFiles(root, '/nope', [], [trustedFile]);
      expect(scanned).toHaveLength(1); // not double-counted
      expect(scanned[0]!.viaMarker).toBe(false);
    });

    it('a path passed via extraStateFiles (e.g. this process\'s own SUTRADHAR_CLI_STATE_DIR) is trusted (viaMarker:false), distinct from markerStateFiles', async () => {
      const extraDir = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-extra-'));
      const extraFile = path.join(extraDir, 'state.json');
      await writeFile(extraFile, JSON.stringify({ sessionId: 's', wsEndpoint: 'ws://x' }));
      const scanned = await scanStateFiles(root, '/nope', [extraFile]);
      expect(scanned).toHaveLength(1);
      expect(scanned[0]!.viaMarker).toBe(false);
      await rm(extraDir, { recursive: true, force: true });
    });
  });

  it('S9: legacy state age uses the file mtime; a new state uses createdAt', async () => {
    await mkdir(path.join(root, 'legacy'));
    await writeFile(path.join(root, 'legacy', 'state.json'), JSON.stringify({ sessionId: 's', wsEndpoint: 'ws://x' }));
    await mkdir(path.join(root, 'new'));
    await writeFile(
      path.join(root, 'new', 'state.json'),
      JSON.stringify({ sessionId: 's2', wsEndpoint: 'ws://y', createdAt: new Date().toISOString() }),
    );
    const scanned = await scanStateFiles(root, '/nope');
    const legacy = scanned.find((s) => s.stateFile.includes('legacy'))!;
    const fresh = scanned.find((s) => s.stateFile.includes('new'))!;
    expect(legacy.ageSource).toBe('stateFileMtime');
    expect(fresh.ageSource).toBe('createdAt');
  });
});
