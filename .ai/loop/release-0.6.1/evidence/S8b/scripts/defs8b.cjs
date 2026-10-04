// S8b mutant set = the S8 auditor's 41 definitions (evidence/S8/mutants-s8.cjs, re-run as-is) MINUS its M-O1/M-O6 (anchors
// moved by S6g / superseded) PLUS the auditor-S8b-written M-O1 (post-S6g anchors), M-O6 placements i-v (S6f), M-B2a..g incl.
// d2/e2 (S6g / plan-review-B F2/F7) and the S6h deadline mutants M-b/M-b2/M-b4 (T5 must fail).
const s8 = require('E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/.ai/loop/release-0.6.1/evidence/S8/mutants-s8.cjs');
const CS = 'src/close-session.ts', CLI = 'src/cli.ts', TP = 'src/temp-profile.ts';
const ALL = ['tests/unit/temp-profile.spec.ts', 'tests/unit/scan-command-lines.spec.ts', 'tests/unit/system-binaries.spec.ts', 'tests/unit/close-session.spec.ts', 'tests/unit/spawn-failure-cleanup.spec.ts'];
const TRAIL = '    await clearState(); // still runs for BOTH no-chromePid paths, including dialog-blocked (legacy state files)';
const B = '(b) exactly one clearState(';
const SH = 'self-heal: the call is not followed', CC = 'cmdClose: the call is not followed';
const BT = String.fromCharCode(96);
const CLEANUP_CATCH = '    } catch (err) {\n      warn(' + BT + 'Warning: temp profile cleanup failed';
const mine = [];
mine.push({ id: 'BASELINE', desc: 'no change (the copy must be green)', specs: ALL, edits: [] });
mine.push({ id: 'M-O1-s6g', desc: 'clearState moved after the cleanup (post-S6g anchors)', specs: ALL, mustFail: ['O1:', 'O2:'], edits: [
  { file: CS, from: "    await deps.clearState();\n    debug('[cleanup] state-cleared');", to: "    debug('[cleanup] state-cleared');" },
  { file: CS, from: '\n  if (clearFailed) throw clearError;', to: '\n  await deps.clearState();\n  if (clearFailed) throw clearError;' }] });
mine.push({ id: 'M-O6-i', desc: 'no-chromePid clear = LAST statement inside if (!closeBlocked) {}', specs: ALL, mustFail: [B], edits: [{ file: CLI, from: '      }\n    }\n' + TRAIL, to: '      }\n      await clearState();\n    }' }] });
mine.push({ id: 'M-O6-ii', desc: 'clear inside the nested try (after shutdown)', specs: ALL, mustFail: [B], edits: [{ file: CLI, from: '\n' + TRAIL, to: '' }, { file: CLI, from: '        await runtime.shutdown(sessionId);\n      } catch {', to: '        await runtime.shutdown(sessionId);\n        await clearState();\n      } catch {' }] });
mine.push({ id: 'M-O6-iii', desc: 'clear = FIRST statement after the { of if (!closeBlocked)', specs: ALL, mustFail: [B], edits: [{ file: CLI, from: '\n' + TRAIL, to: '' }, { file: CLI, from: '    if (!closeBlocked) {\n      // FR2-04 N11:', to: '    if (!closeBlocked) {\n      await clearState();\n      // FR2-04 N11:' }] });
mine.push({ id: 'M-O6-iv', desc: 'clear inside the catch {} of the nested try', specs: ALL, mustFail: [B], edits: [{ file: CLI, from: '\n' + TRAIL, to: '' }, { file: CLI, from: '        // Already gone (browser closed externally, etc.)', to: '        await clearState();\n        // Already gone (browser closed externally, etc.)' }] });
mine.push({ id: 'M-O6-v', desc: 'clear BEFORE if (!closeBlocked) inside the else', specs: ALL, mustFail: [B], edits: [{ file: CLI, from: '\n' + TRAIL, to: '' }, { file: CLI, from: '  } else {\n    if (!closeBlocked) {', to: '  } else {\n    await clearState();\n    if (!closeBlocked) {' }] });
const OLDWARN = '    warn(' + BT + 'Warning: could not clear the session state ($' + '{msg(err)}); run "sutradhar close" again if the next command misbehaves.' + BT + ');';
mine.push({ id: 'M-B2a-swallow', desc: 'the clearState error is never rethrown', specs: ALL, mustFail: ['G6g-1 (AC1)', 'G6g-3', 'G6g-4', 'G6g-5', 'G6g-6'], edits: [{ file: CS, from: '  if (clearFailed) throw clearError;\n', to: '' }] });
mine.push({ id: 'M-B2a-old-warn', desc: 'the exact pre-S6g behaviour: warn and continue', specs: ALL, mustFail: ['G6g-1 (AC1)'], edits: [{ file: CS, from: '    clearFailed = true;\n    clearError = err;', to: OLDWARN }] });
mine.push({ id: 'M-B2b', desc: 'rethrow BEFORE the cleanup', specs: ALL, mustFail: ['G6g-1 (AC1)', 'G6g-1b'], edits: [{ file: CS, from: '    clearError = err;\n  }', to: '    clearError = err;\n    throw err;\n  }' }] });
mine.push({ id: 'M-B2c', desc: 'rethrow a wrapped/different error', specs: ALL, mustFail: ['G6g-1 (AC1)', 'G6g-6'], edits: [{ file: CS, from: '  if (clearFailed) throw clearError;', to: '  if (clearFailed) throw new Error(msg(clearError));' }] });
const SHC = '      await stopSpawnedChrome(state, sessionStopDeps());\n      return spawnFreshSession';
const CCC = '    await stopSpawnedChrome(state, sessionStopDeps());\n  } else {';
mine.push({ id: 'M-B2d', desc: 'self-heal call site swallows via .catch', specs: ALL, mustFail: [SH], edits: [{ file: CLI, from: SHC, to: '      await stopSpawnedChrome(state, sessionStopDeps()).catch(() => {});\n      return spawnFreshSession' }] });
mine.push({ id: 'M-B2e', desc: 'cmdClose call site swallows via .catch', specs: ALL, mustFail: [CC], edits: [{ file: CLI, from: CCC, to: '    await stopSpawnedChrome(state, sessionStopDeps()).catch(() => {});\n  } else {' }] });
mine.push({ id: 'M-B2d2', desc: 'self-heal call site inside try {} catch {}', specs: ALL, mustFail: [SH], edits: [{ file: CLI, from: SHC, to: '      try {\n        await stopSpawnedChrome(state, sessionStopDeps());\n      } catch {}\n      return spawnFreshSession' }] });
mine.push({ id: 'M-B2e2', desc: 'cmdClose call site inside try {} catch {}', specs: ALL, mustFail: [CC], edits: [{ file: CLI, from: CCC, to: '    try {\n      await stopSpawnedChrome(state, sessionStopDeps());\n    } catch {}\n  } else {' }] });
mine.push({ id: 'M-B2f1', desc: 'when both fail, the CLEANUP error is thrown instead of the clearState error', specs: ALL, mustFail: ['G6g-3'], edits: [{ file: CS, from: CLEANUP_CATCH, to: '    } catch (err) {\n      if (clearFailed) throw err;\n      warn(' + BT + 'Warning: temp profile cleanup failed' }] });
mine.push({ id: 'M-B2f2', desc: 'the rethrow is skipped when the cleanup fails', specs: ALL, mustFail: ['G6g-3'], edits: [{ file: CS, from: CLEANUP_CATCH, to: '    } catch (err) {\n      clearFailed = false;\n      warn(' + BT + 'Warning: temp profile cleanup failed' }] });
mine.push({ id: 'M-B2g', desc: 'rethrow only on the tempProfile path', specs: ALL, mustFail: ['G6g-4'], edits: [{ file: CS, from: '\n  if (clearFailed) throw clearError;\n', to: '\n' }, { file: CS, from: 'will retry it.' + BT + ');\n    }\n  }', to: 'will retry it.' + BT + ');\n    }\n    if (clearFailed) throw clearError;\n  }' }] });
mine.push({ id: 'M-b2', desc: 'deadline check at MIN_RM_START_MS / 2', specs: ALL, mustFail: ['T5:'], edits: [{ file: TP, from: '    if (remaining < MIN_RM_START_MS) {', to: '    if (remaining < MIN_RM_START_MS / 2) {' }] });
mine.push({ id: 'M-b4', desc: 'the rm-attempt debug line removed (T5 must not pass vacuously)', specs: ALL, mustFail: ['T5:'], edits: [{ file: TP, from: "    dlog('rm-attempt', { path: dir, n, 'remaining-ms': Math.round(remaining) });\n", to: '' }] });
const kept = s8.filter((m) => m.id !== 'M-O1' && m.id !== 'M-O6').map((m) => (m.id === 'M-b' ? { ...m, mustFail: ['T5:'] } : m));
module.exports = [...mine, ...kept];
