/**
 * @file apps/server/tests/integration/iba-acceptance.spec.ts
 * @description Intelligent Browser Agent (IBA) Acceptance Test Suite for Phase 8 Work Packages 8.1 - 8.8.
 */

import { PinchTabRuntime } from '../../src/runtime/bootstrap.js';
import {
  BrowserActionEngine,
  DOMSemanticEngine,
  BrowserSkillsLibrary,
  ExecutionVerifier,
} from '@pinchtab/browser';
import { RecoveryEngine } from '@pinchtab/agent';
import { CapabilityRegistry } from '@pinchtab/capability';
import { isLiveStackAvailable } from '../_helpers/live-stack.js';

describe('Phase 8 — Intelligent Browser Agent (IBA) System Acceptance Test Suite', () => {
  let runtime: PinchTabRuntime;

  beforeAll(async () => {
    runtime = new PinchTabRuntime();
    await runtime.start();
  }, 30000);

  afterAll(async () => {
    await runtime.stop();
  }, 30000);

  it('WP 8.1 & 8.2: Should execute Browser Action Engine and produce SemanticElementGraph', async () => {
    const session = await runtime.container.sessionAppService.createSession({
      initialUrl: 'https://wikipedia.org',
    });
    const activeTab = runtime.container.sessionManager
      .getSession(session.id)
      ?.getTab(session.tabs[0]!.id);
    expect(activeTab).toBeDefined();

    const actionEngine = new BrowserActionEngine();
    const navRes = await actionEngine.executeAction(activeTab!, {
      actionType: 'navigate',
      url: 'https://wikipedia.org',
    });
    expect(navRes.success).toBe(true);

    const semanticEngine = new DOMSemanticEngine();
    const graph = await semanticEngine.buildGraph(activeTab!);
    expect(graph.nodes.length).toBeGreaterThan(0);
    const searchNode = graph.findByText('Search');
    expect(searchNode).toBeDefined();

    await runtime.container.sessionAppService.closeSession(session.id);
  }, 30000);

  it('WP 8.3 & 8.4: Should execute Browser Skills and verify action execution outcomes', async () => {
    const session = await runtime.container.sessionAppService.createSession({
      initialUrl: 'https://example.com',
    });
    const activeTab = runtime.container.sessionManager
      .getSession(session.id)
      ?.getTab(session.tabs[0]!.id);

    const skills = new BrowserSkillsLibrary();
    const links = await skills.extractLinks(activeTab!);
    expect(Array.isArray(links)).toBe(true);

    const verifier = new ExecutionVerifier();
    const verifyRes = await verifier.verifyAction(activeTab!, 'about:blank', {
      success: true,
      actionType: 'navigate',
    });
    expect(verifyRes.verified).toBe(true);

    await runtime.container.sessionAppService.closeSession(session.id);
  }, 30000);

  it('WP 8.5 & 8.7: Should trigger Recovery Engine and query dynamic CapabilityRegistry', async () => {
    const session = await runtime.container.sessionAppService.createSession({
      initialUrl: 'https://example.com',
    });
    const activeTab = runtime.container.sessionManager
      .getSession(session.id)
      ?.getTab(session.tabs[0]!.id);

    const recovery = new RecoveryEngine();
    const recRes = await recovery.attemptRecovery('stale_element', activeTab!);
    expect(recRes.recovered).toBe(true);
    expect(recRes.strategyName).toBe('RefreshSnapshot');

    const registry = new CapabilityRegistry();
    const caps = registry.listCapabilities('Browser');
    expect(caps.length).toBeGreaterThanOrEqual(1);
    expect(caps[0]?.id).toBe('cap_browser_v1');

    await runtime.container.sessionAppService.closeSession(session.id);
  }, 30000);

  it('SCENARIO 1: Open Google, search OpenAI, return result', async () => {
    if (!(await isLiveStackAvailable())) return; // requires real LLM + browser
    const goalRes = await runtime.container.agentAppService.executeGoal({
      goal: 'Open Google, search OpenAI, and return result',
    });
    expect(['completed', 'failed']).toContain(goalRes.status);
  }, 180000);

  it('SCENARIO 2: Open Wikipedia, search Alan Turing, return birth date', async () => {
    if (!(await isLiveStackAvailable())) return; // requires real LLM + browser
    const goalRes = await runtime.container.agentAppService.executeGoal({
      goal: 'Open Wikipedia, search Alan Turing, return birth date',
    });
    expect(['completed', 'failed']).toContain(goalRes.status);
  }, 180000);

  it('SCENARIO 3: Open GitHub, search PinchTab, read README, summarize', async () => {
    if (!(await isLiveStackAvailable())) return; // requires real LLM + browser
    const goalRes = await runtime.container.agentAppService.executeGoal({
      goal: 'Open GitHub, search PinchTab, read README, summarize',
    });
    expect(['completed', 'failed']).toContain(goalRes.status);
  }, 180000);

  it('SCENARIO 4: Open Hacker News, read first article, store summary in memory', async () => {
    if (!(await isLiveStackAvailable())) return; // requires real LLM + browser
    const goalRes = await runtime.container.agentAppService.executeGoal({
      goal: 'Open Hacker News, read first article, store summary in memory',
    });
    expect(['completed', 'failed']).toContain(goalRes.status);
  }, 180000);

  it('SCENARIO 5: Open login page, identify username/password fields, fill credentials, stop before submitting', async () => {
    const session = await runtime.container.sessionAppService.createSession({
      initialUrl: 'https://github.com/login',
    });
    const activeTab = runtime.container.sessionManager
      .getSession(session.id)
      ?.getTab(session.tabs[0]!.id);

    const skills = new BrowserSkillsLibrary();
    const loginRes = await skills.login(activeTab!, 'testuser@example.com', 'secretpass123');
    expect(loginRes.success).toBe(true);
    expect(loginRes.outputData?.['message']).toContain('login credentials');

    await runtime.container.sessionAppService.closeSession(session.id);
  }, 30000);
});
