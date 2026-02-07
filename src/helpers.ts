/**
 * Utility functions.
 */

import { createHash } from 'crypto';
import type { EventEmitter } from 'events';
import type { ConnectionConfig, Endpoint } from './types.ts';

/**
 * Wait for an event to be emitted on an EventEmitter.
 *
 * @param emitter - The EventEmitter to listen on
 * @param event - The event name to wait for
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving to the event data
 */
export function waitFor<T = any>(
  emitter: EventEmitter,
  event: string,
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener(event, handler);
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    function handler(data: T) {
      clearTimeout(timer);
      resolve(data);
    }

    emitter.once(event, handler);
  });
}

/**
 * Promise-based delay.
 *
 * @param ms - Delay in milliseconds
 * @returns Promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate a transport connection config object at runtime.
 *
 * @param value - Candidate value
 * @param fieldName - Logical field path for clear error messages
 * @returns Normalized connection config
 */
export function validateConnectionConfig(value: unknown, fieldName: string): ConnectionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object with host and port`);
  }

  const candidate = value as Partial<ConnectionConfig>;

  if (typeof candidate.host !== 'string' || candidate.host.trim() === '') {
    throw new Error(`${fieldName}.host must be a non-empty string`);
  }
  const host = candidate.host;

  const port = candidate.port;
  if (typeof port !== 'number' || !Number.isInteger(port)) {
    throw new Error(`${fieldName}.port must be an integer`);
  }

  if (port < 1 || port > 65535) {
    throw new Error(`${fieldName}.port must be between 1 and 65535`);
  }

  return { host, port };
}

/**
 * JSON.stringify with sorted keys so property order doesn't affect the output.
 */
function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        sorted[k] = val[k];
      }
      return sorted;
    }
    return val;
  });
}

/**
 * Compute hash of endpoints for descriptor validation.
 * Only hashes endpoints, not transport config, so clients can use different hostnames.
 * Uses canonical (sorted-key) serialisation so property order is irrelevant.
 *
 * @param endpoints - Array of endpoint definitions
 * @returns SHA-256 hash of the endpoints
 */
export function computeEndpointsHash(endpoints: Endpoint[]): string {
  const json = canonicalStringify(endpoints);
  return createHash('sha256').update(json).digest('hex');
}
