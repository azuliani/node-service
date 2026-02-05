/**
 * Test utilities for port allocation and descriptor creation.
 */

import type { Descriptor, Endpoint } from '../src/types.ts';

/**
 * Options for createDescriptor helper.
 */
export interface CreateDescriptorOptions {
  /** Endpoints to include in the descriptor */
  endpoints?: Endpoint[];
  /** Hostname to use (default: 127.0.0.1) */
  hostname?: string;
}

/**
 * Create a descriptor for testing with the URL-based transport.
 *
 * @param port - Port number for the server
 * @param options - Endpoint options
 * @returns A Descriptor configured with the URL transport
 */
export function createDescriptor(port: number, options: CreateDescriptorOptions = {}): Descriptor {
  const { endpoints = [], hostname = '127.0.0.1' } = options;

  return {
    transport: {
      server: `${hostname}:${port}`,
      client: `${hostname}:${port}`,
    },
    endpoints,
  };
}

// Port allocation: simple incrementing counter with time-based starting offset.
// The offset ensures rapid test re-runs don't collide (avoids TIME_WAIT issues).
let portCounter = 0;
const PORT_RANGE_START = 10000;
const PORT_RANGE_SIZE = 50000; // 10000-59999
const startOffset = Date.now() % PORT_RANGE_SIZE;

/**
 * Get a unique port number for testing.
 *
 * @returns Promise resolving to a unique port number
 */
export async function getAvailablePort(): Promise<number> {
  const port = PORT_RANGE_START + ((startOffset + portCounter++) % PORT_RANGE_SIZE);
  return port;
}

/**
 * Create a descriptor for testing with a dynamically allocated port.
 *
 * @param options - Endpoint options
 * @returns A Descriptor configured with the URL transport and a unique port
 */
export async function createDescriptorAsync(
  options: CreateDescriptorOptions = {}
): Promise<Descriptor> {
  const port = await getAvailablePort();
  return createDescriptor(port, options);
}

/**
 * Wait for an event to be emitted on an EventEmitter.
 *
 * @param emitter - The EventEmitter to listen on
 * @param event - The event name to wait for
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving to the event data
 */
export function waitFor<T = any>(
  emitter: { once: (event: string, handler: (data: T) => void) => void; removeListener: (event: string, handler: any) => void },
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
 * Wait until a condition becomes true, with polling and timeout.
 *
 * More reliable than fixed delays for tests that check state conditions.
 *
 * @param condition - Function that returns true when condition is met
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 * @param pollInterval - How often to check condition in milliseconds (default: 10)
 * @returns Promise that resolves when condition is true, rejects on timeout
 */
export async function waitUntil(
  condition: () => boolean,
  timeout = 5000,
  pollInterval = 10
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timeout waiting for condition after ${timeout}ms`);
    }
    await delay(pollInterval);
  }
}
