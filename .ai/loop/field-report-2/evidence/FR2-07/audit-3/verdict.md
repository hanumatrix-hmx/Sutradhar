# FR2-07 audit-3 verdict: BLOCKED (third failed standard-cycle audit)

Audited `46e2d0c..33b0aaa` (HEAD 33b0aaa, branch claude/fr2-07-verification-contract). All dist deleted, forced rebuild (0 cached), typecheck 34/34, vitest green in 7 packages (browser 840, capability-runtime 244, mcp-server 108, cli 193, sutradhar 34, agent 56, server 28). No pre-existing spec weakened (only import lines changed). Live harness 488/488 twice. Details: `audit-findings.json`.

## Why BLOCKED
**A3-1 (major).** `expect.text` returns `verified:true` for text that is never painted: `<text>` inside SVG never-rendered containers (`<defs>`, `<symbol>` without `<use>`, `<mask>`, `<clipPath>`, `<pattern>`, `<marker>`, a nested `<svg>` in `<defs>`). This also happens inside an open shadow root and inside a cross-origin iframe.
- It happens on all four surfaces: MCP, the bundle, the CLI (exit 0) and the SDK (no throw).
- Ground truth is an independent compositor pixel oracle: 0 painted pixels.
- Raw Chrome 154 reports non-empty Range rects, `visibility:visible` and `checkVisibility()==true` for this text (`svg-primitives.log`), so the contract's primitives accept it.
- It is not documented anywhere.

**Root cause.** The spec equates "rendered" with proxies (rects + visibility + checkVisibility) that are not equivalent to painting, and the generated matrices only generate CSS mechanisms.
- Unlike audit-1/2, the missing set is finite and defined by the SVG spec, so the fix is bounded.
- Option 1: exclude SVG never-rendered subtrees. Keep `<use>`-referenced `<symbol>` content counted; probe `svg2-use-of-symbol` is painted and verified today.
- Option 2: document the case as counted.
- Everything outside `expect.text` passed again. Recommendation: ship those parts and track A3-1 as a scoped follow-up.

## What passed
Fix-2 closed audit-2's findings.
- On the pre-fix2 build 6a51708, my own probes false-verify hidden/zero-size/`object` cross-origin frames and false-contradict bare shadow text. On HEAD all of these are correct.
- My 97 adversarial cases (popover/dialog/until-found/slot forwarding/`:host` hiding/closed-details with shadow hosts/nested cross-origin chains/text hidden or shown during the action/budget) are correct except for SVG.
- Cost:
  - 100k-span page: verified in 187 ms.
  - 220k hidden matches: fails closed as unverifiable in about 1 s.
  - 450k text nodes without the token: contradicted in 270 ms.

## GAP-325 tolerance
The tolerance is honest.
- It cannot accept `verified:true`.
- The 3-per-surface cap catches a systematic regression live. My mutant G1 (every shown cross-origin frame hangs) failed Z-gap325-budget on mcp and bundle, and failed the CLI case directly.

Gaps:
- G1 survives the unit suite (840/840).
- The SDK surface alone would mask it.
- The H2 `relaxedFound` tolerance is not counted by the cap and fired on the bundle in 2 of 2 of my runs (A3-2).

## Focus / parse-before
Not a regression.
- Master fails with action-failed 4/10 times, with the same "No element found for selector: #xo-in".
- HEAD failed 0/10 and then 4/12.
- A parent-side oracle confirms every HEAD `verified` focus.

## Master comparison
- FR2-04: HEAD 111/0/2 vs master 110/1/2 (a lock-race flake on master).
- CLI suite: HEAD 10/14 vs master 9/14. HEAD's failures are a subset of master's.
- tools/list: 65,088 -> 91,165 UTF-8 bytes (+40.1%), 72 tools. Confirmed.

## Mutants
- 12 new unit mutants (N1-N12): all caught.
- Live mutant G1: see above.
- Source restored byte-identically (sha256 b7b7630c...), and dist rebuilt with `--force`.
