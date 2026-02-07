/**
 * SharedObject init timeout with exponential backoff and max retry limit.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { Client } from '../src/index.ts';
import { getAvailablePort, waitFor } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint, ClientTransport } from '../src/index.ts';

/**
 * A fake client transport that immediately reports "connected" and ignores
 * all outgoing messages. This lets us test init-timeout retries in isolation
 * because the server never sends an init frame.
 */
class FakeTransport implements ClientTransport {
  private _openCbs: (() => void)[] = [];
  private _closeCbs: ((code: number, reason: string) => void)[] = [];
  private _errorCbs: ((err: Error) => void)[] = [];
  private _messageCbs: ((text: string) => void)[] = [];
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    this._connected = true;
    // Deliver the open event asynchronously (like a real transport would).
    queueMicrotask(() => {
      for (const cb of this._openCbs) cb();
    });
  }

  close(): void {
    this._connected = false;
  }

  send(): void {
    // Swallow all outgoing frames — no server to respond.
  }

  onOpen(cb: () => void): void { this._openCbs.push(cb); }
  onClose(cb: (code: number, reason: string) => void): void { this._closeCbs.push(cb); }
  onError(cb: (err: Error) => void): void { this._errorCbs.push(cb); }
  onMessage(cb: (text: string) => void): void { this._messageCbs.push(cb); }
}

describe('SharedObject init timeout backoff', () => {
  let client: Client;

  after(() => {
    if (client) client.close();
  });

  it('should emit error after max retries when init never arrives', async () => {
    const port = await getAvailablePort();
    const descriptor: Descriptor = {
      transport: {
        server: { host: '127.0.0.1', port },
        client: { host: '127.0.0.1', port },
      },
      endpoints: [
        {
          name: 'State',
          type: 'SharedObject',
          objectSchema: {
            type: 'object',
            properties: { value: { type: 'number' } },
          },
        } as SharedObjectEndpoint,
      ],
    };

    const transport = new FakeTransport();

    // Use a very short initTimeout so the 5 retries complete quickly.
    // Backoff sequence: 50, 100, 200, 400, 800 => total ~1550ms
    client = new Client(descriptor, { initTimeout: 50, clientTransport: transport });

    const so = client.SO('State');
    const errorPromise = waitFor(so, 'error', 15000);

    // subscribe() starts the init timeout loop since FakeTransport is connected.
    so.subscribe().catch(() => {
      // Expected: the subscribe promise is rejected after max retries.
    });

    const error = await errorPromise;
    assert.ok(error instanceof Error, 'Should receive an Error instance');
    assert.ok(
      error.message.includes('retries'),
      `Expected error about retries, got: ${error.message}`
    );
  });

  it('should reject the subscribe promise after max retries', async () => {
    const port = await getAvailablePort();
    const descriptor: Descriptor = {
      transport: {
        server: { host: '127.0.0.1', port },
        client: { host: '127.0.0.1', port },
      },
      endpoints: [
        {
          name: 'State2',
          type: 'SharedObject',
          objectSchema: {
            type: 'object',
            properties: { value: { type: 'number' } },
          },
        } as SharedObjectEndpoint,
      ],
    };

    const transport = new FakeTransport();
    const client2 = new Client(descriptor, { initTimeout: 50, clientTransport: transport });

    const so = client2.SO('State2');

    // Suppress unhandled error event
    so.on('error', () => {});

    await assert.rejects(
      () => so.subscribe(),
      (err: Error) => {
        assert.ok(err.message.includes('retries'));
        return true;
      }
    );

    client2.close();
  });
});
