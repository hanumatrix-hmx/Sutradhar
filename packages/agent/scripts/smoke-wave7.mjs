// Live smoke test for Wave 7's in-loop wiring: forces a real action failure via a scripted
// stub LLM provider, so RecoveryEngine.attemptRecovery and ReflectionEngine.evaluateStep are
// exercised inside the actual runAgentLoop code path (not just the standalone engines, which
// the unit tests already cover) against a real browser tab.
// Run directly: node packages/agent/scripts/smoke-wave7.mjs
import { runAgentLoop } from '../dist/core/agent-loop.js';
import { BrowserSessionManager, BrowserLauncher } from '../../browser/dist/index.js';
import { StructuredLogger } from '../../observability/dist/index.js';
import { createAgentId } from '../../contracts/dist/index.js';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: exceeded 60s — hanging. Forcing exit.');
  process.exit(2);
}, 60000);

// A scripted "LLM" that never actually calls anywhere: first turn clicks a selector that does
// not exist (forces a real BrowserActionEngine failure -> classifyFailure -> RecoveryEngine),
// then claims done. Exercises the real failure + recovery + verification code paths.
// The loop uses the SAME provider for both step-reasoning and goal-completion verification
// (distinguished by the verifier's own system prompt), so the stub must tell them apart.
let mainTurn = 0;
const stubLlmProvider = {
  providerId: 'stub-scripted',
  async generateCompletion(params) {
    const isVerificationCall = params.messages.some(
      (m) => m.role === 'system' && m.content.includes('strict verifier'),
    );
    if (isVerificationCall) {
      return { message: { content: JSON.stringify({ satisfied: true, reason: 'plausible given the goal' }) } };
    }

    mainTurn++;
    if (mainTurn === 1) {
      return { message: { content: JSON.stringify({ thinking: 'try a bad selector', action: 'click', nodeId: 999999 }) } };
    }
    return {
      message: {
        content: JSON.stringify({
          thinking: 'giving up after the failure',
          action: 'done',
          extracted: 'n/a',
          summary: 'Attempted a click on a nonexistent element to exercise recovery.',
        }),
      },
    };
  },
};

const logger = new StructuredLogger({ minLevel: 'warn' });
const launcher = new BrowserLauncher(logger);
const sessionManager = new BrowserSessionManager(launcher, undefined, logger);

try {
  log('[1] runAgentLoop with a forced action failure ...');
  const result = await runAgentLoop({
    agentId: createAgentId('wave7_smoke_agent'),
    objective: 'Smoke test: force a failing click to exercise RecoveryEngine/ReflectionEngine wiring.',
    llmProvider: stubLlmProvider,
    sessionManager,
    initialUrl: 'https://example.com',
    maxSteps: 5,
    logger,
  });

  log('    status=' + result.status + ' steps=' + result.steps.length);
  for (const step of result.steps) {
    log(`    [${step.stepNumber}] ${step.actionName} success=${step.success} — ${step.observation.slice(0, 160)}`);
  }

  const failedStep = result.steps.find((s) => s.actionName === 'click' && !s.success);
  if (!failedStep) throw new Error('expected a failed click step');
  if (!failedStep.observation.includes('Recovery (')) {
    throw new Error('expected the failed step observation to include a Recovery(...) note from RecoveryEngine wiring');
  }
  log('    ✓ RecoveryEngine wiring confirmed: ' + failedStep.observation);

  if (result.status !== 'completed') throw new Error('expected the run to complete via the done branch');
  log('    ✓ goal-completion verification did not block a plausible done claim');

  log('✅ ALL WAVE 7 IN-LOOP CHECKS PASSED');
} catch (e) {
  console.error('\n❌ WAVE 7 SMOKE TEST FAILED: ' + (e?.message || e));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await sessionManager.closeAllSessions().catch(() => {});
}
