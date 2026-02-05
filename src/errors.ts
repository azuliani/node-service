/**
 * Structured error classes for the messaging library.
 */

/**
 * Error codes used throughout the library.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  DESCRIPTOR_MISMATCH: 'DESCRIPTOR_MISMATCH',
  MISSING_HANDLER: 'MISSING_HANDLER',
  UNKNOWN_ENDPOINT: 'UNKNOWN_ENDPOINT',
} as const;

/**
 * Type representing valid error codes.
 */
export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Base error class with code property.
 */
abstract class BaseError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Serialize error for RPC transmission.
   */
  toJSON() {
    return {
      message: this.message,
      name: this.name,
      code: this.code,
      stack: this.stack,
    };
  }
}

/**
 * Thrown when schema validation fails.
 */
export class ValidationError extends BaseError {
  readonly code = 'VALIDATION_FAILED' as const;

  constructor(message: string) {
    super(`Validation failed! ${message}`);
  }
}

/**
 * Thrown when an operation times out.
 */
export class TimeoutError extends BaseError {
  readonly code = 'TIMEOUT' as const;

  constructor(message = 'Request timed out') {
    super(message);
  }
}

/**
 * Thrown when a connection fails.
 */
export class ConnectionError extends BaseError {
  readonly code = 'CONNECTION_FAILED' as const;

  constructor(message = 'Connection failed') {
    super(message);
  }
}

/**
 * Thrown when version numbers don't match expected sequence.
 */
export class VersionMismatchError extends BaseError {
  readonly code = 'VERSION_MISMATCH' as const;

  constructor(expected: number, received: number) {
    super(`Version mismatch: expected ${expected}, received ${received}`);
  }
}

/**
 * Thrown when client and server descriptors don't match.
 */
export class DescriptorMismatchError extends BaseError {
  readonly code = 'DESCRIPTOR_MISMATCH' as const;

  constructor(message = 'Client and server descriptors do not match') {
    super(message);
  }
}

/**
 * Thrown when an RPC handler is missing for an endpoint.
 */
export class MissingHandlerError extends BaseError {
  readonly code = 'MISSING_HANDLER' as const;

  constructor(endpointName: string) {
    super(`Missing handler for RPC endpoint: ${endpointName}`);
  }
}

/**
 * Thrown when an unknown endpoint is requested.
 */
export class UnknownEndpointError extends BaseError {
  readonly code = 'UNKNOWN_ENDPOINT' as const;

  constructor(endpointName: string) {
    super(`Unknown endpoint: ${endpointName}`);
  }
}

/**
 * Type guard for errors with a code property.
 */
export function hasErrorCode(err: unknown): err is Error & { code: string } {
  return err instanceof Error && 'code' in err && typeof err.code === 'string';
}

/**
 * Extract error code safely, returning undefined if not present.
 */
export function getErrorCode(err: unknown): string | undefined {
  if (hasErrorCode(err)) {
    return err.code;
  }
  return undefined;
}
