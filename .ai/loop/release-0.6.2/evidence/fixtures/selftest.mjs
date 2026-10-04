// Fixture server self-test: GET each route, assert status 200 + marker / content type. Exit 0 iff all pass.
// A negative control (unknown route -> 404) must fail the same assertion shape.
import { start, EMOJI_PAIR_HIGH_INDICES, EMOJI_TOTAL_LENGTH } from './fixture-server.mjs';

const f = await start();
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) failures++; };

const routes = [
  ['/long?n=10000', 'long'], ['/long-emoji', 'long-emoji'], ['/short', 'short'], ['/blank', 'blank'],
  ['/churn?k=8&ms=25', 'churn'], ['/nodeid', 'nodeid'], ['/nodeid-frame', 'nodeid-frame'],
  ['/hist/a', 'hist-a'], ['/hist/b', 'hist-b'], ['/hist/spa', 'hist-spa'], ['/reload-count', 'reload-count'],
  ['/beforeunload', 'beforeunload'],
];
for (const [path, marker] of routes) {
  const r = await fetch(f.url + path);
  const t = await r.text();
  check(`GET ${path}`, r.status === 200 && t.includes(`<!--FIXTURE:${marker}-->`), `status=${r.status} len=${t.length}`);
}
// content checks
const lg = await (await fetch(f.url + '/long?n=10000')).text();
const lineCount = (lg.match(/<div>L\d{6} /g) ?? []).length;
check('long: line count gives innerText >= 10000', lineCount * 42 - 1 >= 10000, `lines=${lineCount}`);
const em = await (await fetch(f.url + '/long-emoji')).text();
const body = em.slice(em.indexOf('<pre'), em.indexOf('</pre>'));
const txt = body.slice(body.indexOf('>') + 1);
check('long-emoji: length', txt.length === EMOJI_TOTAL_LENGTH, `len=${txt.length}`);
check('long-emoji: pairs at known indices', EMOJI_PAIR_HIGH_INDICES.every((i) => txt.charCodeAt(i) >= 0xd800 && txt.charCodeAt(i) <= 0xdbff && txt.charCodeAt(i + 1) >= 0xdc00 && txt.charCodeAt(i + 1) <= 0xdfff));
const sh = await (await fetch(f.url + '/short')).text();
check('short: ~300 chars of text', sh.replace(/<[^>]+>/g, '').length > 250 && sh.replace(/<[^>]+>/g, '').length < 400);
const rc1 = await (await fetch(f.url + '/reload-count')).text();
const rc2 = await (await fetch(f.url + '/reload-count')).text();
check('reload-count increments', /Reload count: (\d+)/.exec(rc2)[1] > /Reload count: (\d+)/.exec(rc1)[1]);
check('spa: inline pushState script', (await (await fetch(f.url + '/hist/spa')).text()).includes("history.pushState({}, '', '#2'); location.hash = 'x';"));
// pdf
f.setPdf(Buffer.from('%PDF-1.4\n%selftest\n'));
const pr = await fetch(f.url + '/pdf');
const pb = Buffer.from(await pr.arrayBuffer());
check('GET /pdf', pr.status === 200 && pr.headers.get('content-type') === 'application/pdf' && pr.headers.get('content-disposition') === 'inline' && pb.toString().startsWith('%PDF-1.4'), `len=${pb.length}`);
// hits recorded
check('hits recorded', f.hits.length >= routes.length);
// negative control
const nr = await fetch(f.url + '/nope');
check('negative control: unknown route is 404 (not 200)', nr.status === 404, `status=${nr.status}`);
await f.close();
console.log(failures === 0 ? 'SELFTEST OK' : `SELFTEST FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
