# B5 summary (written by the orchestrator from the driver's final reply; the harness refused the driver's Write)

| id | class | subflag | cause |
|---|---|---|---|
| 1434 | EXTERNAL-BLOCK | challenge | Redfin -> ratelimited.redfin.com "Are You a Robot?" (HTTP 429), a1+a2 |
| 696 | TASK-INVALID | drift | goal.com: no site search (search URL HTTP 410, no input); latest Man Utd match page has no "match report" (judgement call) |
| 1329 | TASK-INVALID | drift | Penn Medicine contact page lists phone + forms only; only email is a security-vulnerability address (judgement call) |
| 2582 | AGENT-FAIL | partial | MSD Manuals: first result is Consumer "High Blood Pressure (Hypertension)" without a "risk factors" section; no answer reported |
| 982 | AGENT-FAIL | substitution | lawinsider: results show "Filed" dates, no "effective date"; `text` cut off after 3 of 10 result cards while `read body` returned all 10 (logged as toolDefect) |
| 2218 | EXTERNAL-BLOCK | captcha | Yelp HTTP 403 + DataDome captcha, a1+a2; no interaction |

check-clean: all clean. Rule slips: several chained sequential calls (no browser-changing pair); 2582 ~45 calls (over 40 soft limit). Cookies: rejected on msdmanuals; lawinsider offered only "Accept All", left unaccepted.
