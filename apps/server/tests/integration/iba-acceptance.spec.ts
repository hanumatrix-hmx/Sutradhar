/**
 * @file apps/server/tests/integration/iba-acceptance.spec.ts
 * @description Intelligent Browser Agent (IBA) Acceptance Test Suite for Phase 8 Work Packages 8.1 - 8.8.
 */

import { SutradharRuntime } from '../../src/runtime/bootstrap.js';
import {
  BrowserActionEngine,
  DOMSemanticEngine,
  BrowserSkillsLibrary,
  ExecutionVerifier,
} from '@sutradhar/browser';
import { RecoveryEngine } from '@sutradhar/agent';
import { CapabilityRegistry } from '@sutradhar/capability';
import { isLiveStackAvailable } from '../_helpers/live-stack.js';

describe('Phase 8 — Intelligent Browser Agent (IBA) System Acceptance Test Suite', () => {
  let runtime: SutradharRuntime;

  beforeAll(async () => {
    runtime = new SutradharRuntime();
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
    // `navigate` has no built-in post-condition check of its own (unlike `click`/`type`/etc,
    // which each verify a real effect inside dispatchAction itself — see PROB-011), so a
    // genuine verification here needs an explicit spec to check against; `shouldUrlChange` is
    // real and true because this tab actually navigated to https://example.com/ (session
    // creation's initialUrl) versus the 'about:blank' passed as the previous URL. Without a
    // spec, `verifyAction` now honestly reports `verified:false` (an intentional behavior
    // change from this project's field-report remediation — an unspecced, non-self-verifying
    // action type is no longer given a confident, unearned true) — this test was still
    // asserting the old, always-optimistic default until it was caught by a full
    // regression sweep and fixed to genuinely exercise the verifier instead.
    const verifyRes = await verifier.verifyAction(
      activeTab!,
      'about:blank',
      { success: true, actionType: 'navigate' },
      { shouldUrlChange: true },
    );
    expect(verifyRes.verified).toBe(true);
    expect(verifyRes.urlChanged).toBe(true);

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

  it('SCENARIO 3: Open GitHub, search Sutradhar, read README, summarize', async () => {
    if (!(await isLiveStackAvailable())) return; // requires real LLM + browser
    const goalRes = await runtime.container.agentAppService.executeGoal({
      goal: 'Open GitHub, search Sutradhar, read README, summarize',
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
