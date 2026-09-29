// Child process for revert-confirm-gap262.mjs: runs the noisy-interval + clean-delayed(150ms)
// repeat measurement against whatever is CURRENTLY built in packages/capability-runtime/dist --
// run as its own fresh process each time so there is no possibility of a stale ESM module cache
// masking a rebuild (see the parent script's comment on why a same-process dynamic import isn't
// reliable here).
//
// Hardened after a real failure found running this on a shared, heavily-loaded machine (135+
// pre-existing Chrome processes): a freshly-launched browser's FIRST navigation sometimes hangs
// for the full 30s Puppeteer navigation timeout, consistently across every retry against that
// SAME browser instance -- not a transient single-navigation blip, but that one launched Chrome
// instance never becoming responsive (most likely its renderer process starved for CPU/handles
// right after a heavy `tsc` build). Retrying the navigate call alone doesn't help when the
// browser ITSELF is the broken part -- this now retries the whole launch, with a cheap liveness
// probe (a trivial eval) right after launch to catch a broken instance before spending 30s+
// finding out via a real navigation.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const [, , origin, label, repeatsArg] = process.argv;
const repeats = Number(repeatsArg);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)),
  ]);
}

async function launchHealthyRuntime() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const runtime = new SutradharRuntime({});
    try {
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      // Cheap liveness probe -- catches a broken/unresponsive renderer in ~seconds instead of
      // discovering it only after a real navigation times out at 30s.
      await withTimeout(runtime.eval(sessionId, '1+1'), 8000, 'post-launch liveness probe');
      return { runtime, sessionId };
    } catch (e) {
      process.stderr.write(`[child] launch attempt ${attempt} unhealthy: ${e.message} -- discarding and relaunching\n`);
      await runtime.shutdownAll().catch(() => {});
      await delay(500 * (attempt + 1));
    }
  }
  throw new Error('could not obtain a healthy browser after 3 launch attempts');
}

const { runtime, sessionId } = await launchHealthyRuntime();

// The parent enforces a hard wall-clock ceiling on this whole child via execFileSync's own
// `timeout` (SIGTERM) -- but SIGTERM alone would leave the real Chrome process this launched
// orphaned (Node's default SIGTERM handling just exits the process, it doesn't run our `finally`
// block first). Handle it explicitly so a forced kill still closes the browser it spawned,
// honoring the "never leak a headless Chrome" process-hygiene rule even on the timeout path.
let shuttingDown = false;
process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  runtime
    .shutdownAll()
    .catch(() => {})
    .finally(() => process.exit(1));
});

const leaks = [];
try {
  for (let i = 0; i < repeats; i++) {
    // This shared machine can be under real resource contention from other concurrent sessions
    // (many real Chrome instances -- see this evidence dir's process-baseline.txt) -- a transient
    // navigation timeout here is a machine-load artifact, not a repro of GAP-262 itself. One
    // retry against the SAME (already health-checked) browser instance is enough; the launch-time
    // health check above is what actually catches a genuinely broken instance.
    let lastErr;
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        if (attempt > 0) await delay(1000);
        await runtime.navigate(sessionId, `${origin}/noisy-interval?n=${label}-${i}-a${attempt}`);
        await delay(80);
        const a = await runtime.audit(sessionId, { url: `${origin}/clean-delayed?n=${label}-${i}-a${attempt}&delayMs=150` });
        const leaked = a.consoleErrors.length > 0 || a.pageErrors.length > 0 || a.brokenRequests.length > 0;
        if (leaked) {
          leaks.push({ i, consoleErrors: a.consoleErrors.map((e) => e.text), broken: a.brokenRequests.map((b) => b.url) });
        }
        ok = true;
      } catch (e) {
        lastErr = e;
        process.stderr.write(`[child] repeat ${i} attempt ${attempt} failed: ${e.message}\n`);
      }
    }
    if (!ok) throw lastErr;
  }
} finally {
  await runtime.shutdownAll().catch(() => {});
}
console.log(JSON.stringify(leaks));
