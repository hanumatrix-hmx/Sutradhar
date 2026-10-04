// Page server for the S7 harness, run as a CHILD process (spawnSync in the harness would block an in-process
// server). Prints "PORT <n>" on stdout, serves on 127.0.0.1 only, exits when its stdin closes or after 40 min.
import http from 'node:http';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/c') res.end("<!doctype html><title>s7c</title><p>confirm soon</p><script>setTimeout(function(){confirm('s7 confirm on load')},300)</script>");
  else res.end(`<!doctype html><title>s7 ${u.searchParams.get('n') ?? ''}</title><p>ok</p>`);
});
server.listen(0, '127.0.0.1', () => console.log(`PORT ${server.address().port}`));
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
setTimeout(() => process.exit(0), 40 * 60_000).unref();
