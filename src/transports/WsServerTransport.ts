/**
 * Stub server transport using the `ws` package.
 *
 * This exists to allow swapping server transport implementations for future
 * performance comparisons. It is intentionally not implemented yet.
 */

import type { ServerTransport } from './ServerTransport.ts';

export class WsServerTransport implements ServerTransport<unknown> {
  onConnection(): void {
    // no-op
  }
  onDisconnection(): void {
    // no-op
  }
  onMessage(): void {
    // no-op
  }
  send(): void {
    // no-op
  }
  closeConnection(): void {
    // no-op
  }

  async listen(): Promise<void> {
    throw new Error('WsServerTransport not implemented yet');
  }

  async close(): Promise<void> {
    // no-op
  }
}

