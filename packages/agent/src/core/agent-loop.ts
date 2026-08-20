/**
 * @file packages/agent/src/core/agent-loop.ts
 * @description A genuine observe→reason→act→verify agent loop.
 *
 * This is the real intelligence layer of Sutradhar. It does NOT script goals to
 * URLs. Instead it:
 *   1. Renders the live page (DOM semantic graph) into a compact observation.
 *   2. Asks a REAL LLM to choose one action as strict JSON.
 *   3. Executes that action against a REAL browser via BrowserActionEngine.
 *   4. Feeds the resulting page state back to the LLM and repeats.
 *   5. Stops when the model emits "done" (returning extracted data) or the
 *      step budget is exhausted.
 *
 * Every action is real. Every observation comes from the live DOM. If the LLM
 * is unreachable, the browser isn't launched, or an action fails, the loop
 * surfaces the error rather than fabricating success.
 */

import {
  AgentId,
  GoalId,
  createGoalId,
  createStepId,
  createTaskId,
  createModelId,
  createSessionId,
  AgentGoalDto,
  AgentStepDto,
} from '@sutradhar/contracts';
import { EventBus } from '@sutradhar/events';
import { StructuredLogger } from '@sutradhar/observability';
import { ILlmProvider } from '@sutradhar/llm';
import {
  BrowserSessionManager,
  BrowserActionEngine,
  DOMSemanticEngine,
  formatGraphForLlm,
  selectorForNodeId,
} from '@sutradhar/browser';
import type { ActionParams, IBrowserTab } from '@sutradhar/browser';
import { AGENT_SYSTEM_PROMPT, AgentAction, parseAgentAction } from './agent-prompt.js';
import { ReflectionEngine } from '../executor/reflection-engine.js';
import { RecoveryEngine } from '../recovery/recovery-engine.js';
import { classifyFailure } from './failure-classifier.js';
import { detectBlock } from './block-detector.js';
import { CrossRunMemory } from './cross-run-memory.js';

/** A captured real execution of one agent turn — included in the returned trace. */
export interface AgentLoopStep extends AgentStepDto {
  readonly success: boolean;
  readonly errorMessage?: string;
}

export interface AgentLoopResult {
  readonly goalId: GoalId;
  readonly agentId: AgentId;
  readonly objective: string;
  readonly status: AgentGoalDto['status'];
  /** The final answer the agent extracted, if any. */
  readonly answer?: string;
  readonly summary?: string;
  readonly steps: readonly AgentLoopStep[];
  readonly createdAt: string;
  /** Real elapsed wall-clock time in ms. */
  readonly durationMs: number;
}

export interface AgentLoopOptions {
  readonly agentId: AgentId;
  readonly goalId?: GoalId;
  readonly objective: string;
  readonly llmProvider: ILlmProvider;
  readonly sessionManager: BrowserSessionManager;
  /** Initial URL; if omitted, the loop navigates to a search engine with the goal. */
  readonly initialUrl?: string;
  /**
   * Caller-owned browser session id (e.g. the UI session). When provided and
   * live, the loop drives THAT session so the user's viewport shows exactly
   * what the agent does. The loop only closes sessions it created itself.
   */
  readonly sessionId?: string;
  readonly maxSteps?: number;
  /** Max tokens per LLM turn. Generous default because reasoning models emit <think> blocks. */
  readonly maxTokensPerTurn?: number;
  readonly eventBus?: EventBus;
  readonly logger?: StructuredLogger;
  /** Optional sink invoked once per turn with a human-readable line (for live demos). */
  readonly onTurn?: (line: string) => void;
  /** External cancellation. Honored at step boundaries — an in-flight LLM call
   *  or action finishes first; the loop never starts another step after abort. */
  readonly signal?: AbortSignal;
  /** Real-time step sink — invoked with the actual step the loop just ran
   *  (never synthesized). Used by the server to stream live progress over SSE. */
  readonly onStep?: (step: AgentLoopStep) => void;
}

const DEFAULT_MAX_STEPS = 15;
const DEFAULT_MAX_TOKENS = 512;
/** Independent cap on automated recovery attempts per run — bounds the extra DOM-rebuild/
 *  click-retry work RecoveryEngine does when a page fails every action, separate from the
 *  step budget (which alone doesn't stop each failed step from also paying recovery's cost). */
const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Runs the agent loop end-to-end against a live browser and a real LLM.
 * Returns a truthful result including every real step taken.
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const logger = opts.logger ?? new StructuredLogger({ minLevel: 'info' });
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxTokens = opts.maxTokensPerTurn ?? DEFAULT_MAX_TOKENS;
  const goalId = opts.goalId ?? createGoalId(`goal_${Date.now()}`);
  const startedAt = Date.now();
  const createdAt = new Date(startedAt).toISOString();

  const actionEngine = new BrowserActionEngine(opts.eventBus, logger);
  const semanticEngine = new DOMSemanticEngine();
  const reflectionEngine = new ReflectionEngine(logger);
  const recoveryEngine = new RecoveryEngine(actionEngine, semanticEngine, logger);
  const crossRunMemory = new CrossRunMemory({ logger });

  const steps: AgentLoopStep[] = [];
  let answer: string | undefined;
  let summary: string | undefined;
  let status: AgentGoalDto['status'] = 'executing';
  let recoveryAttempts = 0;

  opts.onTurn?.(`Goal: ${opts.objective}`);
  logger.info('[AgentLoop] starting', { agentId: opts.agentId, goalId, objective: opts.objective });

  /** Live progress fan-out: the real step goes to the caller (SSE streaming)
   *  and to the domain event bus (persisted history). Never synthesized. */
  const emitStep = (step: AgentLoopStep): void => {
    opts.onStep?.(step);
    void opts.eventBus?.publish(
      'agent:step:executed',
      {
        agentId: opts.agentId,
        taskId: createTaskId(goalId),
        stepId: createStepId(`${goalId}_step_${step.stepNumber}`),
        action: step.actionName,
        result: step.observation,
        success: step.success,
      },
      `corr_${goalId}`,
    );
  };

  // 1. Obtain a live browser session + active tab. Fail loud — never fake.
  // Prefer the caller's session (UI viewport) so agent and user share one
  // browser; only fall back to a fresh session when none was given/live.
  let callerSession;
  let ownsSession;
  let session;
  let tab;
  try {
    callerSession = opts.sessionId
      ? opts.sessionManager.getSession(createSessionId(opts.sessionId))
      : undefined;
    ownsSession = !callerSession;
    session =
      callerSession ??
      (await opts.sessionManager.createSession({
        initialUrl: opts.initialUrl,
        ...(opts.sessionId ? { sessionId: createSessionId(opts.sessionId) } : {}),
      }));
    const tabs = session.getTabs();
    tab = tabs.find((t) => t.isActive) ?? tabs[0];
    if (!tab) {
      tab = await session.createTab(opts.initialUrl ?? 'about:blank');
    }
    if (!tab.page) {
      throw new Error(
        '[AgentLoop] browser tab has no real Page — Chrome was not launched. ' +
          'Ensure a Chrome/Edge executable is available (set CHROME_PATH if needed).',
      );
    }
  } catch (err) {
    // A startup failure here (bad initial URL, no Chrome, session creation error) would
    // otherwise vanish without a trace — the run never reaches the recordRun() call at the
    // bottom of this function. Persist it as a failed run so a future related goal's
    // getRelevantRuns() lookup surfaces "this kind of goal has failed to even start before".
    await crossRunMemory
      .recordRun({
        goalId,
        objective: opts.objective,
        status: 'failed',
        summary: `Failed to start: ${(err as Error).message}`,
        stepCount: 0,
        timestamp: createdAt,
      })
      .catch(() => {});
    // This catch's own scope ends before the main loop's try/finally (which normally closes
    // an owned session) is ever reached — without this, a session the loop itself created
    // (e.g. `createSession` succeeded but the resulting tab had no live Page) leaks its
    // browser process on every failure of this kind, since nothing else will ever close it.
    if (ownsSession && session) {
      await opts.sessionManager.closeSession(session.id, 'agent loop failed to start').catch(() => {});
    }
    throw err;
  }

  void opts.eventBus?.publish(
    'agent:goal:started',
    { agentId: opts.agentId, goalId, goal: opts.objective },
    `corr_${goalId}`,
  );

  // Rolling history of recent turns shown back to the model (bounded to control tokens).
  const turnLog: string[] = [];

  // Surface prior related runs (if any) so the model doesn't repeat past mistakes —
  // best-effort; a memory-lookup failure never blocks a run from starting.
  const relevantRuns = await crossRunMemory.getRelevantRuns(opts.objective).catch(() => []);
  const memoryContext = relevantRuns.length
    ? relevantRuns
        .map((r) => `- (${r.status}) "${r.objective}" → ${r.summary ?? r.answer ?? '(no summary)'}`)
        .join('\n')
    : undefined;

  /** How many recent steps `reflectAndMaybeStop` scans for a repeat of the current step —
   *  matches `turnLog`'s own rolling window. Scoping to *recent* steps (not the entire run)
   *  matters: a long run that legitimately repeats an action far apart (e.g. clicking "Next
   *  page" three times over 15 steps, with real progress in between) shouldn't false-positive
   *  as stuck just because the exact same action+outcome pair occurred earlier in the run. */
  const REFLECTION_WINDOW = 6;

  /** After pushing a step, ask ReflectionEngine whether the loop is stuck repeating the
   *  same action with the same outcome. If so, stop now rather than burning the rest of
   *  the step budget, and tell any listener (e.g. a UI banner) via `session:blocked`. */
  const reflectAndMaybeStop = (): boolean => {
    const last = steps[steps.length - 1]!;
    const recentHistory = steps.slice(-(REFLECTION_WINDOW + 1), -1);
    const reflection = reflectionEngine.evaluateStep(last, recentHistory);
    if (reflection.isStuck) {
      status = 'failed';
      summary = `Stuck: ${reflection.feedback}`;
      void opts.eventBus?.publish(
        'session:blocked',
        { sessionId: session.id, agentId: opts.agentId, goalId, blockReason: 'stuck', message: reflection.feedback },
        `corr_${goalId}`,
      );
      return true;
    }
    return false;
  };

  try {
    for (let stepNum = 1; stepNum <= maxSteps; stepNum++) {
      // Cancellation is honored between steps: whatever is in flight finishes,
      // but the loop never starts another step after the user pressed Stop.
      if (opts.signal?.aborted) {
        status = 'cancelled';
        summary = 'Run cancelled by user.';
        break;
      }

      // --- Observe: build a fresh DOM graph with stamped node ids ---
      const graph = await semanticEngine.buildGraph(tab);
      const pageText = await extractVisibleText(tab);
      const observation = `${formatGraphForLlm(graph)}\n\n# Visible page text (excerpt)\n${pageText}`;

      // A CAPTCHA or login wall is something only a human can resolve — stop immediately
      // rather than let the model burn its step budget clicking around a page it can
      // never get past, and signal it so a UI can surface a "needs human" banner.
      const blockReason = await detectBlock(tab);
      if (blockReason) {
        const message =
          blockReason === 'captcha'
            ? 'CAPTCHA detected on the page — this requires human intervention.'
            : 'A login/auth wall was detected — this requires human intervention.';
        opts.onTurn?.(`  step ${stepNum}: ⚠ ${message}`);
        status = 'failed';
        summary = message;
        void opts.eventBus?.publish(
          'session:blocked',
          { sessionId: session.id, agentId: opts.agentId, goalId, blockReason, message },
          `corr_${goalId}`,
        );
        break;
      }

      // --- Reason: ask the LLM for exactly one action ---
      const userMessage = buildUserMessage(opts.objective, observation, turnLog, stepNum, memoryContext);

      let action: AgentAction | null = null;
      let rawResponse = '';
      let llmError: string | undefined;
      try {
        const completion = await opts.llmProvider.generateCompletion({
          modelId: createModelId(opts.llmProvider.providerId), // adapter uses its defaultModel when modelId is unknown
          messages: [
            { role: 'system', content: AGENT_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2,
          maxTokens,
        });
        rawResponse = completion.message.content;
        action = parseAgentAction(rawResponse);
      } catch (err) {
        // A user cancel aborts the in-flight LLM call — that is a clean
        // cancellation, not a model failure.
        if (opts.signal?.aborted) break;
        llmError = (err as Error).message;
      }

      if (!action) {
        // Could not get a valid action. Record honestly and let the same stuck-loop
        // detector every other step goes through decide whether to give up — routes this
        // branch through the shared check instead of a separate, weaker ad-hoc one, so a
        // model alternating between "wrong action" and "unparseable response" every other
        // turn is still caught (and still fires `session:blocked`) instead of silently
        // burning the whole step budget.
        const reasoning = llmError
          ? `LLM error: ${llmError}`
          : `Unparseable model response: ${rawResponse.slice(0, 200)}`;
        opts.onTurn?.(`  step ${stepNum}: ✗ ${reasoning}`);
        steps.push(makeStep(stepNum, reasoning, 'none', {}, reasoning, false, llmError));
        emitStep(steps[steps.length - 1]!);
        if (reflectAndMaybeStop()) break;
        turnLog.push(`Step ${stepNum}: ERROR (${reasoning}).`);
        continue;
      }

      opts.onTurn?.(
        `  step ${stepNum}: ${action.thinking ?? ''} → ${describeAction(action)}`,
      );

      // --- Act: map the action to the real BrowserActionEngine ---
      const params = mapActionToParams(action, session.id);
      let result;
      let observation2 = '';
      let success = true;
      let errorMessage: string | undefined;

      if (action.action === 'done') {
        // Don't accept the model's self-reported completion at face value — run one
        // lightweight independent check first. This is a second opinion, not a hard
        // gate: if verification itself errors out, completion still proceeds (the
        // model's report remains the primary signal).
        const verification = await verifyGoalCompletion(
          opts.objective,
          action.extracted,
          action.summary,
          opts.llmProvider,
        );

        if (!verification.satisfied) {
          opts.onTurn?.(`  step ${stepNum}: verification disagreed — ${verification.reason}`);
          steps.push(
            makeStep(
              stepNum,
              action.thinking ?? 'Claimed done',
              'done_rejected',
              { extracted: action.extracted ?? '', summary: action.summary ?? '' },
              `Verification rejected this completion claim: ${verification.reason}`,
              false,
            ),
          );
          emitStep(steps[steps.length - 1]!);
          if (reflectAndMaybeStop()) break;
          turnLog.push(
            `Step ${stepNum}: DONE claim REJECTED by verification (${verification.reason}). Keep working toward the goal.`,
          );
          continue;
        }

        answer = action.extracted;
        summary = action.summary;
        steps.push(
          makeStep(
            stepNum,
            action.thinking ?? 'Goal complete',
            'done',
            { extracted: action.extracted ?? '', summary: action.summary ?? '' },
            `Done. ${action.summary ?? action.extracted ?? ''}`,
            true,
          ),
        );
        turnLog.push(`Step ${stepNum}: DONE — ${action.extracted ?? ''}`);
        emitStep(steps[steps.length - 1]!);
        status = 'completed';
        break;
      }

      try {
        result = await actionEngine.executeAction(tab, params);
        success = result.success;
        if (!result.success) errorMessage = result.error;
        // For type actions, follow up by pressing Enter if the model asked to search.
        if (success && action.action === 'type' && action.text) {
          // Small wait for the page to react; the verifier/snapshot will catch the result.
          await sleep(250);
        }
        observation2 = success
          ? `URL now ${result.currentUrl ?? tab.url}. ${result.outputData ? JSON.stringify(result.outputData).slice(0, 120) : ''}`
          : `FAILED: ${result.error ?? 'unknown error'}`;
      } catch (err) {
        // A user cancel can abort mid-action too — keep the record honest.
        if (opts.signal?.aborted) break;
        success = false;
        errorMessage = (err as Error).message;
        observation2 = `EXCEPTION: ${errorMessage}`;
      }

      // A failed action gets one automated recovery attempt before the loop just moves on
      // and hopes the next model turn figures it out — e.g. dismissing a blocking popup or
      // refreshing a stale DOM snapshot, which the model itself has no direct tool for.
      // Bounded independently of the step budget: a page that fails every action (e.g. a
      // permanently occluded overlay) shouldn't get a full extra recovery attempt — DOM
      // rebuild + a possible click_by_text — on every single one of maxSteps steps.
      if (!success && recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
        recoveryAttempts++;
        const failureReason = classifyFailure(errorMessage);
        try {
          const recovery = await recoveryEngine.attemptRecovery(failureReason, tab);
          observation2 += ` | Recovery (${failureReason}): ${recovery.recovered ? 'succeeded' : 'no effect'} — ${recovery.message}`;

          // 'browser_crash' is the one reason RecoveryEngine can't fix itself — it always
          // reports `recovered:false` with "session restart required" and stops there. Act
          // on that here: open a fresh tab in the same session and keep going, rather than
          // leaving the loop to keep hammering a dead Page for every remaining step.
          if (recovery.strategyName === 'RestartSessionRequired') {
            try {
              tab = await session.createTab(tab.url);
              observation2 += ' | Opened a fresh tab to recover from the crash.';
            } catch (restartErr) {
              observation2 += ` | Tab restart failed: ${(restartErr as Error).message}`;
            }
          }
        } catch (recErr) {
          observation2 += ` | Recovery attempt threw: ${(recErr as Error).message}`;
        }
      } else if (!success) {
        observation2 += ` | Recovery attempts exhausted (${MAX_RECOVERY_ATTEMPTS} max for this run).`;
      }

      steps.push(
        makeStep(stepNum, action.thinking ?? '', action.action, params, observation2, success, errorMessage),
      );
      emitStep(steps[steps.length - 1]!);
      if (reflectAndMaybeStop()) break;
      turnLog.push(
        `Step ${stepNum}: ${action.action} ${describeAction(action)} → ${success ? 'ok' : 'FAILED'}`,
      );

      // After acting, give the network/DOM a moment to settle before the next observation.
      if (action.action === 'navigate' || action.action === 'click' || action.action === 'press_key') {
        await sleep(600);
      }
    }

    if (opts.signal?.aborted) {
      // Cancelled mid-turn (in-flight LLM call or action aborted): the loop
      // exited via an error path, not a step boundary — record it honestly.
      status = 'cancelled';
      summary = 'Run cancelled by user.';
    } else if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
      // Ran out of steps without an explicit done.
      status = 'completed';
      summary = summary ?? `Agent reached the step limit (${maxSteps}) without an explicit answer.`;
    }
  } finally {
    // Only clean up sessions the loop created itself — a caller-owned
    // session is the user's live viewport and must stay open.
    if (ownsSession) {
      await opts.sessionManager.closeSession(session.id, 'agent loop complete').catch(() => {});
    }
  }

  const result: AgentLoopResult = {
    goalId,
    agentId: opts.agentId,
    objective: opts.objective,
    status,
    answer,
    summary,
    steps,
    createdAt,
    durationMs: Date.now() - startedAt,
  };

  // Best-effort — a memory-write failure must never affect the result being returned.
  await crossRunMemory
    .recordRun({
      goalId,
      objective: opts.objective,
      status,
      summary,
      answer,
      stepCount: steps.length,
      timestamp: createdAt,
    })
    .catch(() => {});

  opts.onTurn?.(
    status === 'completed' && answer
      ? `✓ Done: ${answer}`
      : status === 'cancelled'
        ? `⏹ Cancelled: ${summary ?? 'stopped by user'}`
        : status === 'failed'
          ? `✗ Failed: ${summary ?? 'unknown'}`
          : `↳ Stopped: ${summary ?? 'no answer'}`,
  );

  return result;
}

// ---- helpers --------------------------------------------------------------

function buildUserMessage(
  goal: string,
  observation: string,
  turnLog: string[],
  stepNum: number,
  memoryContext?: string,
): string {
  const recent = turnLog.slice(-6);
  const historyBlock = recent.length
    ? `\n# What you have done so far\n${recent.join('\n')}\n`
    : '';
  const memoryBlock = memoryContext
    ? `\n# Relevant past runs (for context only — this is a NEW run)\n${memoryContext}\n`
    : '';
  return (
    `# Goal\n${goal}\n` +
    `${memoryBlock}` +
    `${historyBlock}` +
    `\n# Current page (turn ${stepNum})\n${observation}\n\n` +
    `Choose exactly one action to make progress toward the goal. Respond with strict JSON only.`
  );
}

/** Maps a model action onto the BrowserActionEngine's ActionParams shape. */
function mapActionToParams(action: AgentAction, sessionId: string): ActionParams {
  switch (action.action) {
    case 'navigate':
      return { sessionId, actionType: 'navigate', url: action.url };
    case 'click':
      return {
        sessionId,
        actionType: 'click',
        selector: action.nodeId != null ? selectorForNodeId(action.nodeId) : undefined,
      };
    case 'type':
      return {
        sessionId,
        actionType: 'type',
        selector: action.nodeId != null ? selectorForNodeId(action.nodeId) : undefined,
        value: action.text ?? '',
      };
    case 'press_key':
      return { sessionId, actionType: 'press_key', key: action.key ?? 'Enter' };
    case 'scroll':
      return {
        sessionId,
        actionType: 'scroll',
        direction: action.direction ?? 'down',
        amount: 600,
      };
    case 'go_back':
      // No native go_back in the engine; best-effort fallback.
      return { sessionId, actionType: 'navigate', url: 'about:blank' };
    case 'extract':
    case 'done':
    default:
      return { sessionId, actionType: 'wait', milliseconds: 0 };
  }
}

function describeAction(a: AgentAction): string {
  switch (a.action) {
    case 'navigate':
      return `navigate ${a.url ?? ''}`;
    case 'click':
      return `click [#${a.nodeId ?? '?'}]`;
    case 'type':
      return `type "${(a.text ?? '').slice(0, 30)}" into [#${a.nodeId ?? '?'}]`;
    case 'press_key':
      return `press ${a.key ?? 'Enter'}`;
    case 'scroll':
      return `scroll ${a.direction ?? 'down'}`;
    case 'go_back':
      return 'go back';
    case 'extract':
      return `extract: ${(a.extracted ?? '').slice(0, 60)}`;
    case 'done':
      return `done: ${(a.extracted ?? a.summary ?? '').slice(0, 60)}`;
    default:
      return a.action;
  }
}

function makeStep(
  stepNumber: number,
  reasoning: string,
  actionName: string,
  actionPayload: ActionParams | Record<string, unknown>,
  observation: string,
  isVerified: boolean,
  errorMessage?: string,
): AgentLoopStep {
  return {
    id: createStepId(`step_${Date.now()}_${stepNumber}`),
    stepNumber,
    reasoning,
    actionName,
    actionPayload: { ...actionPayload },
    observation,
    isVerified,
    success: isVerified,
    errorMessage,
    timestamp: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A second opinion on the model's own "done" claim — one extra LLM call asking whether the
 * claimed answer/summary genuinely satisfies the goal. Not a hard gate: if the verification
 * call itself fails or returns something unparseable, completion still proceeds — the
 * model's self-report remains the primary signal, this just catches the common case of an
 * obviously incomplete or off-goal "done".
 */
async function verifyGoalCompletion(
  objective: string,
  answer: string | undefined,
  summary: string | undefined,
  llmProvider: ILlmProvider,
): Promise<{ satisfied: boolean; reason: string }> {
  try {
    const completion = await llmProvider.generateCompletion({
      modelId: createModelId(llmProvider.providerId),
      messages: [
        {
          role: 'system',
          content:
            'You are a strict verifier for an autonomous browser agent. Given a goal and its ' +
            'claimed result, decide honestly whether the result actually satisfies the goal. ' +
            'Respond with ONLY strict JSON: {"satisfied": boolean, "reason": string}.',
        },
        {
          role: 'user',
          content:
            `Goal: ${objective}\n` +
            `Claimed answer: ${answer ?? '(none)'}\n` +
            `Claimed summary: ${summary ?? '(none)'}\n\n` +
            'Does this genuinely satisfy the goal? Respond with strict JSON only.',
        },
      ],
      temperature: 0,
      maxTokens: 200,
    });
    const jsonText = extractJsonObject(completion.message.content);
    const parsed = JSON.parse(jsonText) as { satisfied?: unknown; reason?: unknown };
    return { satisfied: !!parsed.satisfied, reason: String(parsed.reason ?? '') };
  } catch {
    return { satisfied: true, reason: 'verification unavailable — accepting self-report' };
  }
}

/** Extracts the first top-level `{...}` object from a model response that may include
 *  surrounding prose or markdown code fences around the JSON. */
function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in response');
  }
  return text.slice(start, end + 1);
}

/**
 * Extracts a bounded excerpt of the page's visible text via the real Page.
 * This lets the LLM read actual content (facts, headings, paragraphs) — not
 * just the interactive-element list — which is essential for extraction tasks.
 * Returns up to ~2000 chars focused near the top of the page.
 */
async function extractVisibleText(tab: IBrowserTab): Promise<string> {
  if (!tab.page) return '';
  try {
    const raw = (await tab.page.evaluate(() => {
      // Prioritize the infobox (where biographical facts live) and the lead
      // paragraph, then fall back to headings and list items.
      const grab = (sel: string, limit: number): string[] => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
          const t = (el.innerText || '').trim().replace(/\n{2,}/g, '\n');
          if (t) out.push(t);
          if (out.length >= limit) break;
        }
        return out;
      };
      const infobox = document.querySelector<HTMLElement>('.infobox, table.biography, [role="complementary"]');
      const infoboxText = infobox ? `[INFOBOX]\n${infobox.innerText.trim().slice(0, 800)}\n[/INFOBOX]\n` : '';
      const lead = grab('p', 5).filter((p) => p.length > 40).slice(0, 3);
      const headings = grab('h1, h2, h3', 12);
      const parts = [infoboxText, ...lead, ...headings];
      return parts.join('\n');
    })) as string;
    return raw.slice(0, 2000);
  } catch {
    return '';
  }
}
