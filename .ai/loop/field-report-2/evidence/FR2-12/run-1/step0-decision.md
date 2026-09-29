# FR2-12 Step 0 decision

Date: 2026-09-27T06:48:21.296Z

## E2 buffered-vitals-read experiment

- visibility: visible
- sync LCP startTimes: [96]
- sync CLS: 0.028657405848819463
- async LCP (250ms bound): 96
- reference audit() runs' webVitals: [{"lcpMs":32,"cls":0.028657405848819463,"fcpMs":32,"ttfbMs":2},{"lcpMs":36,"cls":0.028657405848819463,"fcpMs":36,"ttfbMs":1},{"lcpMs":32,"cls":0.028657405848819463,"fcpMs":32,"ttfbMs":1}]

**Decision: Branch B**

## Other step-0 findings (informational, no assertions)

- E0a (bad nested outDir): exit=1, ENOENT in stderr=true
- E0b (--json on audit today): stdout is JSON=false (expected false)
- E1a (reattach coverage): consoleErrors=0, pageErrors=0, brokenRequests=0 (expected brokenRequests=0; console/page error replay behavior recorded, not asserted)
- E1b (contamination, B1): current-page mode leaked=["noisy-4","Failed to load resource: the server responded with a status of 404 (Not Found)"]; url mode leaked=["noisy-4","Failed to load resource: the server responded with a status of 404 (Not Found)"]
- E1c (CLS x k, B2): series=[0.028657405848819463,0.057314811697638926,0.0859722175464584]
- E1d (CLI cross-process, no B2): cls1=0.053202473958333336 cls2=0.053202473958333336
- E3 (fixed-sleep miss, GAP-038): slow-404 present=false (expected false)
