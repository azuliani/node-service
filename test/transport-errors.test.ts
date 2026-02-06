/**
 * Transport error handling tests.
 *
 * Verifies that the mux layer gracefully handles malformed JSON
 * by closing only the offending connection without crashing.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';
import { Service, Client } from '../src/index.ts';
import { getAvailablePort, delay } from './helpers.ts';
import type { Descriptor, RPCEndpoint } from '../src/index.ts';

describe('Transport Error Handling', () => {
  describe('Malformed JSON resilience', () => {
    let service: Service;
    let port: number;
    let descriptor: Descriptor;

    before(async () => {
      port = await getAvailablePort();
      descriptor = {
        transport: {
          server: `127.0.0.1:${port}`,
          client: `127.0.0.1:${port}`,
        },
        endpoints: [
          {
            name: 'echo',
            type: 'RPC',
            requestSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
            replySchema: { type: 'string' },
          } as RPCEndpoint,
        ],
      };

      service = new Service(
        descriptor,
        { echo: async ({ msg }: { msg: string }) => msg },
        {}
      );
      await service.ready();
    });

    after(async () => {
      await service.close();
      await delay(50);
    });

    it('should survive malformed JSON without crashing', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      await new Promise<void>((resolve) => ws.on('open', resolve));

      // Send malformed JSON — the server should not crash.
      ws.send('not valid json');

      // Wait for the server to process the message.
      await delay(100);

      // The server is still alive if we can create a new client and call RPC.
      const client = new Client(descriptor);
      await delay(100);
      const reply = await client.RPC('echo').call<{ msg: string }, string>({ msg: 'hello' });
      assert.strictEqual(reply, 'hello');

      client.close();
      ws.close();
    });

    it('should close the bad connection with code 1002', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      await new Promise<void>((resolve) => ws.on('open', resolve));

      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      ws.send('{{bad json}}');

      const { code, reason } = await closePromise;
      assert.strictEqual(code, 1002);
      assert.strictEqual(reason, 'Malformed JSON');
    });

    it('should not affect other clients after bad JSON', async () => {
      // Connect a good client first.
      const goodClient = new Client(descriptor);
      await delay(100);

      // Send malformed JSON from a raw WebSocket.
      const badWs = new WebSocket(`ws://127.0.0.1:${port}/`);
      await new Promise<void>((resolve) => badWs.on('open', resolve));
      badWs.send('not json');
      await delay(100);

      // Good client should still work.
      const reply = await goodClient.RPC('echo').call<{ msg: string }, string>({ msg: 'still works' });
      assert.strictEqual(reply, 'still works');

      goodClient.close();
      badWs.close();
    });
  });
});
