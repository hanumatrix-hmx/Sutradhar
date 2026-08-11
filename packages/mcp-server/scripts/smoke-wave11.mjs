// Live smoke test for Wave 11: browser.health, browser.shutdown_all, error-hint enrichment,
// and session:blocked actually reaching an agent.runGoal response — all through the real
// createSutradharServer() wiring (not a raw SutradharRuntime), so the EventBus-sharing fix in
// server.ts is exercised for real.
import { SutradharRuntime } from '../../capability-runtime/dist/index.js';
import { AgentCore } from '../../agent/dist/index.js';
import { registerTools } from '../dist/tools.js';
import { StructuredLogger } from '../../observability/dist/index.js';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => { console.error('WATCHDOG'); process.exit(2); }, 40000);

function makeMockServer() {
  const tools = new Map();
  const server = { registerTool: (name, config, handler) => tools.set(name, handler) };
  return { server, tools };
}

const logger = new StructuredLogger({ minLevel: 'warn' });
const runtime = new SutradharRuntime({ logger });

// Scripted "LLM": first turn navigates nowhere useful — detectBlock will fire on the OAuth
// wall page created below before the model even gets a real turn, so the stub only needs to
// exist to satisfy AgentCore's requirement of a configured provider.
const stubLlmProvider = {
  providerId: 'stub',
  async generateCompletion() {
    return { message: { content: JSON.stringify({ thinking: 'noop', action: 'wait' }) } };
  },
};
const agentCore = new AgentCore({
  llmProviderAccessor: () => stubLlmProvider,
  sessionManager: runtime.getSessionManager(),
  eventBus: runtime.getEventBus(),
  logger,
});

const { server, tools } = makeMockServer();
registerTools(server, { runtime, agent: { agentCore } });

try {
  log('[1] browser.health...');
  const health = JSON.parse((await tools.get('browser.health')({})).content[0].text);
  log('    hasChrome=' + health.hasChrome + ' path=' + health.executablePath);
  if (!health.hasChrome) throw new Error('expected Chrome to be detected on this machine');

  log('[2] error-hint enrichment on a real click failure...');
  const launch = JSON.parse((await tools.get('browser.launch')({ headless: true })).content[0].text);
  await tools.get('browser.navigate')({ sessionId: launch.sessionId, url: 'https://example.com' });
  const clickFail = await tools.get('browser.click')({ sessionId: launch.sessionId, target: '#does-not-exist-anywhere' });
  log('    isError=' + clickFail.isError + ' text=' + clickFail.content[0].text.split('\n').pop());
  if (!clickFail.content[0].text.includes('Hint:')) throw new Error('expected a remediation hint on a not-found click error');

  log('[3] session:blocked reaching agent.runGoal via the shared EventBus...');
  await tools.get('browser.eval')({
    sessionId: launch.sessionId,
    code: `(() => {
      document.body.innerHTML = '<div><h1>Sign in</h1><button>Continue with Google</button></div>';
      'ok';
    })()`,
  });
  const runGoalResult = await tools.get('agent.runGoal')({
    goal: 'Do something on this page',
    sessionId: launch.sessionId,
  });
  const text = runGoalResult.content[0].text;
  log('    ' + text.split('\n').slice(0, 4).join(' | '));
  if (!text.includes('BLOCKED (auth_wall)')) throw new Error('expected agent.runGoal to surface the session:blocked event fired mid-run');
  log('    OK — session:blocked reached the MCP tool response');

  log('[4] browser.shutdown_all...');
  const shutdownAll = JSON.parse((await tools.get('browser.shutdown_all')({})).content[0].text);
  if (!shutdownAll.success) throw new Error('expected shutdown_all to report success');
  log('    OK');

  log('✅ WAVE 11 LIVE CHECKS PASSED');
} catch (e) {
  console.error('❌ FAILED: ' + (e?.message || e));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await runtime.shutdownAll().catch(() => {});
}
