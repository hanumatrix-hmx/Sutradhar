# FR2-07 audit-1 verdict: REOPEN

Audited `c83c220..eb9eee0` on `claude/fr2-07-verification-contract`, rebuilt from scratch.

**Major (blocks ACCEPT)**
- **F1.** `expect.text` returns `verified:true` (0.9) for text that is not visible. This happens in two cases:
  - the text sits in an open shadow root whose host is `display:none`;
  - the text sits in a `display:none` iframe.

  The cause is in `visibleTextContainsInPage` (`packages/browser/src/verifier/execution-verifier.ts`). It reads `innerText` from shadow-root children and from each frame's body. When a node isn't rendered, `innerText` falls back to `textContent`. That breaks the documented contract ("hidden/display:none text does not count") and decision 4.8.
  - Repro: `browser.click {target:'#noop', expect:{text:'SHADOW-HIDDEN-TEXT'}}` on `probes/audit-server.mjs` `/p.html`.
  - It also happens on the `sutradhar` bundle.

**Minor**
- **F2.** Test gap: a clipboard mutant that compares only lengths survives every test.
- **F3.** Test gap: the focus in-page predicate is only caught by live tests.
- **F4.** When the built-in check doesn't run and a trivially true `expect` passes, the reason text is the generic one and hides that the action's own check didn't run.
- **F5.** Some new unit tests have upper time bounds that could fail under heavy load.
- **F6.** Commit `f24ec4e` mixes product fixes with the harness and docs.
- **F7.** `tools/list` payload grew 34%.
- **F8.** SDK `waitForSelector` still resolves `undefined`. This is documented.

**Everything else passed with fresh evidence.** Every done-when check passed live on real Chrome across MCP, CLI and SDK, including the negatives:
- press_key, download (`fs.stat`), wait_for_selector, focus;
- navigate/back/forward/reload, including back with no history, 404 and 500;
- set_clipboard (isolated-world read-back that resists spoofing);
- click_at_point, including out-of-process iframes and the offscreen and covered cases;
- upload_file_via_trigger.

No page primitives are overridden. The regression checks were clean:
- FR2-04 and the CLI UC-05/08/12 scenarios gave identical results on c83c220 and HEAD.
- The full test suite passed: 32 of 32 turbo tasks.

See `audit-findings.json`.
