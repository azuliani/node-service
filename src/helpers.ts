/**
 * Utility functions.
 */

import { createHash } from 'crypto';
import type { EventEmitter } from 'events';
import type { Endpoint } from './types.ts';

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
 * Parse host and port from a URL string.
 * Accepts formats: "host:port", "0.0.0.0:3000", "localhost:3000"
 *
 * @param url - URL in format "host:port"
 * @returns Object with host and port
 */
export function parseHostPort(url: string): { host: string; port: number } {
  const parts = url.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid URL format: ${url}. Expected "host:port"`);
  }
  const host = parts[0];
  const port = parseInt(parts[1], 10);
  if (isNaN(port)) {
    throw new Error(`Invalid port in URL: ${url}`);
  }
  return { host, port };
}

/**
 * Compute hash of endpoints for descriptor validation.
 * Only hashes endpoints, not transport config, so clients can use different hostnames.
 *
 * @param endpoints - Array of endpoint definitions
 * @returns SHA-256 hash of the endpoints
 */
export function computeEndpointsHash(endpoints: Endpoint[]): string {
  const json = JSON.stringify(endpoints);
  return createHash('sha256').update(json).digest('hex');
}
