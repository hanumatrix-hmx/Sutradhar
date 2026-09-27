// Summarize probe-hyp-*.json (current build vs pre-fix emulation) into one table.
import fs from 'node:fs';
import { outPath } from './lib.mjs';
const names = ['bfcache-own-errors', 'bfcache-stale-404', 'stale-404-no-response-commit', 'crosssite-unload', 'early-own-error', 'dialog-jsredirect-404'];
const metric = {
  'bfcache-own-errors': (t) => `persisted=${t.persisted} ownErr=${t.ownErrPresent} ownMissing404=${t.ownMissingPresent} covers=${t.audit?.covers}`,
  'bfcache-stale-404': (t) => `persisted=${t.persisted} stale404=${t.stale404Reported} covers=${t.audit?.covers}`,
  'stale-404-no-response-commit': (t) => Object.entries(t).map(([k, v]) => `${k}:${v.stale404Reported ?? v.auditError ?? v.navError}`).join(' '),
  'crosssite-unload': (t) => `cross old=${t.crossSite?.oldConsole}/${t.crossSite?.oldBroken} same old=${t.sameSite?.oldConsole}/${t.sameSite?.oldBroken}`,
  'early-own-error': (t) => `earlyKept=${t.earlyKept} imgKept=${t.imgKept} leak=${t.leak}`,
  'dialog-jsredirect-404': (t) => `pending=${t.pendingBefore} ms=${t.ms} err=${t.err} withDialog404=${t.withDialog404} url=${(t.withDialogUrl || '').replace(/http:\/\/127.0.0.1:\d+/, '')} noDialog404=${t.noDialog404} goto=${JSON.stringify(t.state?.goto)?.replace(/http:\/\/127.0.0.1:\d+/, '')}`,
};
const summary = {};
for (const n of names) {
  for (const pf of ['', '-prefix']) {
    const f = outPath(`probe-hyp-${n}${pf}.json`);
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const tr = j.results[n]?.trials ?? [];
    const lines = tr.map((t) => (t.error ? 'ERROR ' + t.error : metric[n](t)));
    summary[`${n}${pf || ' (current)'}`] = lines;
    console.log(`== ${n}${pf || ' (current)'}`);
    for (const l of lines) console.log('   ', l);
  }
}
fs.writeFileSync(outPath('probe-hyp-summary.json'), JSON.stringify(summary, null, 2));
