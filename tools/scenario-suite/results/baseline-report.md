# Scenario suite — baseline results

Surfaces captured: sdk, cli, mcp

| UC | Scenario | SDK | CLI | MCP |
|---|---|---|---|---|
| UC-01 | Bot detection surface | ❌ FAIL | ✅ pass | ✅ pass |
| UC-02 | CAPTCHA grounding (not solving) | ✅ pass | ✅ pass | ✅ pass |
| UC-03 | Auth + session persistence | ✅ pass | ✅ pass | ✅ pass |
| UC-04 | Canvas blindness (Google Maps) | ✅ pass | ✅ pass | ✅ pass |
| UC-05 | Long 10+ step flow | ❌ FAIL | ❌ FAIL | ❌ FAIL |
| UC-06 | Modals + dynamic content | ✅ pass | ✅ pass | ✅ pass |
| UC-07 | Cross-origin iframe (TinyMCE) | ✅ pass | ✅ pass | ✅ pass |
| UC-08 | File download | ✅ pass | ✅ pass | ❌ FAIL |
| UC-09 | Multi-tab / popup | ✅ pass | ✅ pass | ✅ pass |
| UC-10 | Prompt injection exposure | ✅ pass | ✅ pass | ✅ pass |
| UC-11 | Token efficiency | ✅ pass | ✅ pass | ✅ pass |
| UC-12 | Outcome verification after a state-changing action | ✅ pass | ✅ pass | ✅ pass |
| UC-13 | Speed | ✅ pass | ✅ pass | ✅ pass |
| UC-14 | Accessibility-only grounding (no CSS-selectable name) | ❌ FAIL | ✅ pass | ❌ FAIL |

## Totals

- **SDK**: 11/14 pass
- **CLI**: 13/14 pass
- **MCP**: 11/14 pass
