# Fixture change 1 (coordinator decision A, found by S7 H1-SPA)
fixture-server.mjs /hist/spa: `location.hash = 'x'` -> `history.pushState({}, '', '#x')`. Chrome turns a fragment navigation made before the document finished loading into a history replace, so the S1 body created one same-document entry instead of two.
sha256 before: bb69002f0437a155d360210a4958e2faa4d193410be2a28ae1d7554f643626bb
sha256 after:  20aa282ce04ca5621092e7fa87f1facf05772a557197946e0cab67811204edcd
fixtures.sha256 (the pin named by plan 4.S1 step 7) updated; selftest.mjs unchanged. Harness copies S5/S6 harness.sha256 record the earlier hash (historical, taken at their commits).
