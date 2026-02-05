/**
 * Transport error handling tests.
 *
 * The mux layer intentionally parses JSON without guards to crash fast on
 * malformed payloads (protocol bugs should be loud).
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';
import { Service } from '../src/Service.ts';
import { getAvailablePort, delay } from './helpers.ts';
import type { Descriptor, PubSubEndpoint } from '../src/index.ts';

describe('Transport Error Handling', () => {
  describe('Mux crashes on bad JSON', () => {
    let service: Service;
    let port: number;

    before(async () => {
      port = await getAvailablePort();
      const descriptor: Descriptor = {
        transport: {
          server: `127.0.0.1:${port}`,
          client: `127.0.0.1:${port}`,
        },
        endpoints: [
          {
            name: 'Events',
            type: 'PubSub',
            messageSchema: { type: 'string' },
          } as PubSubEndpoint,
        ],
      };

      service = new Service(descriptor, {}, {});
      await service.ready();
    });

    after(async () => {
      await service.close();
      await delay(50);
    });

    it('should throw uncaughtException when receiving malformed JSON', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      await new Promise<void>((resolve) => ws.on('open', resolve));

      // Capture the uncaught error.
      let uncaughtError: Error | null = null;
      const originalListeners = process.listeners('uncaughtException');

      // Temporarily replace handlers.
      process.removeAllListeners('uncaughtException');
      process.once('uncaughtException', (err) => {
        uncaughtError = err;
      });

      ws.send('not valid json');
      await delay(100);

      // Restore original listeners.
      for (const listener of originalListeners) {
        process.on('uncaughtException', listener);
      }

      assert.ok(uncaughtError instanceof SyntaxError);
      assert.ok(uncaughtError!.message.includes('JSON'));

      ws.close();
    });
  });
});
