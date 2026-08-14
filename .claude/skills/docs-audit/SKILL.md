---
name: docs-audit
description: Re-check Sutradhar's docs (root README, docs/*.md, per-package READMEs) against what's actually built, fix real staleness. Use periodically after a batch of capability work ships, or when asked to check/fix documentation, since docs drift every time real features ship without a matching doc pass — this happened twice already (2026-08-11, 2026-08-14).
user-invocable: true
---

# /docs-audit — find and fix real doc staleness

Docs staleness in this repo isn't a one-time fix — it recurs every time real capability ships
without a matching doc pass (see `roadmap_maturity` memory / `.ai/browsing-capability-loop.md`
Milestone 18 for the last time this happened: `mcp-server/README.md` said "60 tools" when 68
were real, and `docs/ARCHITECTURE.md`/`docs/DEVELOPMENT.md` had drifted into describing a
Next.js/Fastify/Tauri/Postgres/Qdrant stack that never existed in this repo).

**The standard here is verified accuracy, not plausible-sounding prose.** Every claim you make
in a doc fix must be checked against the real repo, not assumed or inferred from the doc's own
prior phrasing — a previous pass in this exact skill area fabricated a plausible error message
string that turned out not to exist in the code; it was caught and fixed before commit only by
re-reading the actual source. Don't repeat that: if you're not looking at the real file when
you write a claim about it, don't write the claim.

## 1. Tool-surface accuracy

- Count real registered tools: `grep -o "'browser\.[a-z_]*'" packages/mcp-server/src/tools.ts | sort -u | wc -l` (adjust the pattern if the file's moved/renamed).
- Compare against `packages/mcp-server/README.md`'s stated count and its per-category tables.
  Diff the two lists (`comm -23` between the real tool list and everything backtick-wrapped in
  the README) to find exactly what's missing — watch for the README's own convention of
  combining related tools into one row (`get_cookies` / `set_cookie` / `delete_cookie`), which
  produces false positives in a naive backtick-grep.
- Fix any gap with a real one-line description per tool (check the tool's actual behavior in
  `packages/mcp-server/src/tools.ts` or `packages/browser/src/actions/browser-action-engine.ts`
  — don't guess from the name alone).

## 2. Architecture/package-graph accuracy

- Get the real package list and dependency graph directly from source, not from memory of a
  prior pass:
  ```bash
  ls packages/ apps/
  for d in packages/*/ apps/*/; do
    [ -f "$d/package.json" ] && grep -m1 '"description"' "$d/package.json"
  done
  ```
- Check `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT.md` against this. Watch specifically for:
  references to deleted/never-existing packages (search for names not in the real `ls` output
  above), a described tech stack (frameworks, databases, deployment targets) that doesn't
  match any real `package.json` dependency, and commands in `DEVELOPMENT.md` that don't exist
  in the real root `package.json` `scripts` block.
- `apps/` holds runnable applications (currently `server` — a real REST gateway, not
  Fastify/Express; and `extension` — a plain, workspace-external browser extension);
  `packages/` holds the libraries. Confirm this pairing is still accurate before asserting it.

## 3. Root README

- Check the "Key Capabilities" / feature-highlight section for framework claims (e.g. "Next.js
  dashboard" when the real frontend is Vite+React) — these drift silently since nobody reads
  marketing copy as carefully as they read setup instructions.
- Check the monorepo-structure section's list of packages and any note about
  empty/scaffolding/deleted directories — confirm those directories' current real state
  (`ls packages/<name>` — does it still exist, is it still empty, or was it deleted since the
  note was written).

## 4. Verify before writing, every time

For any specific behavioral claim (an error message, a fallback behavior, a default value) —
open the actual source file and read the relevant function before writing the sentence. If you
can't find the exact behavior in under a couple of minutes, either keep digging or write the
claim more conservatively (describe what you're confident of, flag what you're not) rather
than filling the gap with something plausible-sounding.

## 5. Wrap up

- `grep` the whole `docs/` tree + root `README.md` for any remaining reference to deleted
  package names as a final sweep before committing.
- Update `.ai/known-problems.md` if this closes or reopens a tracked doc-staleness problem
  (e.g. `PROB-004`'s history is a useful template — it was resolved once, then staleness crept
  back after more packages shipped; note that pattern explicitly rather than treating "already
  resolved" as permanent).
- Commit with a clear list of what was fixed and why (quote the specific false claim removed,
  not just "updated docs").
