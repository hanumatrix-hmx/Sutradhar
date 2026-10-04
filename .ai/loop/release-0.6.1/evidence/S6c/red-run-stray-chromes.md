# Red run on the pre-fix code started real Chrome processes (deviation, cleaned up)

The pre-fix `spawnDetachedChrome` ignores the new `deps` argument, so the red run of `spawn-failure-cleanup.spec.ts`
launched the real Chrome it found (the G tests resolved instead of rejecting: "promise resolved ... instead of rejecting").
All of them used a `--user-data-dir` under the isolated TEMP `S6c-tmp` (never the real TEMP). Seven browser roots were
found with a CIM query on `CommandLine LIKE '%S6c-tmp%'` (each command line printed and confirmed to name
`...\scratchpad\S6c-tmp\sutradhar-cli-1791073805526-r3wOw8` etc.; PIDs 66496, 78548, 78384, 73700, 78172, 81216, 82320, parent 77972
= the dead vitest worker) and killed one by one with `taskkill /PID <pid> /T /F` (no image-name kill).
Follow-up CIM query: 0 chrome.exe processes referencing `S6c-tmp`.
The green runs cannot do this: every G test injects `spawnFn`/`executablePath`.
