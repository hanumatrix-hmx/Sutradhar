/**
 * @file packages/contracts/tests/unit/dto.spec.ts
 * @description Unit tests for DTO contracts, requests, and response creators.
 */

import {
  createSuccessResponse,
  createErrorResponse,
  ApiResponse,
  ApiErrorResponse,
} from '../../src/responses/index.js';

describe('Canonical DTOs & API Response Wrappers', () => {
  it('should instantiate ApiResponse via createSuccessResponse helper', () => {
    const payload = { sessionId: 'sess_100', active: true };
    const response: ApiResponse<typeof payload> = createSuccessResponse(payload);

    expect(response.success).toBe(true);
    expect(response.data).toEqual(payload);
    expect(typeof response.timestamp).toBe('string');
  });

  it('should instantiate ApiErrorResponse via createErrorResponse helper', () => {
    const errorResponse: ApiErrorResponse = createErrorResponse(
      'ERR_NOT_FOUND',
      'Session not found',
      404,
      { id: 'sess_100' },
    );

    expect(errorResponse.success).toBe(false);
    expect(errorResponse.error.code).toBe('ERR_NOT_FOUND');
    expect(errorResponse.error.statusCode).toBe(404);
    expect(errorResponse.error.message).toBe('Session not found');
    expect(errorResponse.error.details).toEqual({ id: 'sess_100' });
    expect(typeof errorResponse.error.timestamp).toBe('string');
  });
});
