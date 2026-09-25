- **MCP:** `sessionId` is now optional on every `browser.*` tool that required it (66 tools at
  FR2-10 time, plus any added later). When omitted:
  - exactly one live session → that session is used, and the result gains a trailing
    `sessionId omitted: used "<id>" …` text item;
  - 0 live sessions, several, or a launch/attach/shutdown still in progress → `isError` with a
    message listing the live session ids (and their created time, tab count and active URL
    without query/fragment).

  It never guesses. Explicit calls are unchanged.
- `browser.launch`, `browser.attach` and `agent.runGoal` are **unchanged**: their optional
  `sessionId` still means "the id to create or reuse", and omitting it still creates a new
  session.
- **Runtime:** a new `SutradharRuntime.listSessions()` (additive).
- **Known limit:** "the only live session" is judged by the server. If a caller's session was
  idle-reaped or crashed and it launched another, an omitted id uses the new one. The trailing
  note says so.
