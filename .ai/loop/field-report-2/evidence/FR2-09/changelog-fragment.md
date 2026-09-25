### FR2-09: Snapshot frame and shadow labels

1. Snapshot lines for elements inside iframes now read `[#31 in iframe "pay" (url)] …`, and
   elements inside open shadow roots end with `(shadow: host)`. Main-frame, light-DOM lines are
   unchanged. Parsers should match `^\[#(\d+)`.
2. Frames that couldn't be read (timed out, navigated mid-snapshot, errored, browser error
   page) or that exceed the 20-frame cap are listed as `[iframe <origin> — not inspectable]
   (reason)`. They were silently dropped before.
3. A child frame whose scrape takes more than 5s no longer stalls the whole snapshot.
4. `ax_snapshot` now includes iframe content (including cross-origin), grouped under
   `[iframe …]` lines, with a 5s bound and a fallback.
5. With `includeNodes` / `snap --json`, nodes carry `frame` and `shadowHosts`, and
   `skippedFrames` is returned.
