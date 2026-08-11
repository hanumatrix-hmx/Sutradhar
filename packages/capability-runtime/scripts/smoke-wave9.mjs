// Live smoke test for Wave 9: Chrome crash detection, per-tab concurrency serialization, and
// the idle-session reaper — all against real Chrome.
import { PinchTabRuntime } from '../dist/index.js';
import { execSync } from 'node:child_process';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => { console.error('WATCHDOG'); process.exit(2); }, 60000);

async function testConcurrency() {
  const runtime = new PinchTabRuntime();
  const { sessionId } = await runtime.launch({ headless: true });
  try {
    await runtime.navigate(sessionId, 'https://example.com');
    log('[1] firing two concurrent scroll actions against the same tab...');
    const [a, b] = await Promise.all([
      runtime.click(sessionId, 'h1'), // exists on example.com
      runtime.scroll(sessionId, 'down', 100),
    ]);
    log('    a.success=' + a.success + ' b.success=' + b.success);
    if (!a.success || !b.success) throw new Error('expected both concurrent actions to succeed (serialized, not interleaved-broken)');
    log('    OK — concurrent actions against one tab both completed cleanly');
  } finally {
    await runtime.shutdown(sessionId).catch(() => {});
  }
}

async function testCrashDetection() {
  const runtime = new PinchTabRuntime();
  const { sessionId } = await runtime.launch({ headless: true });
  const mgr = runtime.getSessionManager();
  const session = mgr.getSession(sessionId);
  const tab = session.getTabs()[0];
  const pid = tab?.page?.browser()?.process()?.pid;
  log('[2] launched Chrome pid=' + pid);
  if (!pid) throw new Error('could not obtain the launched Chrome process pid');

  log('    killing the Chrome process externally to simulate a real crash...');
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
  }

  // Give the 'disconnected' event a moment to propagate through BrowserSession -> EventBus -> manager.
  await new Promise((r) => setTimeout(r, 1500));

  const stillThere = mgr.getSession(sessionId);
  log('    session still tracked after crash: ' + !!stillThere);
  if (stillThere) throw new Error('expected the crashed session to be dropped from the session manager');
  log('    OK — crashed session was detected and dropped');
}

async function testIdleReaper() {
  const runtime = new PinchTabRuntime({ idleTimeoutMs: 1000 });
  const { sessionId } = await runtime.launch({ headless: true });
  log('[3] session launched with idleTimeoutMs=1000, waiting for the reaper...');
  await new Promise((r) => setTimeout(r, 2500));
  const gone = !runtime.getSessionManager().getSession(sessionId);
  log('    session reaped: ' + gone);
  if (!gone) throw new Error('expected the idle session to be reaped after 2.5s with a 1s idle timeout');
  log('    OK — idle session was auto-closed');
  await runtime.shutdownAll();
}

try {
  await testConcurrency();
  await testCrashDetection();
  await testIdleReaper();
  log('✅ WAVE 9 LIVE CHECKS PASSED');
} catch (e) {
  console.error('❌ FAILED: ' + (e?.message || e));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
}
