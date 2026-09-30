#!/bin/bash
# Fresh, hand-driven re-query of the final build (independent of verify-fr2-11-history.mjs): a real CLI session against a local
# HTTP fixture, secrets in a URL query, a URL fragment, typed text, clipboard text and eval code; then the RAW bytes of history.jsonl
# and both `history` outputs are searched for those secrets, a torn line is appended, and the file is re-read.
W="$(cygpath -m "$1")"
CLI="node $W/packages/cli/dist/cli.js"
SD="$(cygpath -m "$(mktemp -d)")"
export SUTRADHAR_CLI_STATE_DIR="$SD/state"
cd "$SD"
node -e "
const http=require('http'),fs=require('fs');
const html=fs.readFileSync('$W/tools/scenario-suite/fixtures/fr2-11-history.html');
const s=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(html)}).listen(0,'127.0.0.1',()=>{fs.writeFileSync('$SD/port',String(s.address().port))});
setTimeout(()=>process.exit(0),240000);" &
SRV=$!
echo "fixture server pid=$SRV"
for i in $(seq 1 50); do [ -f "$SD/port" ] && break; sleep 0.2; done
PORT=$(cat "$SD/port")
URL="http://127.0.0.1:$PORT/fr2-11-history.html?n=PROBE&token=SECRET-PROBE"
echo "== commands"
$CLI nav "$URL#access_token=FRAG-SECRET-PROBE"; echo "exit=$?"
$CLI type '#name' 'hunter2-PROBE'; echo "exit=$?"
$CLI setclipboard 'CLIP-SECRET-PROBE'; echo "exit=$?"
$CLI eval "document.title + ' https://t.test/?k=SECRET-EV'"; echo "exit=$?"
$CLI click '#nope-does-not-exist' ; echo "exit=$?"
echo "== files in the state dir"; ls "$SD/state"
echo "== RAW history.jsonl secret search (expect 0 matches for each)"
for s in SECRET hunter2 'token=' '?n=' access_token FRAG; do printf "%-14s %s\n" "$s" "$(grep -c -F -- "$s" "$SD/state/history.jsonl")"; done
echo "== history.jsonl line count / sizes"; wc -l "$SD/state/history.jsonl"
echo "== history (human)"; $CLI history
echo "== history --json | identical to the file?"
$CLI history --json > "$SD/json.out"; cmp <(tr -d '\r' < "$SD/json.out") <(tr -d '\r' < "$SD/state/history.jsonl") && echo "BYTE-IDENTICAL"
echo "== torn last line appended, then history again"
printf '{"v":1,"type":"comm' >> "$SD/state/history.jsonl"
$CLI history --json | wc -l; $CLI history --json 2>&1 >/dev/null | head -2
$CLI text > /dev/null; echo "text exit=$?"
echo "== after one more command the file is still parseable line by line (1 torn line expected)"
node -e "
const l=require('fs').readFileSync('$SD/state/history.jsonl','utf8').split('\n').filter(Boolean);
let bad=0,ok=0;for(const x of l){try{JSON.parse(x);ok++}catch{bad++}}console.log('valid',ok,'unparsable',bad)"
$CLI close; echo "close exit=$?"
echo "== after close: state.json gone, history.jsonl still there"; ls "$SD/state"
kill $SRV 2>/dev/null
cd /; rm -rf "$SD"
echo done
