/**
 * @file packages/cli/src/index.ts
 * @description Package entry point for @sutradhar/cli — mainly exists for the `sutradhar` bin;
 * exports the state helpers in case another package wants to inspect/drive CLI session state.
 */
export { readState, writeState, clearState, type CliState } from './state.js';
export type { CliHistoryLineV1 } from './history-file.js';
