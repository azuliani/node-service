/**
 * PubSub pattern tests.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, getAvailablePort, delay, waitFor } from './helpers.ts';
import type { Descriptor, PubSubEndpoint } from '../src/index.ts';

describe('PubSub Pattern', () => {
  describe('Basic pub/sub', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'notifications',
            type: 'PubSub',
            messageSchema: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                level: { type: 'string', enum: ['info', 'warn', 'error'] },
              },
              required: ['text'],
            },
          } as PubSubEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.PS('notifications').unsubscribe();
      await delay(50);
      client.close();
      await service.close();
      await delay(50);
    });

    it('should receive messages after subscribing', async () => {
      const messages: any[] = [];
      client.PS('notifications').on('message', (msg: any) => messages.push(msg));
      client.PS('notifications').subscribe();

      // Wait for subscription to be established
      await delay(50);

      service.PS('notifications').send({ text: 'Hello', level: 'info' });
      service.PS('notifications').send({ text: 'World', level: 'warn' });

      await delay(50);

      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[0].text, 'Hello');
      assert.strictEqual(messages[0].level, 'info');
      assert.strictEqual(messages[1].text, 'World');
      assert.strictEqual(messages[1].level, 'warn');
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
            name: 'typed',
            type: 'PubSub',
            messageSchema: {
              type: 'object',
              properties: {
                count: { type: 'number' },
              },
              required: ['count'],
            },
          } as PubSubEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.PS('typed').unsubscribe();
      await delay(50);
      client.close();
      await service.close();
      await delay(50);
    });

    it('should validate messages on server send', () => {
      assert.throws(
        () => service.PS('typed').send({ count: 'not a number' }),
        (err: Error) => {
          assert.ok(err.message.includes('Validation failed'));
          return true;
        }
      );
    });

    it('should pass valid messages', async () => {
      const messages: any[] = [];
      client.PS('typed').on('message', (msg: any) => messages.push(msg));
      client.PS('typed').subscribe();
      await delay(50);

      service.PS('typed').send({ count: 42 });
      await delay(50);

      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].count, 42);
    });
  });

  describe('Date parsing', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'events',
            type: 'PubSub',
            messageSchema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                timestamp: { type: 'string', format: 'date-time' },
              },
            },
          } as PubSubEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.PS('events').unsubscribe();
      await delay(50);
      client.close();
      await service.close();
      await delay(50);
    });

    it('should serialize dates on send and parse on receive', async () => {
      const messages: any[] = [];
      client.PS('events').on('message', (msg: any) => messages.push(msg));
      client.PS('events').subscribe();
      await delay(50);

      const timestamp = new Date('2024-03-15T14:30:00.000Z');
      service.PS('events').send({ name: 'test', timestamp });

      await delay(50);

      assert.strictEqual(messages.length, 1);
      assert.ok(messages[0].timestamp instanceof Date);
      assert.strictEqual(messages[0].timestamp.toISOString(), '2024-03-15T14:30:00.000Z');
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
            name: 'toggle',
            type: 'PubSub',
            messageSchema: { type: 'number' },
          } as PubSubEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.PS('toggle').unsubscribe();
      await delay(50);
      client.close();
      await service.close();
      await delay(50);
    });

    it('should not receive messages before subscribing', async () => {
      const messages: any[] = [];
      client.PS('toggle').on('message', (msg: any) => messages.push(msg));

      // Don't subscribe yet
      service.PS('toggle').send(1);
      await delay(50);

      assert.strictEqual(messages.length, 0);
    });

    it('should receive messages after subscribing', async () => {
      const messages: any[] = [];
      client.PS('toggle').on('message', (msg: any) => messages.push(msg));
      client.PS('toggle').subscribe();
      await delay(50);

      service.PS('toggle').send(2);
      await delay(50);

      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0], 2);
    });

    it('should not receive messages after unsubscribing', async () => {
      const messages: any[] = [];
      client.PS('toggle').removeAllListeners('message');
      client.PS('toggle').on('message', (msg: any) => messages.push(msg));

      client.PS('toggle').unsubscribe();
      await delay(50);

      service.PS('toggle').send(3);
      await delay(50);

      assert.strictEqual(messages.length, 0);
    });
  });

  describe('Multiple subscribers', () => {
    let service: Service;
    let client1: Client;
    let client2: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'broadcast',
            type: 'PubSub',
            messageSchema: { type: 'string' },
          } as PubSubEndpoint,
        ],
      });

      service = new Service(descriptor, {}, {});
      await service.ready();
      client1 = new Client(descriptor);
      client2 = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client1.PS('broadcast').unsubscribe();
      client2.PS('broadcast').unsubscribe();
      await delay(50);
      client1.close();
      client2.close();
      await service.close();
      await delay(50);
    });

    it('should deliver messages to all subscribers', async () => {
      const messages1: any[] = [];
      const messages2: any[] = [];

      client1.PS('broadcast').on('message', (msg: any) => messages1.push(msg));
      client2.PS('broadcast').on('message', (msg: any) => messages2.push(msg));

      client1.PS('broadcast').subscribe();
      client2.PS('broadcast').subscribe();
      await delay(50);

      service.PS('broadcast').send('hello everyone');
      await delay(50);

      assert.strictEqual(messages1.length, 1);
      assert.strictEqual(messages1[0], 'hello everyone');
      assert.strictEqual(messages2.length, 1);
      assert.strictEqual(messages2[0], 'hello everyone');
    });
  });

  describe('Connection events', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;
    let port: number;

    before(async () => {
      port = await getAvailablePort();
      descriptor = {
        transport: {
          server: `127.0.0.1:${port}`,
          client: `127.0.0.1:${port}`,
        },
        endpoints: [
          {
            name: 'connectionEvents',
            type: 'PubSub',
            messageSchema: { type: 'string' },
          } as PubSubEndpoint,
        ],
      };
      service = new Service(descriptor, {}, {});
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await delay(50);
    });

    it('should emit connected event on subscribe', async () => {
      let connectedEmitted = false;
      client.PS('connectionEvents').on('connected', () => {
        connectedEmitted = true;
      });

      client.PS('connectionEvents').subscribe();

      // Wait for connection
      await waitFor(client.PS('connectionEvents'), 'connected', 2000);

      assert.ok(connectedEmitted, 'Should emit connected event');
    });

    it('should emit disconnected event on server close', async () => {
      // Make sure we're connected first
      await delay(50);

      let disconnectedEmitted = false;
      client.PS('connectionEvents').on('disconnected', () => {
        disconnectedEmitted = true;
      });

      // Close the server
      await service.close();

      // Wait for disconnected event
      await waitFor(client.PS('connectionEvents'), 'disconnected', 2000);

      assert.ok(disconnectedEmitted, 'Should emit disconnected event on server close');
    });
  });
});
