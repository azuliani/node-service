/**
 * Plugin system tests.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, createService, defineServiceSpec, healthPlugin, metricsPlugin, auditLogPlugin } from '../src/index.ts';
import { delay, getAvailablePort } from './helpers.ts';

describe('Plugins', () => {
  describe('healthPlugin', () => {
    let service: ReturnType<typeof createService>;
    let client: ReturnType<typeof createClient>;

    before(async () => {
      const port = await getAvailablePort();
      const spec = defineServiceSpec({
        transport: {
          server: `127.0.0.1:${port}`,
          client: `127.0.0.1:${port}`,
        },
        endpoints: [],
        plugins: [healthPlugin()],
      });

      service = createService(spec, {});
      await service.ready();
      client = createClient(spec);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should return health info', async () => {
      const result = await client.RPC('_health').call(null, 2000);

      assert.strictEqual(typeof result.uptimeSec, 'number');
      assert.strictEqual(typeof result.rssBytes, 'number');
      assert.strictEqual(typeof result.heapUsedBytes, 'number');
      assert.strictEqual(typeof result.heapTotalBytes, 'number');
      assert.strictEqual(typeof result.externalBytes, 'number');
      assert.strictEqual(typeof result.arrayBuffersBytes, 'number');
      assert.strictEqual(typeof result.eventLoopDelayMs, 'number');
      assert.strictEqual(typeof result.pid, 'number');
      assert.strictEqual(typeof result.node, 'string');
      assert.strictEqual(typeof result.platform, 'string');
      assert.strictEqual(typeof result.arch, 'string');
      assert.ok(Array.isArray(result.loadAvg));
      assert.strictEqual(result.loadAvg.length, 3);
    });
  });

  describe('metricsPlugin', () => {
    let service: ReturnType<typeof createService>;
    let client: ReturnType<typeof createClient>;

    before(async () => {
      const port = await getAvailablePort();
      const spec = defineServiceSpec({
        transport: {
          server: `127.0.0.1:${port}`,
          client: `127.0.0.1:${port}`,
        },
        endpoints: [
          {
            name: 'Ping',
            type: 'RPC',
            requestSchema: { type: 'null' },
            replySchema: { type: 'string' },
          },
        ],
        plugins: [metricsPlugin()],
      });

      service = createService(spec, {
        Ping: async () => 'pong',
      });
      await service.ready();
      client = createClient(spec);
      await delay(50);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(50);
    });

    it('should record RPC metrics', async () => {
      await client.RPC('Ping').call(null, 2000);
      await client.RPC('Ping').call(null, 2000);

      const metrics = await client.RPC('_metrics').call(null, 2000);
      assert.strictEqual(metrics.rpc.Ping.calls, 2);
      assert.strictEqual(metrics.rpc.Ping.errors, 0);
    });
  });

  describe('auditLogPlugin', () => {
    let service: ReturnType<typeof createService>;
    let client: ReturnType<typeof createClient>;

    before(async () => {
      const port = await getAvailablePort();
      const spec = defineServiceSpec({
        transport: {
          server: `127.0.0.1:${port}`,
          client: `127.0.0.1:${port}`,
        },
        endpoints: [
          {
            name: 'Echo',
            type: 'RPC',
            requestSchema: { type: 'string' },
            replySchema: { type: 'string' },
          },
        ],
        plugins: [auditLogPlugin()],
      });

      service = createService(spec, {
        Echo: async (input: string) => input,
      });
      await service.ready();
      client = createClient(spec);
      await delay(50);
    });

    after(async () => {
      client.PS('_audit').unsubscribe();
      await delay(50);
      client.close();
      await service.close();
      await delay(50);
    });

    it('should emit audit events for RPC calls', async () => {
      const events: any[] = [];
      client.PS('_audit').on('message', (msg: any) => events.push(msg));

      client.PS('_audit').subscribe();
      await delay(50);

      await client.RPC('Echo').call('hello', 2000);
      await delay(50);

      assert.ok(events.some((e) => e.type === 'rpc' && e.endpoint === 'Echo'));
    });
  });
});
