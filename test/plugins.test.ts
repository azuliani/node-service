/**
 * Plugin system tests.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, createService, defineServiceSpec, healthPlugin, metricsPlugin, auditLogPlugin, graphitePlugin } from '../src/index.ts';
import type { ServicePlugin } from '../src/plugins.ts';
import { delay, getAvailablePort, waitUntil } from './helpers.ts';

describe('Plugins', () => {
  describe('healthPlugin', () => {
    let service: ReturnType<typeof createService>;
    let client: ReturnType<typeof createClient>;

    before(async () => {
      const port = await getAvailablePort();
      const spec = defineServiceSpec({
        transport: {
          server: { host: '127.0.0.1', port },
          client: { host: '127.0.0.1', port },
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
      const result = await client.RPC('_health').call(null, { timeout: 2000 });

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
          server: { host: '127.0.0.1', port },
          client: { host: '127.0.0.1', port },
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
      await client.RPC('Ping').call(null, { timeout: 2000 });
      await client.RPC('Ping').call(null, { timeout: 2000 });

      const metrics = await client.RPC('_metrics').call(null, { timeout: 2000 });
      assert.strictEqual(metrics.rpc.Ping.calls, 2);
      assert.strictEqual(metrics.rpc.Ping.errors, 0);
    });
  });

  describe('throwing onServiceReady plugin', () => {
    it('should not crash the service when onServiceReady throws', async () => {
      const port = await getAvailablePort();

      const badPlugin: ServicePlugin = {
        name: 'bad-plugin',
        onServiceReady: () => {
          throw new Error('boom');
        },
      };

      const spec = defineServiceSpec({
        transport: {
          server: { host: '127.0.0.1', port },
          client: { host: '127.0.0.1', port },
        },
        endpoints: [
          {
            name: 'Echo',
            type: 'RPC',
            requestSchema: { type: 'string' },
            replySchema: { type: 'string' },
          },
        ],
        plugins: [badPlugin],
      });

      const service = createService(spec, {
        Echo: async (input: string) => input,
      });
      await service.ready();

      // The service should still be operational despite the plugin error
      const client = createClient(spec);
      await delay(50);

      const result = await client.RPC('Echo').call('hello', { timeout: 2000 });
      assert.strictEqual(result, 'hello');

      client.close();
      await service.close();
      await delay(50);
    });
  });

  describe('auditLogPlugin', () => {
    let service: ReturnType<typeof createService>;
    let client: ReturnType<typeof createClient>;

    before(async () => {
      const port = await getAvailablePort();
      const spec = defineServiceSpec({
        transport: {
          server: { host: '127.0.0.1', port },
          client: { host: '127.0.0.1', port },
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

      await client.RPC('Echo').call('hello', { timeout: 2000 });
      await delay(50);

      assert.ok(events.some((e) => e.type === 'rpc' && e.endpoint === 'Echo'));
    });
  });

  describe('graphitePlugin', () => {
    it('should report global metrics', async () => {
      const port = await getAvailablePort();
      const reported: string[] = [];
      const spec = defineServiceSpec({
        transport: {
          server: { host: '127.0.0.1', port },
          client: { host: '127.0.0.1', port },
        },
        endpoints: [],
        plugins: [graphitePlugin({ report: (lines) => reported.push(lines), prefix: 'test', intervalMs: 100 })],
      });

      const service = createService(spec, {});
      await service.ready();
      await waitUntil(() => reported.length > 0, 3000);

      const all = reported.join('\n');
      assert.ok(all.includes('test.process.memory.rss_bytes'), 'missing rss_bytes');
      assert.ok(all.includes('test.process.memory.heap_used_bytes'), 'missing heap_used_bytes');
      assert.ok(all.includes('test.process.memory.heap_total_bytes'), 'missing heap_total_bytes');
      assert.ok(all.includes('test.process.event_loop.delay_ms'), 'missing event_loop delay_ms');

      // Verify Graphite line format: "metric.path value timestamp\n"
      for (const batch of reported) {
        for (const line of batch.trim().split('\n')) {
          const parts = line.split(' ');
          assert.strictEqual(parts.length, 3, `Bad line format: ${line}`);
          assert.ok(!isNaN(Number(parts[1])), `Non-numeric value in: ${line}`);
          assert.ok(!isNaN(Number(parts[2])), `Non-numeric timestamp in: ${line}`);
        }
      }

      await service.close();
      await delay(50);
    });

    it('should report RPC rates', async () => {
      const port = await getAvailablePort();
      const reported: string[] = [];
      const spec = defineServiceSpec({
        transport: {
          server: { host: '127.0.0.1', port },
          client: { host: '127.0.0.1', port },
        },
        endpoints: [
          {
            name: 'Ping',
            type: 'RPC',
            requestSchema: { type: 'null' },
            replySchema: { type: 'string' },
          },
        ],
        plugins: [graphitePlugin({ report: (lines) => reported.push(lines), prefix: 'test', intervalMs: 100 })],
      });

      const service = createService(spec, { Ping: async () => 'pong' });
      await service.ready();
      const client = createClient(spec);
      await delay(50);

      // Make 5 RPC calls
      for (let i = 0; i < 5; i++) {
        await client.RPC('Ping').call(null, { timeout: 2000 });
      }

      await waitUntil(() => reported.some((r) => r.includes('test.rpc.Ping.calls_per_sec')), 3000);

      const all = reported.join('\n');
      assert.ok(all.includes('test.rpc.Ping.calls_per_sec'), 'missing calls_per_sec');
      assert.ok(all.includes('test.rpc.Ping.errors_per_sec'), 'missing errors_per_sec');
      assert.ok(all.includes('test.rpc.Ping.mean_ms'), 'missing mean_ms');
      assert.ok(all.includes('test.rpc.Ping.max_ms'), 'missing max_ms');

      // Verify calls_per_sec is positive
      const cpsLine = all.split('\n').find((l) => l.includes('test.rpc.Ping.calls_per_sec'));
      const cpsValue = Number(cpsLine!.split(' ')[1]);
      assert.ok(cpsValue > 0, `calls_per_sec should be positive, got ${cpsValue}`);

      client.close();
      await service.close();
      await delay(50);
    });

    it('should report PubSub rates', async () => {
      const port = await getAvailablePort();
      const reported: string[] = [];
      const spec = defineServiceSpec({
        transport: {
          server: { host: '127.0.0.1', port },
          client: { host: '127.0.0.1', port },
        },
        endpoints: [
          {
            name: 'Events',
            type: 'PubSub',
            messageSchema: { type: 'string' },
          },
        ],
        plugins: [graphitePlugin({ report: (lines) => reported.push(lines), prefix: 'test', intervalMs: 100 })],
      });

      const service = createService(spec, {});
      await service.ready();
      await delay(50);

      // Publish messages
      for (let i = 0; i < 3; i++) {
        service.PS('Events').send('hello');
      }

      await waitUntil(() => reported.some((r) => r.includes('test.pubsub.Events.sends_per_sec')), 3000);

      const all = reported.join('\n');
      assert.ok(all.includes('test.pubsub.Events.sends_per_sec'), 'missing sends_per_sec');

      const spsLine = all.split('\n').find((l) => l.includes('test.pubsub.Events.sends_per_sec'));
      const spsValue = Number(spsLine!.split(' ')[1]);
      assert.ok(spsValue > 0, `sends_per_sec should be positive, got ${spsValue}`);

      await service.close();
      await delay(50);
    });

    it('should report SharedObject stats', async () => {
      const port = await getAvailablePort();
      const reported: string[] = [];
      const spec = defineServiceSpec({
        transport: {
          server: { host: '127.0.0.1', port },
          client: { host: '127.0.0.1', port },
        },
        endpoints: [
          {
            name: 'Counter',
            type: 'SharedObject',
            objectSchema: { type: 'object', properties: { value: { type: 'number' } } },
            autoNotify: false,
          },
        ],
        plugins: [graphitePlugin({ report: (lines) => reported.push(lines), prefix: 'test', intervalMs: 100 })],
      });

      const service = createService(spec, {}, { Counter: { value: 0 } });
      await service.ready();
      await delay(50);

      // Trigger notifies
      service.SO('Counter').rawData.value = 42;
      service.SO('Counter').notify(['value']);
      service.SO('Counter').rawData.value = 99;
      service.SO('Counter').notify(['value']);

      await waitUntil(() => reported.some((r) => r.includes('test.sharedobject.Counter.notifies_per_sec')), 3000);

      const all = reported.join('\n');
      assert.ok(all.includes('test.sharedobject.Counter.notifies_per_sec'), 'missing notifies_per_sec');
      assert.ok(all.includes('test.sharedobject.Counter.size_bytes'), 'missing size_bytes');
      assert.ok(all.includes('test.sharedobject.Counter.version'), 'missing version');

      // Verify size_bytes is reasonable (JSON.stringify of { value: 99 })
      const sizeLine = all.split('\n').find((l) => l.includes('test.sharedobject.Counter.size_bytes'));
      const sizeValue = Number(sizeLine!.split(' ')[1]);
      assert.ok(sizeValue > 0, `size_bytes should be positive, got ${sizeValue}`);

      await service.close();
      await delay(50);
    });

    it('should sanitize endpoint names', async () => {
      const port = await getAvailablePort();
      const reported: string[] = [];
      const spec = defineServiceSpec({
        transport: {
          server: { host: '127.0.0.1', port },
          client: { host: '127.0.0.1', port },
        },
        endpoints: [
          {
            name: 'my.dotted endpoint',
            type: 'RPC',
            requestSchema: { type: 'null' },
            replySchema: { type: 'string' },
          },
        ],
        plugins: [graphitePlugin({ report: (lines) => reported.push(lines), prefix: 'test', intervalMs: 100 })],
      });

      const service = createService(spec, { 'my.dotted endpoint': async () => 'ok' });
      await service.ready();
      const client = createClient(spec);
      await delay(50);

      await client.RPC('my.dotted endpoint').call(null, { timeout: 2000 });

      await waitUntil(() => reported.some((r) => r.includes('test.rpc.my_dotted_endpoint')), 3000);

      const all = reported.join('\n');
      assert.ok(all.includes('test.rpc.my_dotted_endpoint.calls_per_sec'), 'name not sanitized properly');
      // Ensure original invalid name is NOT present as a metric path
      assert.ok(!all.includes('test.rpc.my.dotted endpoint'), 'unsanitized name found in metric path');

      client.close();
      await service.close();
      await delay(50);
    });
  });
});
