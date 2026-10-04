// Harness-side preload (NOT product code): makes node-side os.homedir() return S7_FAKE_HOME, while leaving the
// USERPROFILE env var untouched, because Chrome cannot start when USERPROFILE is overridden (S7 scratch probe E1/E3/E4).
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
if (process.env.S7_FAKE_HOME) { const H = process.env.S7_FAKE_HOME; os.homedir = () => H; syncBuiltinESMExports(); }
