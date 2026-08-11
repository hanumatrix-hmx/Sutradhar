/**
 * @file packages/contracts/tests/unit/errors.spec.ts
 * @description Unit tests for standard domain error hierarchy.
 */

import {
  BaseDomainError,
  NotFoundError,
  ValidationError,
  ProviderError,
  PolicyViolationError,
  TimeoutError,
  SessionClosedError,
  CapabilityMismatchError,
  ConflictError,
  InternalServerError,
} from '../../src/errors/index.js';

describe('Standard Domain Error Hierarchy', () => {
  it('should instantiate BaseDomainError subclass cleanly with details', () => {
    const error = new NotFoundError('Session not found', { sessionId: 'sess_123' });

    expect(error).toBeInstanceOf(BaseDomainError);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.name).toBe('NotFoundError');
    expect(error.code).toBe('ERR_NOT_FOUND');
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Session not found');
    expect(error.details).toEqual({ sessionId: 'sess_123' });
    expect(typeof error.timestamp).toBe('string');
  });

  it('should serialize error to JSON format correctly', () => {
    const error = new ValidationError('Invalid request payload', { field: 'url' });
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'ValidationError',
      code: 'ERR_VALIDATION_FAILED',
      message: 'Invalid request payload',
      statusCode: 400,
      timestamp: error.timestamp,
      details: { field: 'url' },
    });
  });

  it('should map status codes and error codes for all error subclasses', () => {
    expect(new NotFoundError('msg').statusCode).toBe(404);
    expect(new ValidationError('msg').statusCode).toBe(400);
    expect(new ProviderError('msg').statusCode).toBe(502);
    expect(new PolicyViolationError('msg').statusCode).toBe(403);
    expect(new TimeoutError('msg').statusCode).toBe(504);
    expect(new SessionClosedError('msg').statusCode).toBe(410);
    expect(new CapabilityMismatchError('msg').statusCode).toBe(422);
    expect(new ConflictError('msg').statusCode).toBe(409);
    expect(new InternalServerError('msg').statusCode).toBe(500);
  });
});
