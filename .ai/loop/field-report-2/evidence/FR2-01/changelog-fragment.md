# FR2-01 changelog fragment — for the 0.5.0 release item to fold in

## `wait_for_selector` now defaults to `state: "visible"` (breaking behavior change)

**Before:** `wait_for_selector` (MCP `browser.wait_for_selector`, the CLI's `wait`, and the
runtime's `waitForSelector`) only waited for the element to be **attached** to the DOM —
`display:none` / `visibility:hidden` / zero-size elements satisfied it instantly, even though
every description (MCP tool description, CLI `--help`, `AGENT_SETUP.md`, the READMEs) already
claimed it waited for the element to become **visible**. This was silently wrong: a caller
waiting on a toast/modal/AJAX-revealed element that happened to already be in the DOM (just
hidden) got an instant, meaningless success.

**After:** a new `state: 'visible' | 'attached' | 'hidden'` parameter is available end-to-end
(engine, runtime, MCP schema, CLI `--state`, and a new SDK `page.waitForSelector`). **The
default is now `'visible'`**, matching what every surface already documented:

- `'visible'` (default): the element exists **and** is visible — computed `visibility` is not
  `hidden`/`collapse`, and it has a non-empty bounding box. `opacity: 0` still counts as
  visible (matches Puppeteer/Playwright's own definition); occlusion/covering is NOT checked
  here (that's the click path's job).
- `'attached'`: the old default — only DOM presence, visibility ignored.
- `'hidden'`: resolves once the element is removed or not visible. Succeeds immediately if
  nothing ever matched the selector — check the new `output.matchedAtStart` to tell a typo'd
  selector apart from a genuine disappearance.

**Who is affected:** any existing caller that passes no `state` and targets an element that is
attached-but-hidden at call time. Previously that call succeeded instantly; now it will wait up
to `timeoutMs` (the engine's default retry count multiplies this — see risk below) and then
fail with a message naming the state it waited for, e.g.:

```
wait_for_selector timed out after 8000ms waiting for state=visible: 1 element(s) match "#toast"
and are attached to the DOM, but none is visible (display:none, visibility:hidden, or zero
width/height). Pass state "attached" if DOM presence is enough.
```

Callers relying on the old attached-only behavior should pass `state: 'attached'` explicitly.
`output.foundSelector` is preserved unchanged for backward compatibility with anything reading
that field.

**Not affected:** elements that were already visible when the selector resolved (the vast
majority of real call sites in this repo's own scenario suite/engine-comparison harnesses — see
spec §7.1) behave identically. Absent elements still time out; only the error message text
changed (it now names the state).

**Known follow-up risk (not fixed in this item, logged for the Orchestrator/FR2-07 to
triage):** a `state:'visible'` timeout on an attached-but-hidden element now costs roughly
`3 × timeoutMs` (the engine's default `maxRetries: 2`) plus overhead, since the wait is already
its own internal retry loop. A caller using a large `timeoutMs` (e.g. 8000ms) could see a
~26s failure instead of the old instant "success". Proposed fix: default `maxRetries: 0` for
`wait_for_selector` specifically — out of scope for this item (smallest-diff rule).

## New/changed surface

- Engine: `ActionParams.state?: WaitForSelectorState` (`'visible' | 'attached' | 'hidden'`).
- Runtime: `SutradharRuntime.waitForSelector(sessionId, target, timeoutMs?, tabId?, state?)` — new
  optional 5th positional param.
- MCP: `browser.wait_for_selector` gained an optional `state` enum field; description rewritten
  to match actual behavior.
- CLI: new `--state visible|attached|hidden` flag on `wait`; usage/help text updated; success
  output changed from `"<ref> appeared"` to `` `"<ref> is <visible|attached|hidden or absent>
  (state=<state>)"` ``. No script in this repo parses the old text.
- SDK: new `Page.waitForSelector(selector, { state?, timeout? })`. **Throws** on failure/timeout
  (unlike `click`/`type`, which swallow a failed result) — a wait that silently returns on
  timeout is the exact silent-wrongness bug class this item exists to fix.

## Version

This item does **not** bump any package version or write a top-level `CHANGELOG.md` entry —
there is no `CHANGELOG.md` in the repo yet. This fragment is input for whichever later item
performs the 0.5.0 release/version bump (per the loop prompt §4.3, the minor bump is justified
by this exact behavior change).
