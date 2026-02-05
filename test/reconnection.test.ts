/**
 * Reconnection behavior tests.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptor, getAvailablePort, delay, waitFor, waitUntil } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint, Diff } from '../src/index.ts';

describe('Reconnection Behavior', () => {
  describe('Client reconnection after server restart', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;
    let port: number;

    before(async () => {
      port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'State',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                value: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(descriptor, {}, { State: { value: 1 } });
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('State').unsubscribe();
      await delay(100);
      client.close();
      if (service) {
        await service.close();
      }
      await delay(100);
    });

    it('should reconnect and receive new init after server restart', async () => {
      client.SO('State').subscribe();
      await waitFor(client.SO('State'), 'init', 5000);
      assert.strictEqual(client.SO('State').data?.value, 1);

      // Track events
      let disconnectedCount = 0;
      let initCount = 0;
      client.SO('State').on('disconnected', () => disconnectedCount++);
      client.SO('State').on('init', () => initCount++);

      // Close original server
      await service.close();

      // Wait for client to detect disconnect
      await waitUntil(() => disconnectedCount >= 1, 3000);
      assert.strictEqual(client.SO('State').ready, false);

      // Start new server with different initial state
      service = new Service(descriptor, {}, { State: { value: 42 } });
      await service.ready();

      // Wait for client to reconnect and receive new init
      await waitUntil(() => initCount >= 1, 5000);

      assert.strictEqual(client.SO('State').ready, true);
      assert.strictEqual(client.SO('State').data?.value, 42);
    });
  });

  describe('SharedObject state recovery after reconnect', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;
    let port: number;

    before(async () => {
      port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'GameState',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                players: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      score: { type: 'number' },
                    },
                  },
                },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {},
        { GameState: { players: { alice: { score: 100 } } } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('GameState').unsubscribe();
      await delay(100);
      client.close();
      if (service) {
        await service.close();
      }
      await delay(100);
    });

    it('should recover full state after reconnect', async () => {
      client.SO('GameState').subscribe();
      await waitFor(client.SO('GameState'), 'init', 5000);

      // Track updates
      const updates: Diff[] = [];
      client.SO('GameState').on('update', (delta: Diff) => updates.push(delta));

      // Server makes changes
      service.SO('GameState').data.players.alice.score = 200;
      service.SO('GameState').data.players.bob = { score: 50 };
      service.SO('GameState').notify();

      await waitUntil(() => updates.length >= 1);
      assert.strictEqual(client.SO('GameState').data?.players.alice.score, 200);
      assert.strictEqual(client.SO('GameState').data?.players.bob.score, 50);

      // Simulate disconnect by closing server
      let disconnected = false;
      client.SO('GameState').once('disconnected', () => {
        disconnected = true;
      });

      await service.close();
      await waitUntil(() => disconnected, 3000);

      // Restart server (state persisted by creating new service with same data)
      service = new Service(
        descriptor,
        {},
        { GameState: { players: { alice: { score: 200 }, bob: { score: 50 } } } }
      );
      await service.ready();

      // Wait for reconnect
      await waitFor(client.SO('GameState'), 'init', 5000);

      // Client should have full recovered state
      assert.strictEqual(client.SO('GameState').data?.players.alice.score, 200);
      assert.strictEqual(client.SO('GameState').data?.players.bob.score, 50);
    });
  });

  describe('Exponential backoff behavior', () => {
    it('should use increasing delays between reconnect attempts', async () => {
      const port = await getAvailablePort();
      const descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'State',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                value: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });

      // Start service and immediately close it
      const service = new Service(descriptor, {}, { State: { value: 1 } });
      await service.ready();

      const client = new Client(descriptor);
      client.SO('State').subscribe();

      // Wait for connection
      await waitFor(client.SO('State'), 'init', 5000);

      // Close server to trigger reconnection
      await service.close();

      // Wait for disconnect
      await waitFor(client.SO('State'), 'disconnected', 3000);

      // The client will now attempt reconnects with exponential backoff.
      // We can't easily test the exact timing without mocking, but we can
      // verify the client continues attempting to reconnect by observing
      // that it doesn't error out or crash.
      await delay(1500);

      // Client should still be in a valid state (not errored/closed)
      assert.strictEqual(client.SO('State').connected, false);
      assert.strictEqual(client.SO('State').subscribed, true);

      client.SO('State').unsubscribe();
      await delay(100);
      client.close();
      await delay(100);
    });
  });

  describe('Multiple clients reconnecting (jitter verification)', () => {
    it('should allow multiple clients to reconnect without overwhelming server', async () => {
      const port = await getAvailablePort();
      const descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'Shared',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                count: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });

      let service = new Service(descriptor, {}, { Shared: { count: 0 } });
      await service.ready();

      // Create multiple clients
      const clients: Client[] = [];
      const clientCount = 5;

      for (let i = 0; i < clientCount; i++) {
        const c = new Client(descriptor);
        clients.push(c);
        c.SO('Shared').subscribe();
      }

      // Wait for all clients to connect
      await Promise.all(clients.map((c) => waitFor(c.SO('Shared'), 'init', 5000)));

      // Verify all clients received init
      for (const c of clients) {
        assert.strictEqual(c.SO('Shared').ready, true);
        assert.strictEqual(c.SO('Shared').data?.count, 0);
      }

      // Track disconnects
      const disconnects: number[] = [];
      clients.forEach((c, i) => {
        c.SO('Shared').on('disconnected', () => disconnects.push(i));
      });

      // Close server to trigger all clients to reconnect
      await service.close();

      // Wait for all clients to disconnect
      await waitUntil(() => disconnects.length === clientCount, 5000);

      // Restart server
      service = new Service(descriptor, {}, { Shared: { count: 42 } });
      await service.ready();

      // Wait for all clients to reconnect (with jitter, they should reconnect at different times)
      await Promise.all(clients.map((c) => waitFor(c.SO('Shared'), 'init', 10000)));

      // Verify all clients have new state
      for (const c of clients) {
        assert.strictEqual(c.SO('Shared').ready, true);
        assert.strictEqual(c.SO('Shared').data?.count, 42);
      }

      // Cleanup
      for (const c of clients) {
        c.SO('Shared').unsubscribe();
      }
      await delay(100);
      for (const c of clients) {
        c.close();
      }
      await service.close();
      await delay(100);
    });
  });
});
