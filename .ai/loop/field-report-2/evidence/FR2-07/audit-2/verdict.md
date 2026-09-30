# FR2-07 audit-2 verdict: REOPEN (second failed audit)

Audited `c83c220..6a51708` on `claude/fr2-07-verification-contract`. I deleted every dist directory and rebuilt with `--force` (0 cached). I also built master c83c220 and pre-fix 4705e73 from `git archive` in scratch. Details are in `audit-findings.json`.

**Green checks**
- Typecheck: 34/34.
- Tests per package: browser 659, capability-runtime 244, mcp-server 108, cli 193, sutradhar 34, agent 56, server 28. Full turbo test: 32/32.
- No existing test was weakened. The only lines removed are import lines that were re-added, plus the F5 upper time bounds.

**Prior findings F1-F5**
- F1 is fixed for the display:none family. On pre-fix I found 24 cases where hidden text was reported as verified. On HEAD there are 6, all listed under A2-1 and A2-3 below.
- F2, F3, F4 and F5 are fixed. For each one, the test-gap mutant is now caught, or the F4 reason shows up live.

## Major findings
- **A2-1.** `expect.text` returns verified:true for text inside a `visibility:hidden` iframe, and inside an iframe with a `visibility:hidden` ancestor.
  - This happens for same-origin, sandboxed and cross-origin frames.
  - It happens on MCP, the bundle, the CLI (exit 0) and the SDK (no throw).
  - It breaks the documented promise "hidden/display:none text does not count". It's the same class of bug as F1, and GAP-323 doesn't list it.
  - Fix: decide whether a frame is rendered from the parent side, using `frame.frameElement()`.
- **A2-2.** One out-of-process frame that never answers makes `expect.text` unverifiable for the whole page, even when the main frame has the text. The SDK then throws.
  - SDK launch, 8 cross-origin frames: 8 of 12 calls unverifiable.
  - A raw Puppeteer control shows a single hung frame, and the main frame always answers.
  - The builder's own X10/X11 cases flaked in my runs: full run 109/110, X11 failed in 1 of 3 reruns.
  - Fix: return "found" as soon as any frame finds the text, and apply the time bound per frame.

## Minor findings
- **A2-3.** The walk up the ancestors gives up after 10000 levels and then reports the text as visible, so text more than 10000 levels deep under a display:none element counts as visible.
- **A2-4.** Text placed directly in a shadow root (a text node, not an element) is reported as contradicted, even though it is visible.
- **A2-5.** Some docs and logs are inaccurate:
  - GAP-323 is wrong about `<details>`, and closed `<details>` content is in fact excluded correctly.
  - The gaps.md table is broken.
  - The tools/list "bytes" figures are character counts. The +34% growth and the 72 tools are confirmed.

## K11 / GAP-322
The K11 failure comes from the test harness, not the product.
- The error text is thrown only by Puppeteer's `$eval`, and the product never calls it.
- The harness reads from the first cross-origin frame in the list. With extra frames listed ahead of the target frame, it picks the wrong one.
- I reproduced this 3/3 on HEAD, 3/3 on 4705e73 and 3/3 on master. In every run the product's focus and key press worked.

## Master comparison
- FR2-04: 111/0/2 on both HEAD and master.
- CLI scenarios: 12/14 on both, with UC-05 and UC-12 failing the same way.
- No regressions from FR2-07.

## Mutation tests
All 12 mutants were caught by the unit tests (the F2/F3 re-checks plus N1-N10). Every mutated file was restored byte-identically, checked by sha256.
