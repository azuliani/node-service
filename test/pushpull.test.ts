/**
 * PushPull pattern tests.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, delay } from './helpers.ts';
import type { Descriptor, PushPullEndpoint } from '../src/index.ts';

describe('PushPull Pattern', () => {
  describe('Basic work distribution', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'tasks',
            type: 'PushPull',
            messageSchema: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                data: { type: 'string' },
              },
              required: ['id'],
            },
          } as PushPullEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.PP('tasks').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should receive work pushed by server', async () => {
      const received: any[] = [];
      client.PP('tasks').on('message', (msg: any) => received.push(msg));
      client.PP('tasks').subscribe();

      await delay(100);

      service.PP('tasks').push({ id: 1, data: 'task1' });
      service.PP('tasks').push({ id: 2, data: 'task2' });

      await delay(100);

      assert.strictEqual(received.length, 2);
      assert.strictEqual(received[0].id, 1);
      assert.strictEqual(received[0].data, 'task1');
      assert.strictEqual(received[1].id, 2);
      assert.strictEqual(received[1].data, 'task2');
    });
  });

  describe('Message validation', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'work',
            type: 'PushPull',
            messageSchema: { type: 'number' },
          } as PushPullEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.PP('work').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should validate message on server push', () => {
      assert.throws(
        () => service.PP('work').push('not a number'),
        (err: Error) => {
          assert.ok(err.message.includes('Validation failed'));
          return true;
        }
      );
    });

    it('should pass valid messages', async () => {
      const received: any[] = [];
      client.PP('work').on('message', (msg: any) => received.push(msg));
      client.PP('work').subscribe();
      await delay(100);

      service.PP('work').push(99);
      await delay(100);

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0], 99);
    });
  });

  describe('Round-robin distribution', () => {
    let service: Service;
    let client1: Client;
    let client2: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'jobs',
            type: 'PushPull',
            messageSchema: { type: 'number' },
          } as PushPullEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client1 = new Client(descriptor);
      client2 = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client1.PP('jobs').unsubscribe();
      client2.PP('jobs').unsubscribe();
      await delay(100);
      client1.close();
      client2.close();
      await service.close();
      await delay(100);
    });

    it('should distribute work round-robin to multiple workers', async () => {
      const received1: any[] = [];
      const received2: any[] = [];

      client1.PP('jobs').on('message', (msg: any) => received1.push(msg));
      client2.PP('jobs').on('message', (msg: any) => received2.push(msg));

      client1.PP('jobs').subscribe();
      client2.PP('jobs').subscribe();
      await delay(100);

      // Push 6 jobs
      for (let i = 1; i <= 6; i++) {
        service.PP('jobs').push(i);
        // Small delay between pushes for round-robin to work
        await delay(10);
      }

      await delay(100);

      // Total messages should be 6
      const total = received1.length + received2.length;
      assert.strictEqual(total, 6, `Expected 6 total messages, got ${total}`);

      // Each worker should have received at least one
      assert.ok(received1.length > 0, 'Client1 should have received messages');
      assert.ok(received2.length > 0, 'Client2 should have received messages');
    });
  });

  describe('Subscribe/unsubscribe', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'items',
            type: 'PushPull',
            messageSchema: { type: 'number' },
          } as PushPullEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.PP('items').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should receive messages when subscribed', async () => {
      const received: any[] = [];
      client.PP('items').on('message', (msg: any) => received.push(msg));
      client.PP('items').subscribe();
      await delay(100);

      service.PP('items').push(1);
      await delay(100);

      assert.strictEqual(received.length, 1);
    });

    it('should stop receiving after unsubscribe', async () => {
      const received: any[] = [];
      client.PP('items').removeAllListeners('message');
      client.PP('items').on('message', (msg: any) => received.push(msg));
      client.PP('items').unsubscribe();
      await delay(100);

      // Messages pushed after unsubscribe should be queued at server
      // but client won't receive them
      service.PP('items').push(2);
      await delay(100);

      assert.strictEqual(received.length, 0);
    });
  });

  describe('Date handling', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'dated',
            type: 'PushPull',
            messageSchema: {
              type: 'object',
              properties: {
                when: { type: 'string', format: 'date-time' },
              },
            },
          } as PushPullEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.PP('dated').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should serialize dates on server and parse on client', async () => {
      const received: any[] = [];
      client.PP('dated').on('message', (msg: any) => received.push(msg));
      client.PP('dated').subscribe();
      await delay(100);

      const date = new Date('2024-07-01T09:00:00.000Z');
      service.PP('dated').push({ when: date });

      await delay(100);

      assert.strictEqual(received.length, 1);
      assert.ok(received[0].when instanceof Date);
      assert.strictEqual(received[0].when.toISOString(), '2024-07-01T09:00:00.000Z');
    });
  });

  describe('Message queuing when no workers connected', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'queueTest',
            type: 'PushPull',
            messageSchema: { type: 'number' },
          } as PushPullEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.PP('queueTest').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should queue messages when no workers connected', async () => {
      // Push 3 messages BEFORE any client subscribes
      const result1 = service.PP('queueTest').push(1);
      const result2 = service.PP('queueTest').push(2);
      const result3 = service.PP('queueTest').push(3);

      // push() returns false when no workers are connected (message queued)
      assert.strictEqual(result1, false, 'First push should return false (queued)');
      assert.strictEqual(result2, false, 'Second push should return false (queued)');
      assert.strictEqual(result3, false, 'Third push should return false (queued)');

      // Now subscribe a worker
      const received: number[] = [];
      client.PP('queueTest').on('message', (msg: any) => received.push(msg));
      client.PP('queueTest').subscribe();

      // Wait for connection and queued message delivery
      await delay(200);

      // Client should receive all 3 queued messages
      assert.strictEqual(received.length, 3, 'Should receive all 3 queued messages');
      assert.deepStrictEqual(received, [1, 2, 3], 'Messages should be delivered in order');
    });
  });
});
