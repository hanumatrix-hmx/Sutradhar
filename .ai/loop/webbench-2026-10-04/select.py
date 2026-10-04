"""Pre-registered, seeded task selection for the 2026-10-04 WebBench run (protocol.md section 2).

Reads ONLY the frozen inputs in ./inputs/ (dataset snapshot, tested-domains snapshot, historical
tasks*.json snapshots). Every input file and the derived exclusion list are hash-pinned; any
mismatch aborts. It never overwrites anything unless --out is given, and refuses to overwrite the
committed selection.json unless --force is also given.

Verify (read-only):
    python .ai/loop/webbench-2026-10-04/select.py --out <SCR>/sel-check.json
    cmp <SCR>/sel-check.json .ai/loop/webbench-2026-10-04/selection.json   # must print nothing
"""
import argparse, csv, glob, hashlib, json, os, re, sys
from urllib.parse import urlparse

SEED = "sutradhar-webbench-2026-10-04"
N_PRIMARY, N_RESERVE = 30, 6
RETEST = [597, 41, 192, 392, 568, 1691]

HERE = os.path.dirname(os.path.abspath(__file__))
INP = os.path.join(HERE, 'inputs')
PINNED = {
    'webbenchfinal.csv': 'fd5311a38bdb6f941e8f544150735656c114d76fbfb17193da973d5de0165217',
    'tested-domains.snapshot.txt': '434ff9d14c424dbf0a1ab0217b45944dc7e5bf44ab29a3acff10d326417dbe20',
    'historical-tasks/tasks.json': '7b920d725fc0d591c8462c318bb85e48e19ffcbe33c1caba9ab036e43bb4a2d8',
    'historical-tasks/tasks-sample2.json': '73c77fc366b8e6ca8e187e7f817b63b923ae2d902f099b9289f39d3d90ebe7e3',
    'historical-tasks/tasks-sample3.json': '82c811a61dc884856774aee361d151ea089a28feb8c5e85b9c548bb5606f01d3',
    'historical-tasks/tasks-sample4.json': 'fa2090709017495807d2a0e4e5e39993509c79816442286766d49dc7e28bc788',
    'historical-tasks/tasks-sample5.json': '3531b6842e15f5a97eb4e4e8ee13441314431930a950cca27a352afd67660bff',
    'historical-tasks/tasks-sample6.json': '6554a19a2eedd7687893e5d936c521d863b65c315df6c1b1ab37dde9a7ec2b7b',
    'historical-tasks/tasks-sample7.json': 'b9e63a40d151fbc8d5cc1b85c1fdf790865164f20db2fe914b113461acbeaa4f',
    'historical-tasks/tasks-sample8.json': 'c9890a10f9ba3149c58c271fb2c8fddb76103ffd7710cc0aca4233fdb430957c',
    'historical-tasks/tasks-sample9.json': 'b3d41babc0a48c5f81eedaadd58728666834dbc784fee04a916bbd5188a3f6f8',
    'historical-tasks/tasks-sample10.json': 'dddd0543a65727a8df5bc257f61b6f0fad41e586a3dde4be19cd0e382e82a1dc',
    'historical-tasks/tasks-sample11.json': '150363a3738ae4d9782c85ab2a4c0d02f0ec33f3ec16da057fdc216d7bd8b7a6',
    'historical-tasks/tasks-sample12.json': '34076178c48c80f3d935d679ea12dc7e36f5b8c34f7a4ed06c30876442f27c86',
    'historical-tasks/tasks-sample13.json': '374972800c5a058188ae8b5c532f5640f92a644e39aa073adc4e78e5049618da',
}
# sha256 of '\n'.join(sorted exclusion domains); 124 domains.
EXCLUDED_PIN = '3da40a4bae1071e7ed85026f3f109239b86881d5281a69b666ea70ecf5203f98'

ap = argparse.ArgumentParser()
ap.add_argument('--out', help='write selection JSON here (default: do not write)')
ap.add_argument('--force', action='store_true', help='allow --out to be the committed selection.json')
args = ap.parse_args()

for rel, want in PINNED.items():
    got = hashlib.sha256(open(os.path.join(INP, rel), 'rb').read()).hexdigest()
    if got != want:
        sys.exit(f'input hash mismatch for {rel}: {got} != {want}')
extra = sorted(set(os.path.relpath(p, INP).replace(os.sep, '/') for p in glob.glob(os.path.join(INP, 'historical-tasks', '*.json'))) - set(PINNED))
if extra:
    sys.exit(f'unpinned historical task files present: {extra}')

rows = list(csv.DictReader(open(os.path.join(INP, 'webbenchfinal.csv'), encoding='utf-8', newline='')))

TWO_LEVEL = {'co.uk', 'gov.uk', 'ac.uk', 'org.uk', 'com.au', 'gov.au', 'vic.gov.au', 'co.in', 'gov.in',
             'co.jp', 'com.br', 'co.nz', 'com.mx', 'com.cn', 'co.za', 'com.sg', 'nsw.gov.au'}

def reg(u):
    h = (urlparse(u if '://' in u else 'https://' + u).hostname or '').lower()
    if h.startswith('www.'):
        h = h[4:]
    p = h.split('.')
    for n in (3, 2):
        if len(p) > n and '.'.join(p[-n:]) in TWO_LEVEL:
            return '.'.join(p[-(n + 1):])
    return '.'.join(p[-2:])

ALIAS = {'aliexpress.us': 'aliexpress.com'}
def dom(u):
    d = reg(u)
    return ALIAS.get(d, d)

excluded = set()
for line in open(os.path.join(INP, 'tested-domains.snapshot.txt'), encoding='utf-8'):
    line = line.strip()
    if line and not line.startswith('#'):
        excluded.add(dom(line))
for rel in PINNED:
    if rel.startswith('historical-tasks/'):
        for t in json.load(open(os.path.join(INP, rel), encoding='utf-8'))['tasks']:
            excluded.add(dom(t['startingUrl']))
excluded_sorted = sorted(excluded)
excl_hash = hashlib.sha256('\n'.join(excluded_sorted).encode()).hexdigest()
if EXCLUDED_PIN != '__PIN__' and excl_hash != EXCLUDED_PIN:
    sys.exit(f'exclusion list hash mismatch: {excl_hash} != {EXCLUDED_PIN}')

OOS = re.compile(r"\b(log ?in|logged in|sign ?in|signed in|sign up|signup|register|your account|my account|"
                 r"create an account|password|checkout|check out|purchase|buy (a|an|the|it|them)|place an order|order (a|an|the|it) |"
                 r"pay |payment|book (a|an|the)|reserve|reservation|send|message|email (it|them|the|a)|contact form|"
                 r"fill (out|in)|post (a|an|your|it)|comment|write a review|leave a review|rate (the|this|it)|submit|subscribe|"
                 r"newsletter|apply for|upload|download|cart|basket|bag\b|wishlist|watchlist|favorites|playlist|"
                 r"save (it|the|this|them|to)|follow (the|this|an?) |rsvp|donate|delete|remove|update your|edit your|"
                 r"create (a|an|new)|add (it|them|this|the|a|an) [^.]*\bto\b)", re.I)
FORCE_IN = {1492, 1837, 1329}
FORCE_OUT = {2292: 'requires logged-in seller dashboard ("your sales dashboard")'}

def key(r):
    return hashlib.sha256(f"{SEED}:{r['ID']}".encode()).hexdigest()

picked, oos, seen = [], [], set()
for r in sorted(rows, key=key):
    d = dom(r['Starting URL'])
    if d in excluded or d in seen:
        continue
    seen.add(d)
    rid = int(r['ID'])
    m = None if rid in FORCE_IN else OOS.search(r['Task'].split('\n')[0])
    if r['Category'] != 'READ' or m or rid in FORCE_OUT:
        why = (r['Category'] if r['Category'] != 'READ'
               else 'manual: ' + FORCE_OUT[rid] if rid in FORCE_OUT else 'keyword: ' + m.group(0))
        oos.append((r, why))
        continue
    picked.append(r)
    if len(picked) >= N_PRIMARY + N_RESERVE:
        break

byid = {int(r['ID']): r for r in rows}
def tj(r):
    return {'id': int(r['ID']), 'startingUrl': r['Starting URL'], 'category': r['Category'], 'task': r['Task']}
last_primary = key(picked[N_PRIMARY - 1])
out = {
    '_source': 'inputs/webbenchfinal.csv = https://raw.githubusercontent.com/Halluminate/WebBench/main/webbenchfinal.csv '
               '(repo HEAD ea7a1628443321363989f354401f0653e0cba6f4, MIT, 818409 bytes, 2647 rows, fetched 2026-10-04)',
    '_inputs_sha256': PINNED,
    '_seed': SEED,
    '_rule': 'see protocol.md section 2',
    '_excluded_sha256': excl_hash,
    '_excluded': excluded_sorted,
    'primary': [tj(r) for r in picked[:N_PRIMARY]],
    'reserve': [tj(r) for r in picked[N_PRIMARY:]],
    'retest': [tj(byid[i]) for i in RETEST],
    'out_of_scope_drawn': [dict(tj(r), reason=why, beforeLastPrimary=key(r) < last_primary) for r, why in oos],
}
print(f'excluded domains: {len(excluded)} (sha256 {excl_hash})  eligible domains: {len({dom(r["Starting URL"]) for r in rows} - excluded)}', file=sys.stderr)
for i, r in enumerate(picked, 1):
    print(f"{'P' if i <= N_PRIMARY else 'R'}{i:02d}\t{r['ID']}\t{r['Starting URL']}", file=sys.stderr)
if args.out:
    committed = os.path.join(HERE, 'selection.json')
    if os.path.abspath(args.out) == os.path.abspath(committed) and not args.force:
        sys.exit('refusing to overwrite the committed selection.json without --force')
    with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
