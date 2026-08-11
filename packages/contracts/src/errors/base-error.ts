/**
 * @file packages/contracts/src/errors/base-error.ts
 * @description Abstract base class for all PinchTab domain errors.
 */

import { Timestamp } from '../shared/primitives.js';

export interface ErrorJsonRepresentation {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly statusCode: number;
  readonly timestamp: Timestamp;
  readonly details?: Record<string, unknown>;
}

export abstract class BaseDomainError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;
  public readonly timestamp: Timestamp;

  public constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();

    // Maintain correct prototype chain in V8 environments
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): ErrorJsonRepresentation {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
