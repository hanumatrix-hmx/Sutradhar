/**
 * @file packages/capability-runtime/src/echo.ts
 * @description Re-export of the ONE echo choke point, which lives in `@sutradhar/utils` so that
 * `@sutradhar/browser` (a lower layer) can use it too (A3-1). Do not add a second implementation.
 */
export { echo, echoPath, echoValue, echoList, ECHO_MAX, ECHO_PATH_MAX, ECHO_LIST_MAX } from '@sutradhar/utils';
