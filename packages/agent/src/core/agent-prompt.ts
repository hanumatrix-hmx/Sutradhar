/**
 * @file packages/agent/src/core/agent-prompt.ts
 * @description System prompt, action schema, and JSON parsing for the browser agent loop.
 *
 * The agent communicates with the LLM via a strict JSON protocol so it works with
 * ANY model (including local 9B models whose native tool-calling is unreliable).
 * The model emits exactly one action object per turn; the loop executes it and
 * feeds back the resulting page state.
 */

/**
 * One decision emitted by the LLM. The loop maps `action` + params onto a real
 * BrowserActionEngine call. `done` ends the loop and returns `extracted`/`summary`.
 */
export interface AgentAction {
  /** One or two sentences of reasoning. Improves quality and gives an audit trail. */
  readonly thinking?: string;
  readonly action:
    | 'navigate'
    | 'click'
    | 'type'
    | 'press_key'
    | 'scroll'
    | 'go_back'
    | 'extract'
    | 'done';
  /** Node id from the snapshot listing (e.g. 7 for [#7]). */
  readonly nodeId?: number;
  /** Raw text to type into the element identified by nodeId. */
  readonly text?: string;
  /** Keyboard key for press_key (e.g. "Enter", "Tab"). */
  readonly key?: string;
  /** Absolute URL for the navigate action. */
  readonly url?: string;
  /** Scroll direction. */
  readonly direction?: 'up' | 'down';
  /**
   * For extract: the specific text/data the model read off the page in service
   * of the goal. For done: the final answer to the user's goal.
   */
  readonly extracted?: string;
  /** Optional short summary returned to the caller when action === 'done'. */
  readonly summary?: string;
}

export const AGENT_SYSTEM_PROMPT = `You are Sutradhar, an autonomous web browser agent. You achieve the user's goal by reasoning step by step and acting on a live web page through a real browser.

# How you perceive the page
Each turn you receive the current URL, title, a numbered list of the page's interactive elements, and an excerpt of the visible page text. Each element looks like:
  [#7] button "Search"  role=button
  [#8] input[search] placeholder="Search Wikipedia" value="alan turing"
To act on an element, return its nodeId (the number in [#N]).

IMPORTANT: Many goals (e.g. "find the birth date") can be answered DIRECTLY from the visible page text excerpt — you do NOT always need to click or scroll. If the answer is already in the text you can see, immediately use "extract" then "done".

# Actions you can take (return EXACTLY ONE per turn)
- navigate: go to {url}. Use when you need to open a specific page.
- click: click element {nodeId}.
- type: clear & type {text} into input element {nodeId}.
- press_key: send keyboard {key} (e.g. "Enter", "Tab") to the focused element / page.
- scroll: scroll the page {direction} ("up"|"down") to reveal more content.
- go_back: go back one page in history.
- extract: read {extracted} (the specific fact/text you found) and continue if more is needed.
- done: the goal is achieved; return {extracted} as the final answer (and optional {summary}).

# Rules
- Think briefly first in "thinking", then choose exactly one action.
- Prefer the most specific element for the job (e.g. a search box for typing a query).
- After a search or navigation, WAIT for the result to load before concluding.
- Only use "done" once you have actually found the information on the page. Use "extract" to record it first, then "done" to finish.
- If a page doesn't contain what you need, navigate or search again rather than guessing.
- Never invent information. If you cannot find it after several attempts, finish with "done" and explain in "summary" that it was not found.

# Response format (STRICT JSON, no markdown, no prose outside the object)
{
  "thinking": "<one short sentence>",
  "action": "<one of the actions above>",
  "nodeId": <number, when relevant>,
  "text": "<when relevant>",
  "key": "<when relevant>",
  "url": "<when relevant>",
  "direction": "<up|down, when relevant>",
  "extracted": "<fact read from the page, for extract/done>",
  "summary": "<optional final summary, for done>"
}

Only include the fields relevant to your chosen action. Always include "thinking" and "action".`;

/**
 * Tolerantly extracts a JSON object from an LLM response.
 *
 * Models occasionally wrap output in markdown fences, add a leading sentence, or
 * stream a trailing comment. This finds the first balanced {...} block and parses
 * it; on failure it returns null so the caller can request a repair.
 */
export function parseAgentAction(raw: string): AgentAction | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Strip markdown code fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed;

  // Direct parse first (fast path for well-behaved models / json mode).
  try {
    return normalize(JSON.parse(candidate));
  } catch {
    // fall through to balanced extraction
  }

  // Find the first balanced { ... } block.
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try {
          return normalize(JSON.parse(slice));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Coerces and validates a parsed object into an AgentAction (or null if invalid). */
function normalize(obj: unknown): AgentAction | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const action = typeof o['action'] === 'string' ? (o['action'] as AgentAction['action']) : null;
  if (!action) return null;
  const allowed: AgentAction['action'][] = [
    'navigate',
    'click',
    'type',
    'press_key',
    'scroll',
    'go_back',
    'extract',
    'done',
  ];
  if (!allowed.includes(action)) return null;

  return {
    thinking: typeof o['thinking'] === 'string' ? (o['thinking'] as string) : undefined,
    action,
    nodeId: typeof o['nodeId'] === 'number' ? (o['nodeId'] as number) : undefined,
    text: typeof o['text'] === 'string' ? (o['text'] as string) : undefined,
    key: typeof o['key'] === 'string' ? (o['key'] as string) : undefined,
    url: typeof o['url'] === 'string' ? (o['url'] as string) : undefined,
    direction:
      o['direction'] === 'up' || o['direction'] === 'down'
        ? (o['direction'] as 'up' | 'down')
        : undefined,
    extracted: typeof o['extracted'] === 'string' ? (o['extracted'] as string) : undefined,
    summary: typeof o['summary'] === 'string' ? (o['summary'] as string) : undefined,
  };
}
