/**
 * Audit log plugin.
 */

import type { Descriptor } from '../types.ts';
import type { ServicePlugin } from '../plugins.ts';
import type { PubSubEndpoint } from '../endpoints/service/PubSubEndpoint.ts';
import type { PushPullEndpoint } from '../endpoints/service/PushPullEndpoint.ts';
import type { SharedObjectEndpoint } from '../endpoints/service/SharedObjectEndpoint.ts';

export interface AuditEvent {
  type: 'rpc' | 'pubsub' | 'pushpull' | 'sharedobject';
  endpoint: string;
  at: string;
  ok?: boolean;
  durationMs?: number;
  queued?: boolean;
  error?: { name: string; message: string; code?: string };
}

const AUDIT_ENDPOINT = '_audit';
const WRAPPED = Symbol('auditWrapped');

export function auditLogPlugin(): ServicePlugin {
  const pending: AuditEvent[] = [];
  let pubsub: PubSubEndpoint | null = null;

  const emit = (event: AuditEvent) => {
    if (pubsub) {
      pubsub.send(event);
      return;
    }
    pending.push(event);
    if (pending.length > 1000) {
      pending.shift();
    }
  };

  return {
    name: 'auditLog',
    endpoints: [
      {
        name: AUDIT_ENDPOINT,
        type: 'PubSub',
        messageSchema: {
          type: 'object',
          required: ['type', 'endpoint', 'at'],
          additionalProperties: true,
          properties: {
            type: { type: 'string' },
            endpoint: { type: 'string' },
            at: { type: 'string', format: 'date-time' },
            ok: { type: 'boolean' },
            durationMs: { type: 'number' },
            queued: { type: 'boolean' },
            error: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: { type: 'string' },
                message: { type: 'string' },
                code: { type: 'string' },
              },
            },
          },
        },
      },
    ],
    wrapHandlers: (handlers) => {
      const wrapped: typeof handlers = {};
      for (const [name, handler] of Object.entries(handlers)) {
        if (name === AUDIT_ENDPOINT) {
          wrapped[name] = handler;
          continue;
        }

        wrapped[name] = async (input) => {
          const start = Date.now();
          try {
            const result = await handler(input);
            emit({
              type: 'rpc',
              endpoint: name,
              at: new Date().toISOString(),
              ok: true,
              durationMs: Date.now() - start,
            });
            return result;
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            emit({
              type: 'rpc',
              endpoint: name,
              at: new Date().toISOString(),
              ok: false,
              durationMs: Date.now() - start,
              error: {
                name: error.name,
                message: error.message,
                ...(typeof (error as any).code === 'string' ? { code: (error as any).code } : {}),
              },
            });
            throw err;
          }
        };
      }
      return wrapped;
    },
    onServiceReady: (service, descriptor: Descriptor) => {
      pubsub = service.getEndpoint<PubSubEndpoint>(AUDIT_ENDPOINT);
      while (pending.length > 0) {
        const event = pending.shift();
        if (event) pubsub.send(event);
      }

      for (const endpoint of descriptor.endpoints) {
        switch (endpoint.type) {
          case 'PubSub': {
            if (endpoint.name === AUDIT_ENDPOINT) {
              break;
            }
            const src = service.getEndpoint<PubSubEndpoint>(endpoint.name);
            const original = (src as any).send as (message: unknown) => unknown;
            if (!(original as any)[WRAPPED]) {
              const wrapped = function (this: PubSubEndpoint, message: unknown) {
                emit({ type: 'pubsub', endpoint: endpoint.name, at: new Date().toISOString() });
                return original.call(this, message);
              };
              (wrapped as any)[WRAPPED] = true;
              (src as any).send = wrapped;
            }
            break;
          }
          case 'PushPull': {
            const pushpull = service.getEndpoint<PushPullEndpoint>(endpoint.name);
            const original = (pushpull as any).push as (message: unknown) => boolean;
            if (!(original as any)[WRAPPED]) {
              const wrapped = function (this: PushPullEndpoint, message: unknown) {
                const ok = original.call(this, message) as boolean;
                emit({
                  type: 'pushpull',
                  endpoint: endpoint.name,
                  at: new Date().toISOString(),
                  queued: !ok,
                });
                return ok;
              };
              (wrapped as any)[WRAPPED] = true;
              (pushpull as any).push = wrapped;
            }
            break;
          }
          case 'SharedObject': {
            const shared = service.getEndpoint<SharedObjectEndpoint>(endpoint.name);
            const original = (shared as any).notify as (hint?: string[]) => unknown;
            if (!(original as any)[WRAPPED]) {
              const wrapped = function (this: SharedObjectEndpoint, hint?: string[]) {
                emit({ type: 'sharedobject', endpoint: endpoint.name, at: new Date().toISOString() });
                return original.call(this, hint);
              };
              (wrapped as any)[WRAPPED] = true;
              (shared as any).notify = wrapped;
            }
            break;
          }
          case 'RPC': {
            // RPC logging handled by wrapHandlers.
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
