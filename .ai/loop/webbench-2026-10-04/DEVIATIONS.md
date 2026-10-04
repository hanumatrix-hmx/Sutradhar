# Run deviations from the frozen protocol (orchestrator log)

1. Briefs are delivered by file path + sha256 (driver reads runs/<slot>/brief.md and verifies the hash) instead of pasted
   inline; content is identical and auditable. fill-briefs.mjs substitutes only below the header's '---'.
2. Drivers cannot write summary.md (the harness refuses subagent report files); the orchestrator saves each summary from
   the driver's final reply, labelled as such.
3. Rolling start instead of fixed waves: a new slot starts when one finishes; the binding limit (<=3 concurrent Chrome
   sessions) is unchanged.
4. Environment correction at ~10:35Z: Git Bash (MSYS) path conversion rewrote a --js argument starting with "/" into a
   Windows path (B3/1940 seq 7: "!C:/Program Files/Git/Just a moment|Verif/i..." -> "Unexpected token ':'"). Root cause is
   the driver's shell, NOT Sutradhar (seq 11 'return' refusal is documented expression-only behaviour). All running drivers
   (B1, B4, B5) were told to prefix drive.mjs calls with MSYS_NO_PATHCONV=1; B6 gets it at launch. B3/1940's class is
   unaffected (a regex-free equivalent waited the full 30 s and the Cloudflare page persisted).
