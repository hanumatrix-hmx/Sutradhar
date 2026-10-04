# S10 changelog and docs

Template with the three placeholders: `template.txt` (`grep -oE "<(CAUSE_LINE|TOOL_COUNT|BROWSER_TOOL_COUNT)>" template.txt | wc -l` = 3).
Filled changelog `docs/22-changelog.md`: the same grep prints nothing (0 lines). Values come from evidence, not memory:
tools/list = 74 (`../S3b/mcp-probe-74.out.json`: `"toolCount": 74`, probe with 73 fails), `browser.*` = 73 (`../S3b/tool-count.txt`),
cause line from `../S4/README.md` (synchronous `throwIfDetached`).

| AC | result | evidence |
|---|---|---|
| S10-1 | PASS | placeholder grep on the changelog: 0; template: 3 |
| S10-2 | PASS | `git grep -n "as of 0\.6\.1\|Status (0\.6\.1)" -- README.md SECURITY.md packages/*/README.md AGENT_SETUP.md packages/sutradhar/AGENT_SETUP.md` prints nothing (rc 1) |
| S10-3 | PASS | README.md:44 "73 `browser.*` tools", mcp-server README :17 "Tools (74: 73 ...", :19 "73", both AGENT_SETUP copies :60 "73", changelog "74 tools now: 73" |
| S10-4 | PASS | `cmp AGENT_SETUP.md packages/sutradhar/AGENT_SETUP.md` exit 0 |

## notes.md (justified items)
- `packages/sutradhar/AGENT_SETUP.md` is gitignored and regenerated from the root copy by `scripts/build-bundle.mjs:65`; it was
  copied by hand here so the `cmp` holds before the S11 build, and the build overwrites it with the same bytes.
- "sessionId is optional on every tool that takes one (70 tools)" in `packages/mcp-server/README.md` became 71 (the new tool takes
  an optional sessionId; `grep -c "sessionId: z.string()" tools.ts` rose 71 -> 72 over the release; the doc's own baseline of 70 was
  already one below that grep count, so only the delta was applied).
- Behaviour statements checked against built behaviour in S8 audit.md (D3): `#hash` entries (A-5 probe P4), PROB-052 exit 1, the
  `back`/`forward` edge exit 1 with `--expect-*`, no-session message.

False-pass analysis: the count check could pass while a doc still says 72 in a form my grep misses (e.g. "seventy-two", or in a
table). Ruled out by: `git grep -nE "\b72\b" -- README.md packages/*/README.md AGENT_SETUP.md` (re-run after the edits: no hits).
