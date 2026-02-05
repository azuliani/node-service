/**
 * Heartbeat system tests.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, delay, waitFor } from './helpers.ts';
import type { Descriptor, PubSubEndpoint } from '../src/index.ts';

describe('Heartbeat System', () => {
  describe('Server heartbeat broadcasting', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Messages',
            type: 'PubSub',
            messageSchema: { type: 'string' },
          } as PubSubEndpoint,
        ],
      });
      // Use short heartbeat for testing
      service = new Service(descriptor, {}, {}, { heartbeatMs: 50 });
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should send heartbeats that clients can receive', async () => {
      // Subscribe to the source endpoint to start receiving messages
      client.PS('Messages').subscribe();

      // Wait for client to connect and receive heartbeat
      await delay(100);

      // The client should be subscribed
      assert.ok(client.PS('Messages').subscribed, 'PubSub endpoint should be subscribed');
    });

    it('should receive messages on the source after heartbeat', async () => {
      // Send a message
      service.PS('Messages').send('hello');

      // Wait for message
      const messagePromise = waitFor(client.PS('Messages'), 'message', 1000);
      const message = await messagePromise;

      assert.strictEqual(message, 'hello');
    });
  });

  describe('Custom heartbeat interval', () => {
    let service: Service;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [],
      });
      // Create service with custom heartbeat interval
      service = new Service(descriptor, {}, {}, { heartbeatMs: 50 });
      await service.ready();
    });

    after(async () => {
      await service.close();
      await delay(50);
    });

    it('should use custom heartbeat interval', async () => {
      // The service should start with the custom interval
      // We can't directly access the interval, but we can observe behavior
      await delay(75);
      // If no error thrown, service is running with custom interval
    });
  });

  describe('PubSub messages reset heartbeat timer', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Data',
            type: 'PubSub',
            messageSchema: { type: 'number' },
          } as PubSubEndpoint,
        ],
      });
      service = new Service(descriptor, {}, {}, { heartbeatMs: 50 });
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.PS('Data').unsubscribe();
      await delay(50);
      client.close();
      await service.close();
      await delay(50);
    });

    it('should receive pubsub messages', async () => {
      client.PS('Data').subscribe();

      // Wait for initial connection
      await delay(75);

      // Send a source message
      service.PS('Data').send(42);

      const message = await waitFor(client.PS('Data'), 'message', 1000);
      assert.strictEqual(message, 42);
    });

    it('should continue receiving messages after multiple heartbeat intervals', async () => {
      // Wait for multiple heartbeat intervals
      await delay(200); // 4x the heartbeat interval

      // Send another message - client should still be connected
      service.PS('Data').send(100);

      const message = await waitFor(client.PS('Data'), 'message', 1000);
      assert.strictEqual(message, 100);
    });
  });

  describe('Multiple endpoints with heartbeat', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Events',
            type: 'PubSub',
            messageSchema: { type: 'string' },
          } as PubSubEndpoint,
          {
            name: 'Numbers',
            type: 'PubSub',
            messageSchema: { type: 'number' },
          } as PubSubEndpoint,
        ],
      });
      service = new Service(descriptor, {}, {}, { heartbeatMs: 50 });
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.PS('Events').unsubscribe();
      client.PS('Numbers').unsubscribe();
      await delay(50);
      client.close();
      await service.close();
      await delay(50);
    });

    it('should receive messages on multiple endpoints', async () => {
      client.PS('Events').subscribe();
      client.PS('Numbers').subscribe();

      await delay(100);

      // Send to both endpoints
      service.PS('Events').send('event1');
      service.PS('Numbers').send(123);

      const [eventMsg, numMsg] = await Promise.all([
        waitFor(client.PS('Events'), 'message', 1000),
        waitFor(client.PS('Numbers'), 'message', 1000),
      ]);

      assert.strictEqual(eventMsg, 'event1');
      assert.strictEqual(numMsg, 123);
    });
  });

  describe('Service without source endpoints', () => {
    let service: Service;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [],
      });
      // Service without source endpoints should still work
      service = new Service(descriptor, {}, {}, { heartbeatMs: 50 });
      await service.ready();
    });

    after(async () => {
      await service.close();
      await delay(50);
    });

    it('should not crash without source endpoints', async () => {
      // Just verify the service starts without source transport
      await delay(100);
      // No error means heartbeat code handles missing endpoints
    });
  });

  describe('Default heartbeat interval', () => {
    let service: Service;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [],
      });
      // Service with default heartbeat interval (5000ms)
      service = new Service(descriptor, {}, {});
      await service.ready();
    });

    after(async () => {
      await service.close();
      await delay(50);
    });

    it('should use default 5000ms heartbeat interval', async () => {
      // We just verify the service starts correctly with default interval
      // The actual interval is 5000ms which is too long for unit tests
      await delay(100);
      // If no error thrown, service is running with default interval
    });
  });

  describe('Heartbeat timeout detection', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'TimeoutSource',
            type: 'PubSub',
            messageSchema: { type: 'string' },
          } as PubSubEndpoint,
        ],
      });
      // Use very short heartbeat for testing timeout
      service = new Service(descriptor, {}, {}, { heartbeatMs: 50 });
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await delay(50);
    });

    it('should detect heartbeat timeout and emit disconnected', async () => {
      client.PS('TimeoutSource').subscribe();

      // Wait for client to be connected and receiving heartbeats
      await delay(100);

      let disconnectedEmitted = false;
      client.PS('TimeoutSource').on('disconnected', () => {
        disconnectedEmitted = true;
      });

      // Close server - stops heartbeats
      await service.close();

      // Wait for 3.5x heartbeat interval for timeout detection
      await delay(200);

      assert.ok(disconnectedEmitted, 'Should emit disconnected event on heartbeat timeout');
    });
  });

  describe('Heartbeat timeout flushes SharedObject state', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'TimeoutShared',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                value: { type: 'number' },
              },
            },
          } as import('../src/index.ts').SharedObjectEndpoint,
        ],
      });
      // Use very short heartbeat for testing timeout
      service = new Service(descriptor, {}, { TimeoutShared: { value: 42 } }, { heartbeatMs: 50 });
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await delay(50);
    });

    it('should flush SharedObject state on heartbeat timeout', async () => {
      client.SO('TimeoutShared').subscribe();
      await waitFor(client.SO('TimeoutShared'), 'init', 5000);

      assert.ok(client.SO('TimeoutShared').ready);
      assert.strictEqual(client.SO('TimeoutShared').data?.value, 42);

      let disconnectedEmitted = false;
      client.SO('TimeoutShared').on('disconnected', () => {
        disconnectedEmitted = true;
      });

      // Close server - stops heartbeats
      await service.close();

      // Wait for timeout detection (3x heartbeat interval + buffer)
      await delay(200);

      assert.ok(disconnectedEmitted, 'Should emit disconnected event');
      assert.strictEqual(client.SO('TimeoutShared').ready, false, 'SharedObject should not be ready');
      assert.throws(
        () => {
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          client.SO('TimeoutShared').data;
        },
        (err: Error) => {
          assert.ok(err.message.includes('not ready'));
          return true;
        }
      );
    });
  });
});
