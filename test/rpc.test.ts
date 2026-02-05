/**
 * RPC pattern tests.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';
import { Service, Client } from '../src/index.ts';
import { MissingHandlerError, TimeoutError, ValidationError } from '../src/errors.ts';
import { getAvailablePort, createDescriptor, delay } from './helpers.ts';
import type { Descriptor, RPCEndpoint } from '../src/index.ts';

describe('RPC Pattern', () => {
  describe('Basic request/response', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      const port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'echo',
            type: 'RPC',
            requestSchema: { type: 'string' },
            replySchema: { type: 'string' },
          } as RPCEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {
          echo: async (input: string) => input.toUpperCase(),
        },
        {}
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should send request and receive response', async () => {
      const result = await client.RPC('echo').call('hello');
      assert.strictEqual(result, 'HELLO');
    });

    it('should handle multiple sequential requests', async () => {
      const result1 = await client.RPC('echo').call('one');
      const result2 = await client.RPC('echo').call('two');
      const result3 = await client.RPC('echo').call('three');

      assert.strictEqual(result1, 'ONE');
      assert.strictEqual(result2, 'TWO');
      assert.strictEqual(result3, 'THREE');
    });

    it('should handle multiple concurrent requests', async () => {
      const results = await Promise.all([
        client.RPC('echo').call('a'),
        client.RPC('echo').call('b'),
        client.RPC('echo').call('c'),
      ]);

      assert.deepStrictEqual(results, ['A', 'B', 'C']);
    });
  });

  describe('Request validation', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      const port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'add',
            type: 'RPC',
            requestSchema: {
              type: 'object',
              properties: {
                a: { type: 'number' },
                b: { type: 'number' },
              },
              required: ['a', 'b'],
            },
            replySchema: { type: 'number' },
          } as RPCEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {
          add: async (input: { a: number; b: number }) => input.a + input.b,
        },
        {}
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should validate request input on client', async () => {
      await assert.rejects(
        () => client.RPC('add').call({ a: 'not a number', b: 2 }),
        (err: Error) => {
          assert.ok(err.message.includes('Validation failed'));
          return true;
        }
      );
    });

    it('should pass with valid input', async () => {
      const result = await client.RPC('add').call({ a: 3, b: 4 });
      assert.strictEqual(result, 7);
    });
  });

  describe('Handler errors', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      const port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'mayFail',
            type: 'RPC',
            requestSchema: { type: 'boolean' },
            replySchema: { type: 'string' },
          } as RPCEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {
          mayFail: async (shouldFail: boolean) => {
            if (shouldFail) {
              throw new Error('Intentional error');
            }
            return 'success';
          },
        },
        {}
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should propagate handler errors to client', async () => {
      await assert.rejects(
        () => client.RPC('mayFail').call(true),
        (err: Error) => {
          assert.strictEqual(err.message, 'Intentional error');
          return true;
        }
      );
    });

    it('should return success when handler succeeds', async () => {
      const result = await client.RPC('mayFail').call(false);
      assert.strictEqual(result, 'success');
    });
  });

  describe('Timeout handling', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      const port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'slow',
            type: 'RPC',
            requestSchema: { type: 'number' },
            replySchema: { type: 'string' },
          } as RPCEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {
          slow: async (delayMs: number) => {
            await delay(delayMs);
            return 'done';
          },
        },
        {}
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should timeout if response takes too long', async () => {
      await assert.rejects(
        () => client.RPC('slow').call(500, 100), // 500ms delay, 100ms timeout
        (err: Error) => {
          assert.ok(err instanceof TimeoutError || err.message === 'timeout');
          return true;
        }
      );
    });

    it('should succeed if response is fast enough', async () => {
      const result = await client.RPC('slow').call(50, 500); // 50ms delay, 500ms timeout
      assert.strictEqual(result, 'done');
    });
  });

  describe('Missing handler error', () => {
    it('should throw MissingHandlerError for RPC without handler', async () => {
      const port = await getAvailablePort();
      const descriptor: Descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'noHandler',
            type: 'RPC',
            requestSchema: {},
            replySchema: {},
          } as RPCEndpoint,
        ],
      });

      assert.throws(
        () => new Service(descriptor, {}, {}),
        (err: Error) => {
          assert.ok(err instanceof MissingHandlerError);
          assert.ok(err.message.includes('noHandler'));
          return true;
        }
      );
    });
  });

  describe('Date handling in RPC', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      const port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'getDate',
            type: 'RPC',
            requestSchema: {},
            replySchema: {
              type: 'object',
              properties: {
                timestamp: { type: 'string', format: 'date-time' },
              },
            },
          } as RPCEndpoint,
          {
            name: 'processDate',
            type: 'RPC',
            requestSchema: {
              type: 'object',
              properties: {
                date: { type: 'string', format: 'date' },
              },
            },
            replySchema: { type: 'number' },
          } as RPCEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {
          getDate: async () => ({
            timestamp: new Date('2024-01-15T10:30:00.000Z'),
          }),
          processDate: async (input: { date: Date }) => input.date.getFullYear(),
        },
        {}
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should serialize dates in response', async () => {
      const result = await client.RPC('getDate').call(null);
      assert.ok(result.timestamp instanceof Date);
      assert.strictEqual(result.timestamp.toISOString(), '2024-01-15T10:30:00.000Z');
    });

    it('should parse dates in request on server', async () => {
      const result = await client.RPC('processDate').call({
        date: '2024-06-15',
      });
      assert.strictEqual(result, 2024);
    });

    it('should accept Date objects in request', async () => {
      const result = await client.RPC('processDate').call({
        date: new Date('2024-06-15T00:00:00.000Z'),
      });
      assert.strictEqual(result, 2024);
    });
  });

  describe('Unknown endpoint error', () => {
    let service: Service;
    let descriptor: Descriptor;
    let port: number;

    before(async () => {
      port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'existing',
            type: 'RPC',
            requestSchema: { type: 'string' },
            replySchema: { type: 'string' },
          } as RPCEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {
          existing: async (input: string) => input,
        },
        {}
      );
      await service.ready();
    });

    after(async () => {
      await service.close();
      await delay(50);
    });

    it('should return UnknownEndpointError for non-existent RPC', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      await new Promise<void>((resolve) => ws.on('open', resolve));

      const resPromise = new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 2000);
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed && parsed.type === 'rpc:res' && parsed.id === 1) {
            clearTimeout(timer);
            resolve(parsed);
          }
        });
      });

      ws.send(JSON.stringify({ type: 'rpc:req', id: 1, endpoint: 'nonexistent', input: 'test' }));
      const res = await resPromise;

      assert.ok(res.err, 'Should return an error');
      assert.strictEqual(res.err.code, 'UNKNOWN_ENDPOINT', 'Error code should be UNKNOWN_ENDPOINT');
      assert.ok(res.err.message.includes('nonexistent'), 'Error message should mention the endpoint name');

      ws.close();
    });
  });

  describe('Response validation', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      const port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'badResponse',
            type: 'RPC',
            requestSchema: {},
            replySchema: { type: 'number' },
          } as RPCEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {
          // Handler returns a string instead of a number - violates replySchema
          badResponse: async () => 'not a number' as any,
        },
        {}
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should return error when handler returns invalid response', async () => {
      await assert.rejects(
        () => client.RPC('badResponse').call(null),
        (err: Error) => {
          assert.ok(err.message.includes('Validation failed'), 'Should be a validation error');
          return true;
        }
      );
    });
  });

  describe('Error code propagation', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      const port = await getAvailablePort();
      descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'throwsWithCode',
            type: 'RPC',
            requestSchema: {},
            replySchema: { type: 'string' },
          } as RPCEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {
          throwsWithCode: async () => {
            throw new ValidationError('Custom validation message');
          },
        },
        {}
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should propagate custom error codes to client', async () => {
      await assert.rejects(
        () => client.RPC('throwsWithCode').call(null),
        (err: any) => {
          assert.strictEqual(err.code, 'VALIDATION_FAILED', 'Error code should be propagated');
          assert.ok(err.message.includes('Custom validation message'), 'Error message should be propagated');
          return true;
        }
      );
    });
  });

  describe('Service.RPC local invocation', () => {
    it('should call handlers locally with schema validation', async () => {
      const port = await getAvailablePort();
      const descriptor: Descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'upper',
            type: 'RPC',
            requestSchema: { type: 'string' },
            replySchema: { type: 'string' },
          } as RPCEndpoint,
        ],
      });

      const service = new Service(
        descriptor,
        {
          upper: async (input: string) => input.toUpperCase(),
        },
        {}
      );
      await service.ready();

      const result = await service.RPC('upper').call('hello');
      assert.strictEqual(result, 'HELLO');

      await service.close();
      await delay(50);
    });

    it('should support timeouts for local calls', async () => {
      const port = await getAvailablePort();
      const descriptor: Descriptor = createDescriptor(port, {
        endpoints: [
          {
            name: 'slowLocal',
            type: 'RPC',
            requestSchema: { type: 'number' },
            replySchema: { type: 'string' },
          } as RPCEndpoint,
        ],
      });

      const service = new Service(
        descriptor,
        {
          slowLocal: async (delayMs: number) => {
            await delay(delayMs);
            return 'done';
          },
        },
        {}
      );
      await service.ready();

      await assert.rejects(
        () => service.RPC('slowLocal').call(200, 25),
        (err: Error) => err instanceof TimeoutError
      );

      await service.close();
      await delay(50);
    });
  });
});
