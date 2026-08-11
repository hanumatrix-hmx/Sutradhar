/**
 * @file packages/contracts/src/errors/domain-errors.ts
 * @description Standard concrete domain error classes for PinchTab.
 */

import { BaseDomainError } from './base-error.js';

export class NotFoundError extends BaseDomainError {
  public readonly code = 'ERR_NOT_FOUND';
  public readonly statusCode = 404;
}

export class ValidationError extends BaseDomainError {
  public readonly code = 'ERR_VALIDATION_FAILED';
  public readonly statusCode = 400;
}

export class ProviderError extends BaseDomainError {
  public readonly code = 'ERR_PROVIDER_FAILED';
  public readonly statusCode = 502;
}

export class PolicyViolationError extends BaseDomainError {
  public readonly code = 'ERR_POLICY_VIOLATION';
  public readonly statusCode = 403;
}

export class TimeoutError extends BaseDomainError {
  public readonly code = 'ERR_TIMEOUT';
  public readonly statusCode = 504;
}

export class SessionClosedError extends BaseDomainError {
  public readonly code = 'ERR_SESSION_CLOSED';
  public readonly statusCode = 410;
}

export class CapabilityMismatchError extends BaseDomainError {
  public readonly code = 'ERR_CAPABILITY_MISMATCH';
  public readonly statusCode = 422;
}

export class ConflictError extends BaseDomainError {
  public readonly code = 'ERR_CONFLICT';
  public readonly statusCode = 409;
}

export class InternalServerError extends BaseDomainError {
  public readonly code = 'ERR_INTERNAL';
  public readonly statusCode = 500;
}
