/**
 * @file packages/contracts/src/responses/api-responses.ts
 * @description API Response payload interfaces and generic wrappers.
 */

import { Timestamp } from '../shared/primitives.js';

export interface ApiResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly timestamp: Timestamp;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly statusCode: number;
    readonly timestamp: Timestamp;
    readonly details?: Record<string, unknown>;
  };
}

export function createSuccessResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function createErrorResponse(
  code: string,
  message: string,
  statusCode: number,
  details?: Record<string, unknown>,
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      statusCode,
      timestamp: new Date().toISOString(),
      ...(details ? { details } : {}),
    },
  };
}
