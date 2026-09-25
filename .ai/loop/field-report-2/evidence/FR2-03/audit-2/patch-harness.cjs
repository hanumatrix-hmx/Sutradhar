const fs=require('fs');const p=process.argv[2];let s=fs.readFileSync(p,'utf8');
const rep=(a,b)=>{if(!s.includes(a))throw new Error('missing: '+a.slice(0,80));s=s.replace(a,b);};
rep(`  const pidsBefore = new Set(procsFor(R, table()).map((p) => p.pid));`,`  const tblPre = table();\n  const pidsBefore = new Set(procsFor(R, tblPre).map((p) => p.pid));`);
rep(`  const fsDiff = Object.keys({ ...fs1, ...fs2 }).filter((k) => fs1[k] !== fs2[k]);
  writeFileSync(path.join(OUT, 'gc-dryrun.json'), dry.stdout);
  rec('D1-dry-run-mutates-nothing', 'fs snapshot (all non-live-profile paths) identical; same process set; exit 0', { code: dry.code, fsDiff, lostPids: [...pidsBefore].filter((p) => !pidsAfter.has(p)) }, dry.code === 0 && fsDiff.length === 0 && [...pidsBefore].every((p) => pidsAfter.has(p)));`,
`  const removedOrChanged = Object.keys(fs1).filter((k) => k !== T && fs1[k] !== fs2[k]);
  const added = Object.keys(fs2).filter((k) => !(k in fs1));
  writeFileSync(path.join(OUT, 'gc-dryrun.json'), dry.stdout);
  const lost = [...pidsBefore].filter((p) => !pidsAfter.has(p));
  const lostBrowsers = lost.filter((p) => tblPre.find((x) => x.pid === p && !x.cmd.includes('--type=')));
  rec('D1-dry-run-mutates-nothing', 'no pre-existing path under R removed/modified (TEMP own mtime excepted); no browser process vanished; exit 0; added files recorded as noise', { code: dry.code, removedOrChanged, added: added.map((f) => path.relative(R, f)), lostBrowsers, lostChildren: lost.length - lostBrowsers.length }, dry.code === 0 && removedOrChanged.length === 0 && lostBrowsers.length === 0);`);
rep(`  const tbl = table(); const byPid = new Map(tbl.map((p) => [p.pid, p]));
  const genuine = (pid) => { let p = byPid.get(pid); for (let h = 0; p && h < 12; h++) { const par = byPid.get(p.ppid); if (!par || par.t > p.t) return false; if (planKills.some((a) => a.role === 'browser' && a.pid === par.pid)) return true; p = par; } return false; };
  const badChildren = planKills.filter((a) => a.role === 'child' && !genuine(a.pid));`,
`  const tblPost = table(); const byPid = new Map([...tblPre, ...tblPost].map((p) => [p.pid, p]));
  const genuine = (pid) => { let p = byPid.get(pid); if (!p) return 'vanished'; for (let h = 0; p && h < 12; h++) { const par = byPid.get(p.ppid); if (!par) return 'no-parent'; if (par.t > p.t) return 'PARENT-YOUNGER-THAN-CHILD'; if (planKills.some((a) => a.role === 'browser' && a.pid === par.pid)) return 'ok'; p = par; } return 'no-browser-ancestor'; };
  const childVerdicts = planKills.filter((a) => a.role === 'child').map((a) => ({ pid: a.pid, v: genuine(a.pid), cmd: byPid.get(a.pid)?.cmd.slice(0, 90) }));
  const badChildren = childVerdicts.filter((c) => c.v !== 'ok' && c.v !== 'vanished');`);
rep(`{ badChildren }, badChildren.length === 0);`,`{ badChildren, childVerdicts }, badChildren.length === 0);`);
fs.writeFileSync(p,s);console.log('patched');
