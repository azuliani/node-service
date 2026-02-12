/**
 * Graphite plugin — pushes process and endpoint metrics in Graphite plaintext format.
 */

import type { Descriptor } from '../types.ts';
import type { ServicePlugin } from '../plugins.ts';
import type { PubSubEndpoint } from '../endpoints/service/PubSubEndpoint.ts';
import type { SharedObjectEndpoint } from '../endpoints/service/SharedObjectEndpoint.ts';

export interface GraphitePluginOptions {
  /** Called each interval with a batch of Graphite plaintext lines. */
  report: (lines: string) => void;
  /** Metric path prefix, e.g. "services.myapp". No trailing dot. */
  prefix: string;
  /** Reporting interval in ms. Default: 10_000. */
  intervalMs?: number;
}

const WRAPPED = Symbol('graphiteWrapped');

/** Replace non-alphanumeric/underscore/hyphen chars with underscore. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function graphitePlugin(options: GraphitePluginOptions): ServicePlugin {
  const { report, prefix, intervalMs = 10_000 } = options;
  const intervalSec = intervalMs / 1000;

  // --- RPC state ---
  interface RpcEntry {
    calls: number;
    errors: number;
    windowTotalMs: number;
    windowCalls: number;
    windowMaxMs: number;
  }
  const rpcStats = new Map<string, RpcEntry>();
  const prevRpcStats = new Map<string, { calls: number; errors: number }>();

  const ensureRpc = (name: string): RpcEntry => {
    let entry = rpcStats.get(name);
    if (!entry) {
      entry = { calls: 0, errors: 0, windowTotalMs: 0, windowCalls: 0, windowMaxMs: 0 };
      rpcStats.set(name, entry);
    }
    return entry;
  };

  // --- PubSub state ---
  const pubsubCounts = new Map<string, { count: number }>();
  const prevPubsubCounts = new Map<string, number>();

  const ensurePubsub = (name: string): { count: number } => {
    let entry = pubsubCounts.get(name);
    if (!entry) {
      entry = { count: 0 };
      pubsubCounts.set(name, entry);
    }
    return entry;
  };

  // --- SharedObject state ---
  const soNotifyCounts = new Map<string, { count: number }>();
  const prevSoNotifyCounts = new Map<string, number>();
  const soEndpoints = new Map<string, SharedObjectEndpoint>();

  const ensureSoNotify = (name: string): { count: number } => {
    let entry = soNotifyCounts.get(name);
    if (!entry) {
      entry = { count: 0 };
      soNotifyCounts.set(name, entry);
    }
    return entry;
  };

  // --- Event loop delay ---
  let lastFlushTime = Date.now();

  // --- Flush ---
  function flush(): void {
    const now = Date.now();
    const timestamp = Math.floor(now / 1000);
    const eventLoopDelayMs = Math.max(0, now - lastFlushTime - intervalMs);
    lastFlushTime = now;

    const lines: string[] = [];
    const line = (path: string, value: number) => {
      lines.push(`${path} ${value} ${timestamp}`);
    };

    // Global metrics
    const mem = process.memoryUsage();
    line(`${prefix}.process.memory.rss_bytes`, mem.rss);
    line(`${prefix}.process.memory.heap_used_bytes`, mem.heapUsed);
    line(`${prefix}.process.memory.heap_total_bytes`, mem.heapTotal);
    line(`${prefix}.process.event_loop.delay_ms`, eventLoopDelayMs);

    // RPC metrics
    for (const [name, stats] of rpcStats) {
      const safe = sanitize(name);
      const prev = prevRpcStats.get(name) ?? { calls: 0, errors: 0 };

      const callsDelta = stats.calls - prev.calls;
      const errorsDelta = stats.errors - prev.errors;
      line(`${prefix}.rpc.${safe}.calls_per_sec`, callsDelta / intervalSec);
      line(`${prefix}.rpc.${safe}.errors_per_sec`, errorsDelta / intervalSec);

      const meanMs = stats.windowCalls > 0 ? stats.windowTotalMs / stats.windowCalls : 0;
      line(`${prefix}.rpc.${safe}.mean_ms`, meanMs);
      line(`${prefix}.rpc.${safe}.max_ms`, stats.windowMaxMs);

      prevRpcStats.set(name, { calls: stats.calls, errors: stats.errors });
      stats.windowTotalMs = 0;
      stats.windowCalls = 0;
      stats.windowMaxMs = 0;
    }

    // PubSub metrics
    for (const [name, entry] of pubsubCounts) {
      const safe = sanitize(name);
      const prev = prevPubsubCounts.get(name) ?? 0;
      const delta = entry.count - prev;
      line(`${prefix}.pubsub.${safe}.sends_per_sec`, delta / intervalSec);
      prevPubsubCounts.set(name, entry.count);
    }

    // SharedObject metrics
    for (const [name, entry] of soNotifyCounts) {
      const safe = sanitize(name);
      const prev = prevSoNotifyCounts.get(name) ?? 0;
      const delta = entry.count - prev;
      line(`${prefix}.sharedobject.${safe}.notifies_per_sec`, delta / intervalSec);
      prevSoNotifyCounts.set(name, entry.count);
    }
    for (const [name, endpoint] of soEndpoints) {
      const safe = sanitize(name);
      line(`${prefix}.sharedobject.${safe}.size_bytes`, JSON.stringify(endpoint.rawData).length);
      line(`${prefix}.sharedobject.${safe}.version`, endpoint.version);
    }

    report(lines.join('\n') + '\n');
  }

  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    name: 'graphite',
    wrapHandlers: (handlers) => {
      const wrapped: typeof handlers = {};
      for (const [name, handler] of Object.entries(handlers)) {
        wrapped[name] = async (input) => {
          const rpc = ensureRpc(name);
          const start = Date.now();
          try {
            const result = await handler(input);
            const duration = Date.now() - start;
            rpc.calls += 1;
            rpc.windowCalls += 1;
            rpc.windowTotalMs += duration;
            rpc.windowMaxMs = Math.max(rpc.windowMaxMs, duration);
            return result;
          } catch (err) {
            const duration = Date.now() - start;
            rpc.calls += 1;
            rpc.errors += 1;
            rpc.windowCalls += 1;
            rpc.windowTotalMs += duration;
            rpc.windowMaxMs = Math.max(rpc.windowMaxMs, duration);
            throw err;
          }
        };
      }
      return wrapped;
    },
    onServiceReady: (service, descriptor: Descriptor) => {
      for (const endpoint of descriptor.endpoints) {
        switch (endpoint.type) {
          case 'PubSub': {
            const source = service.getEndpoint<PubSubEndpoint>(endpoint.name);
            const original = (source as any).send as (message: unknown) => unknown;
            if (!(original as any)[WRAPPED]) {
              const wrapped = function (this: PubSubEndpoint, message: unknown) {
                ensurePubsub(endpoint.name).count += 1;
                return original.call(this, message);
              };
              (wrapped as any)[WRAPPED] = true;
              (source as any).send = wrapped;
            }
            break;
          }
          case 'SharedObject': {
            const shared = service.getEndpoint<SharedObjectEndpoint>(endpoint.name);
            soEndpoints.set(endpoint.name, shared);
            const original = (shared as any).notify as (hint?: string[]) => unknown;
            if (!(original as any)[WRAPPED]) {
              const wrapped = function (this: SharedObjectEndpoint, hint?: string[]) {
                ensureSoNotify(endpoint.name).count += 1;
                return original.call(this, hint);
              };
              (wrapped as any)[WRAPPED] = true;
              (shared as any).notify = wrapped;
            }
            break;
          }
          case 'RPC':
            break;
          default: {
            const _exhaustive: never = endpoint;
            return _exhaustive;
          }
        }
      }

      // Start the flush interval after the service is ready.
      lastFlushTime = Date.now();
      timer = setInterval(flush, intervalMs);
      timer.unref?.();
    },
  };
}
