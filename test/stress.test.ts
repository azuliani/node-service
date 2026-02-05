/**
 * Stress tests for high-load scenarios.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, delay, waitFor, waitUntil } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint, PubSubEndpoint, RPCEndpoint, Diff } from '../src/index.ts';

describe('Stress Tests', () => {
  describe('High-frequency SharedObject updates', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Counter',
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
      service = new Service(descriptor, {}, { Counter: { value: 0 } });
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('Counter').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should handle rapid sequential updates', async () => {
      client.SO('Counter').subscribe();
      await waitFor(client.SO('Counter'), 'init', 5000);

      const updateCount = 100;
      let receivedUpdates = 0;

      client.SO('Counter').on('update', () => {
        receivedUpdates++;
      });

      // Rapid sequential updates with manual notify
      for (let i = 1; i <= updateCount; i++) {
        service.SO('Counter').data.value = i;
        service.SO('Counter').notify();
      }

      // Wait for all updates to arrive
      await waitUntil(() => client.SO('Counter').data?.value === updateCount, 10000);

      // Final value should be correct
      assert.strictEqual(client.SO('Counter').data?.value, updateCount);
      // We should have received some updates (may be batched)
      assert.ok(receivedUpdates > 0, 'Should have received at least one update');
    });

    it('should batch rapid auto-detected changes', async () => {
      client.SO('Counter').removeAllListeners('update');
      let batchCount = 0;

      client.SO('Counter').on('update', () => {
        batchCount++;
      });

      // Rapid synchronous changes (should batch)
      for (let i = 0; i < 50; i++) {
        service.SO('Counter').data.value = i + 1000;
      }

      // Wait for batched update
      await waitUntil(() => client.SO('Counter').data?.value === 1049, 5000);

      // Due to batching, we should have received far fewer updates than changes
      assert.ok(batchCount < 50, `Expected batching, but got ${batchCount} updates`);
      assert.strictEqual(client.SO('Counter').data?.value, 1049);
    });
  });

  describe('Large payload handling', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'BigData',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'number' },
                      name: { type: 'string' },
                      data: { type: 'string' },
                    },
                  },
                },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(descriptor, {}, { BigData: { items: [] } });
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('BigData').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should handle large initial state', async () => {
      // Create large initial state
      const largeItems = [];
      for (let i = 0; i < 1000; i++) {
        largeItems.push({
          id: i,
          name: `Item ${i}`,
          data: 'x'.repeat(100), // 100 chars per item
        });
      }
      service.SO('BigData').data.items = largeItems;

      // Subscribe and receive large state
      client.SO('BigData').subscribe();
      await waitFor(client.SO('BigData'), 'init', 10000);

      assert.strictEqual(client.SO('BigData').data?.items.length, 1000);
      assert.strictEqual(client.SO('BigData').data?.items[500].id, 500);
    });

    it('should handle large update payloads', async () => {
      // Replace with new large array
      const newItems = [];
      for (let i = 0; i < 500; i++) {
        newItems.push({
          id: i + 10000,
          name: `New Item ${i}`,
          data: 'y'.repeat(200),
        });
      }

      service.SO('BigData').data.items = newItems;

      await waitUntil(() => client.SO('BigData').data?.items.length === 500, 5000);

      assert.strictEqual(client.SO('BigData').data?.items.length, 500);
      assert.strictEqual(client.SO('BigData').data?.items[0].id, 10000);
    });
  });

  describe('Many concurrent clients', () => {
    let service: Service;
    let clients: Client[];
    let descriptor: Descriptor;

    const CLIENT_COUNT = 10;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Broadcast',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                timestamp: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {},
        { Broadcast: { message: 'initial', timestamp: 0 } }
      );
      await service.ready();

      // Create many clients
      clients = [];
      for (let i = 0; i < CLIENT_COUNT; i++) {
        clients.push(new Client(descriptor));
      }
      await delay(100);
    });

    after(async () => {
      for (const c of clients) {
        c.SO('Broadcast').unsubscribe();
      }
      await delay(100);
      for (const c of clients) {
        c.close();
      }
      await service.close();
      await delay(100);
    });

    it('should broadcast to all clients simultaneously', async () => {
      // Subscribe all clients
      for (const c of clients) {
        c.SO('Broadcast').subscribe();
      }

      // Wait for all to receive init
      await Promise.all(clients.map((c) => waitFor(c.SO('Broadcast'), 'init', 5000)));

      // Verify all received initial state
      for (const c of clients) {
        assert.strictEqual(c.SO('Broadcast').data?.message, 'initial');
      }

      // Track updates per client
      const updateCounts = new Map<Client, number>();
      for (const c of clients) {
        updateCounts.set(c, 0);
        c.SO('Broadcast').on('update', () => {
          updateCounts.set(c, (updateCounts.get(c) || 0) + 1);
        });
      }

      // Send update
      service.SO('Broadcast').data.message = 'broadcast test';
      service.SO('Broadcast').data.timestamp = Date.now();
      service.SO('Broadcast').notify();

      // Wait for all clients to receive update
      await waitUntil(
        () => clients.every((c) => c.SO('Broadcast').data?.message === 'broadcast test'),
        5000
      );

      // Verify all clients received the update
      for (const c of clients) {
        assert.strictEqual(c.SO('Broadcast').data?.message, 'broadcast test');
        assert.ok(
          (updateCounts.get(c) || 0) >= 1,
          'Each client should receive at least one update'
        );
      }
    });

    it('should handle rapid broadcasts to many clients', async () => {
      const messageCount = 20;

      // Track final messages
      const finalValues = new Map<Client, string>();

      for (let i = 0; i < messageCount; i++) {
        service.SO('Broadcast').data.message = `message-${i}`;
        service.SO('Broadcast').notify();
      }

      // Wait for final message to propagate
      await waitUntil(
        () => clients.every((c) => c.SO('Broadcast').data?.message === `message-${messageCount - 1}`),
        10000
      );

      // All clients should have the final message
      for (const c of clients) {
        finalValues.set(c, c.SO('Broadcast').data?.message || '');
        assert.strictEqual(c.SO('Broadcast').data?.message, `message-${messageCount - 1}`);
      }
    });
  });

  describe('Concurrent subscribe/unsubscribe operations', () => {
    let service: Service;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Dynamic',
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
      service = new Service(descriptor, {}, { Dynamic: { value: 0 } });
      await service.ready();
    });

    after(async () => {
      await service.close();
      await delay(100);
    });

    it('should handle rapid subscribe/unsubscribe cycles', async () => {
      const client = new Client(descriptor);
      await delay(50);

      const cycles = 10;
      let initCount = 0;
      let disconnectCount = 0;

      client.SO('Dynamic').on('init', () => initCount++);
      client.SO('Dynamic').on('disconnected', () => disconnectCount++);

      for (let i = 0; i < cycles; i++) {
        client.SO('Dynamic').subscribe();
        await waitFor(client.SO('Dynamic'), 'init', 3000);
        client.SO('Dynamic').unsubscribe();
        await delay(50);
      }

      // Should have received init for each subscribe
      assert.strictEqual(initCount, cycles, `Expected ${cycles} inits, got ${initCount}`);

      client.close();
      await delay(100);
    });

    it('should handle multiple clients subscribing/unsubscribing concurrently', async () => {
      const clientCount = 5;
      const clients: Client[] = [];

      for (let i = 0; i < clientCount; i++) {
        clients.push(new Client(descriptor));
      }
      await delay(50);

      // Subscribe all concurrently
      const subscribePromises = clients.map((c) => {
        c.SO('Dynamic').subscribe();
        return waitFor(c.SO('Dynamic'), 'init', 5000);
      });
      await Promise.all(subscribePromises);

      // All should be subscribed
      for (const c of clients) {
        assert.strictEqual(c.SO('Dynamic').ready, true);
      }

      // Unsubscribe all
      for (const c of clients) {
        c.SO('Dynamic').unsubscribe();
      }
      await delay(100);

      // Resubscribe alternating clients while others stay unsubscribed
      for (let i = 0; i < clientCount; i += 2) {
        clients[i].SO('Dynamic').subscribe();
      }

      const resubscribePromises = [];
      for (let i = 0; i < clientCount; i += 2) {
        resubscribePromises.push(waitFor(clients[i].SO('Dynamic'), 'init', 5000));
      }
      await Promise.all(resubscribePromises);

      // Send update
      service.SO('Dynamic').data.value = 999;
      service.SO('Dynamic').notify();
      await delay(100);

      // Only subscribed clients should have received update
      for (let i = 0; i < clientCount; i++) {
        if (i % 2 === 0) {
          assert.strictEqual(clients[i].SO('Dynamic').data?.value, 999);
        } else {
          // Unsubscribed clients should not expose data
          assert.throws(() => {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            clients[i].SO('Dynamic').data;
          });
        }
      }

      // Cleanup
      for (const c of clients) {
        c.SO('Dynamic').unsubscribe();
      }
      await delay(100);
      for (const c of clients) {
        c.close();
      }
      await delay(100);
    });
  });

  describe('PubSub pattern high throughput', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Stream',
            type: 'PubSub',
            messageSchema: {
              type: 'object',
              properties: {
                seq: { type: 'number' },
                data: { type: 'string' },
              },
            },
          } as PubSubEndpoint,
        ],
      });
      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.PS('Stream').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should handle high-frequency message streaming', async () => {
      client.PS('Stream').subscribe();
      await waitFor(client.PS('Stream'), 'connected', 5000);

      const received: number[] = [];
      client.PS('Stream').on('message', (msg: { seq: number; data: string }) => {
        received.push(msg.seq);
      });

      const messageCount = 100;

      // Send rapid messages
      for (let i = 0; i < messageCount; i++) {
        service.PS('Stream').send({ seq: i, data: `message-${i}` });
      }

      // Wait for messages to arrive
      await waitUntil(() => received.length === messageCount, 10000);

      // Verify all received in order
      assert.strictEqual(received.length, messageCount);
      for (let i = 0; i < messageCount; i++) {
        assert.strictEqual(received[i], i, `Message ${i} out of order`);
      }
    });
  });

  describe('RPC pattern high throughput', () => {
    let service: Service;
    let clients: Client[];
    let descriptor: Descriptor;
    const received: { clientId: number; seq: number }[] = [];

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Collector',
            type: 'RPC',
            requestSchema: {
              type: 'object',
              properties: {
                clientId: { type: 'number' },
                seq: { type: 'number' },
              },
            },
            replySchema: { type: 'null' },
          } as RPCEndpoint,
        ],
      });
      service = new Service(descriptor, {
        Collector: async (msg: { clientId: number; seq: number }) => {
          received.push(msg);
          return null;
        },
      }, {});
      await service.ready();

      clients = [];
      for (let i = 0; i < 5; i++) {
        clients.push(new Client(descriptor));
      }
      await delay(100);
    });

    after(async () => {
      for (const c of clients) {
        c.close();
      }
      await service.close();
      await delay(100);
    });

    it('should handle multiple clients pushing simultaneously', async () => {
      received.length = 0;

      const messagesPerClient = 20;
      const totalExpected = clients.length * messagesPerClient;

      // All clients push concurrently
      const pushPromises = clients.map((c, clientId) => {
        return (async () => {
          const promises: Promise<unknown>[] = [];
          for (let seq = 0; seq < messagesPerClient; seq++) {
            promises.push(c.RPC('Collector').call({ clientId, seq }, 2000));
          }
          await Promise.all(promises);
        })();
      });

      await Promise.all(pushPromises);

      // Wait for all messages to arrive
      await waitUntil(() => received.length === totalExpected, 10000);

      assert.strictEqual(received.length, totalExpected);

      // Verify messages from each client
      for (let clientId = 0; clientId < clients.length; clientId++) {
        const clientMessages = received.filter((m) => m.clientId === clientId);
        assert.strictEqual(
          clientMessages.length,
          messagesPerClient,
          `Client ${clientId} should have sent ${messagesPerClient} messages`
        );
      }
    });
  });
});
