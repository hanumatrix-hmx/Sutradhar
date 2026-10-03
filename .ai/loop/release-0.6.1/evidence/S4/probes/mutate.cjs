const fs = require('fs'); const [, , src, dst, id] = process.argv; let s = fs.readFileSync(src, 'utf8'); const o = s;
const M = {
  M1_null_scan_fail_open: ["if (f.commandLines === null) return { remove: false, reason: 'scan-unavailable' };", "if (f.commandLines === null) return { remove: true };"],
  M2_no_win_lockfile_probe: ["await rm(path.join(dir, 'lockfile'), { force: true });", "/* lockfile probe removed */"],
  M3_owner_alive_ignored: ["if (f.ownerAlive) return { remove: false, reason: 'owner-alive' };", "/* owner check removed */"],
  M4_age_ignored: ["if (f.minAgeMs > 0 && f.ageMs < f.minAgeMs)", "if (false)"],
  M5_scan_case_sensitive_kept: [".filter((l) => l.includes(TEMP_PROFILE_PREFIX));\n  }", ".filter((l) => l.includes(TEMP_PROFILE_PREFIX.toUpperCase()));\n  }"],
  M6_no_root_check: ["return norm(path.dirname(dir)) === norm(tmpRoot);", "return true;"],
};
const [a, b] = M[id]; if (!s.includes(a)) throw new Error('anchor missing ' + id); s = s.replace(a, b); fs.writeFileSync(dst, s); console.log('mutated', id);
