# S1 spikes (HEAD build, ISO S2t, no product change)

HEAD build = `packages/sutradhar/dist/*` (sha256 of cli-bin/index/mcp-cli equal to the published 0.6.1 NEG061 hashes, i.e. the
tree at 3f0ba55 builds to the same bundle content as 0.6.1; no source change since). Harness: `sp1.mjs` (this dir), imports
`SutradharRuntime` from `dist/index.js`, fixture server from `../fixtures/`. Raw output: `sp1-run1-bound30s.json`,
`sp1-run2-bound90s.json` (the runtime's logger writes JSON log lines to stdout before the result object; the .json files are
the result object only).

## SP-1 beforeunload under `--dialog dismiss` (policy `dismiss`)
Sequence: navigate `/hist/a`, navigate `/beforeunload`, real `runtime.click('#arm-bu')` (armed: `typeof window.onbeforeunload == 'function'`),
then `runtime.reload`; re-arm (still armed, `function`), then `runtime.goBack`.

| verb | run 1 (bound 30 s) | run 2 (bound 90 s) | URL after | dialog history (opened after the verb started) |
|---|---|---|---|---|
| `reload` | neither resolved nor rejected within 30013 ms | **rejected** `Navigation timeout of 30000 ms exceeded` at 30004 ms | still `/beforeunload` | 1 x `beforeunload`, `action: dismiss`, `handledBy: policy` |
| `goBack` | neither within 30011 ms | **rejected** `Navigation timeout of 30000 ms exceeded` at 30010 ms | still `/beforeunload` | 1 x `beforeunload`, `action: dismiss`, `handledBy: policy` |

Validity (H3-style): with policy `accept` the same armed `reload` **resolved** and the dialog history shows one `beforeunload`
with `action: accept` (so the page really does raise the dialog; the dismiss result is not an unarmed page).

**Selected branch (2.5): NOT an `ERR_ABORTED`-style rejection.** The verb waits for Puppeteer's 30 s navigation timeout and
rejects with `Navigation timeout of 30000 ms exceeded`, and the dismissed `beforeunload` is in `runtime.getDialogHistory`.
So S7 uses the **dialog-history detection** branch ("resolves or waits for a timeout"): after the verb rejects (or resolves),
look for a dismissed `beforeunload` opened after the verb started and print the cancel message, exit 1. Note for S7: the
detection runs after a ~30 s wait; an `isBeforeunloadCancel(error)` helper reuse is NOT sufficient for reload/goBack.

## SP-2 headless PDF
`runtime.exportPdf` of `/long?n=10000` -> 86327 bytes, head `%PDF-1.4`; `setPdf`; `runtime.navigate('/pdf')` headless (inline
`content-disposition`): **resolved**, `document.contentType === 'application/pdf'`, URL `/pdf`. No `ERR_ABORTED`.
**Selected branch:** S3a(g) runs headless with the existing fixture route; no `--headed` fallback and no unit-only gap needed.
(S3a(g) additionally drives it through the CLI `nav`, which is the same runtime path.)
