/**
 * Metrics plugin.
 */

import type { Descriptor } from '../types.ts';
import type { ServicePlugin } from '../plugins.ts';
import type { PubSubEndpoint } from '../endpoints/service/PubSubEndpoint.ts';
import type { PushPullEndpoint } from '../endpoints/service/PushPullEndpoint.ts';
import type { SharedObjectEndpoint } from '../endpoints/service/SharedObjectEndpoint.ts';

interface RpcMetrics {
  calls: number;
  errors: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

export interface MetricsSnapshot {
  startedAt: string;
  rpc: Record<string, { calls: number; errors: number; avgMs: number; minMs: number; maxMs: number }>;
  pubsub: Record<string, { count: number }>;
  pushpull: Record<string, { pushes: number; queued: number }>;
  sharedobject: Record<string, { count: number }>;
}

const METRICS_ENDPOINT = '_metrics';

const WRAPPED = Symbol('metricsWrapped');

function initRpcMetrics(): RpcMetrics {
  return { calls: 0, errors: 0, totalMs: 0, minMs: 0, maxMs: 0 };
}

function recordRpc(metrics: RpcMetrics, durationMs: number, ok: boolean): void {
  metrics.calls += 1;
  if (!ok) metrics.errors += 1;
  metrics.totalMs += durationMs;
  if (metrics.calls === 1) {
    metrics.minMs = durationMs;
    metrics.maxMs = durationMs;
  } else {
    metrics.minMs = Math.min(metrics.minMs, durationMs);
    metrics.maxMs = Math.max(metrics.maxMs, durationMs);
  }
}

function toRpcSnapshot(metrics: RpcMetrics): { calls: number; errors: number; avgMs: number; minMs: number; maxMs: number } {
  if (metrics.calls === 0) {
    return { calls: 0, errors: 0, avgMs: 0, minMs: 0, maxMs: 0 };
  }
  return {
    calls: metrics.calls,
    errors: metrics.errors,
    avgMs: metrics.totalMs / metrics.calls,
    minMs: metrics.minMs,
    maxMs: metrics.maxMs,
  };
}

export function metricsPlugin(): ServicePlugin {
  const startedAt = new Date().toISOString();
  const rpcMetrics = new Map<string, RpcMetrics>();
  const pubSubCounts = new Map<string, { count: number }>();
  const pushPullCounts = new Map<string, { pushes: number; queued: number }>();
  const sharedObjectCounts = new Map<string, { count: number }>();

  const ensureCount = (map: Map<string, { count: number }>, name: string): { count: number } => {
    let entry = map.get(name);
    if (!entry) {
      entry = { count: 0 };
      map.set(name, entry);
    }
    return entry;
  };

  const ensurePushPull = (name: string): { pushes: number; queued: number } => {
    let entry = pushPullCounts.get(name);
    if (!entry) {
      entry = { pushes: 0, queued: 0 };
      pushPullCounts.set(name, entry);
    }
    return entry;
  };

  const snapshot = (): MetricsSnapshot => ({
    startedAt,
    rpc: Object.fromEntries(
      Array.from(rpcMetrics.entries()).map(([name, metrics]) => [name, toRpcSnapshot(metrics)])
    ),
    pubsub: Object.fromEntries(pubSubCounts),
    pushpull: Object.fromEntries(pushPullCounts),
    sharedobject: Object.fromEntries(sharedObjectCounts),
  });

  return {
    name: 'metrics',
    endpoints: [
      {
        name: METRICS_ENDPOINT,
        type: 'RPC',
        requestSchema: { type: 'null' },
        replySchema: {
          type: 'object',
          additionalProperties: false,
          required: ['startedAt', 'rpc', 'pubsub', 'pushpull', 'sharedobject'],
          properties: {
            startedAt: { type: 'string', format: 'date-time' },
            rpc: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: false,
                required: ['calls', 'errors', 'avgMs', 'minMs', 'maxMs'],
                properties: {
                  calls: { type: 'number' },
                  errors: { type: 'number' },
                  avgMs: { type: 'number' },
                  minMs: { type: 'number' },
                  maxMs: { type: 'number' },
                },
              },
            },
            pubsub: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: false,
                required: ['count'],
                properties: {
                  count: { type: 'number' },
                },
              },
            },
            pushpull: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: false,
                required: ['pushes', 'queued'],
                properties: {
                  pushes: { type: 'number' },
                  queued: { type: 'number' },
                },
              },
            },
            sharedobject: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: false,
                required: ['count'],
                properties: {
                  count: { type: 'number' },
                },
              },
            },
          },
        },
      },
    ],
    handlers: {
      [METRICS_ENDPOINT]: async () => snapshot(),
    },
    wrapHandlers: (handlers) => {
      const wrapped: typeof handlers = {};
      for (const [name, handler] of Object.entries(handlers)) {
        if (name === METRICS_ENDPOINT) {
          wrapped[name] = handler;
          continue;
        }

        wrapped[name] = async (input) => {
          const start = Date.now();
          try {
            const result = await handler(input);
            const duration = Date.now() - start;
            const metrics = rpcMetrics.get(name) ?? initRpcMetrics();
            rpcMetrics.set(name, metrics);
            recordRpc(metrics, duration, true);
            return result;
          } catch (err) {
            const duration = Date.now() - start;
            const metrics = rpcMetrics.get(name) ?? initRpcMetrics();
            rpcMetrics.set(name, metrics);
            recordRpc(metrics, duration, false);
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
            const original = (source as any).send as Function;
            if (!(original as any)[WRAPPED]) {
              const wrapped = function (this: PubSubEndpoint, message: unknown) {
                const entry = ensureCount(pubSubCounts, endpoint.name);
                entry.count += 1;
                return original.call(this, message);
              };
              (wrapped as any)[WRAPPED] = true;
              (source as any).send = wrapped;
            }
            break;
          }
          case 'PushPull': {
            const pushpull = service.getEndpoint<PushPullEndpoint>(endpoint.name);
            const original = (pushpull as any).push as Function;
            if (!(original as any)[WRAPPED]) {
              const wrapped = function (this: PushPullEndpoint, message: unknown) {
                const entry = ensurePushPull(endpoint.name);
                const ok = original.call(this, message) as boolean;
                if (ok) {
                  entry.pushes += 1;
                } else {
                  entry.queued += 1;
                }
                return ok;
              };
              (wrapped as any)[WRAPPED] = true;
              (pushpull as any).push = wrapped;
            }
            break;
          }
          case 'SharedObject': {
            const shared = service.getEndpoint<SharedObjectEndpoint>(endpoint.name);
            const original = (shared as any).notify as Function;
            if (!(original as any)[WRAPPED]) {
              const wrapped = function (this: SharedObjectEndpoint, hint?: string[]) {
                const entry = ensureCount(sharedObjectCounts, endpoint.name);
                entry.count += 1;
                return original.call(this, hint);
              };
              (wrapped as any)[WRAPPED] = true;
              (shared as any).notify = wrapped;
            }
            break;
          }
          case 'RPC': {
            // RPC metrics handled by wrapHandlers.
            break;
          }
          default: {
            const _exhaustive: never = endpoint;
            return _exhaustive;
          }
        }
      }
    },
  };
}
