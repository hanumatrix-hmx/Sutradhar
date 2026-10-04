# B2 summary (written by the orchestrator from the driver's final reply; the driver's Write of summary.md was refused by the harness)

| id | class | subflag | answer / cause |
|---|---|---|---|
| 1946 | COMPLETED | strict | first four UNESCO site-search results for "heritage conservation" (seq 17) |
| 1837 | EXTERNAL-BLOCK | geo | tiktok.com/explore redirected to /in/about (India block notice, seq 3); a2 skipped |
| 1379 | TASK-INVALID | drift | Polygon Guides is a recency feed with no popularity ranking (seq 11, 17); driver notes the drift check was narrow |
| 1266 | EXTERNAL-BLOCK | captcha | nytimes.com HTTP 403 + DataDome captcha iframe, a1 and a2; no interaction |
| 2554 | EXTERNAL-BLOCK | protocol | net::ERR_HTTP2_PROTOCOL_ERROR on a1 and a2; no curl control (only 392/568 pre-registered) |
| 2215 | EXTERNAL-BLOCK | edge-deny | Cloudflare "Sorry, you have been blocked" with Ray ID (seq 3) |

check-clean: all 8 attempts clean. Driver notes: `#64` snapshot-id usage error at seq 7/9 (own error, retried with `64`); two sequential (never concurrent) drive.mjs calls chained in one shell command.
