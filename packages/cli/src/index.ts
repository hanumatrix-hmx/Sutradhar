/**
 * @file packages/cli/src/index.ts
 * @description Package entry point for @pinchtab/cli — mainly exists for the `pinchtab` bin;
 * exports the state helpers in case another package wants to inspect/drive CLI session state.
 */
export { readState, writeState, clearState, type CliState } from './state.js';
