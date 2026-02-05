/**
 * node-service: WebSocket-based messaging library with Service/Client abstractions.
 *
 * ## Public API
 * Runtime exports are intentionally minimal:
 * - `Service`
 * - `Client`
 *
 * TypeScript users also get type-only exports from `types.ts` for descriptors and
 * endpoint definitions (they do not exist at runtime).
 *
 * ## Example (RPC)
 * ```ts
 * import { Service, Client } from 'node-service';
 * import type { Descriptor, RPCEndpoint } from 'node-service';
 *
 * const descriptor: Descriptor = {
 *   transport: { server: '127.0.0.1:3000', client: '127.0.0.1:3000' },
 *   endpoints: [
 *     {
 *       name: 'greet',
 *       type: 'RPC',
 *       requestSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
 *       replySchema: { type: 'string' },
 *     } as RPCEndpoint,
 *   ],
 * };
 *
 * const service = new Service(descriptor, {
 *   greet: async ({ name }: { name: string }) => `Hello, ${name}!`,
 * }, {});
 * await service.ready();
 *
 * const client = new Client(descriptor);
 * const reply = await client.RPC('greet').call({ name: 'World' });
 * console.log(reply);
 * ```
 *
 * ## Example (SharedObject)
 * ```ts
 * import { Service, Client } from 'node-service';
 * import type { Descriptor, SharedObjectEndpoint } from 'node-service';
 *
 * const descriptor: Descriptor = {
 *   transport: { server: '127.0.0.1:3001', client: '127.0.0.1:3001' },
 *   endpoints: [
 *     {
 *       name: 'Counter',
 *       type: 'SharedObject',
 *       objectSchema: { type: 'object', properties: { value: { type: 'number' } } },
 *     } as SharedObjectEndpoint,
 *   ],
 * };
 *
 * const service = new Service(descriptor, {}, { Counter: { value: 0 } });
 * await service.ready();
 *
 * const client = new Client(descriptor);
 * client.SO('Counter').on('init', () => console.log('init', client.SO('Counter').data));
 * client.SO('Counter').on('update', () => console.log('update', client.SO('Counter').data));
 * await client.SO('Counter').subscribe();
 *
 * service.SO('Counter').data.value += 1;
 * service.SO('Counter').notify(['value']);
 * ```
 *
 * @packageDocumentation
 */

// Runtime exports (minimal surface)
export { Service } from './Service.ts';
export { Client } from './Client.ts';
export { defineServiceSpec, createService, createClient } from './plugins.ts';
export { healthPlugin } from './plugins/health.ts';
export { metricsPlugin } from './plugins/metrics.ts';
export { auditLogPlugin } from './plugins/auditLog.ts';
export { ErrorCode, hasErrorCode, getErrorCode } from './errors.ts';

// Type-only exports
export type {
  Diff,
  JSONSchema,
  TransportConfig,
  Descriptor,
  Endpoint,
  RPCEndpoint,
  PubSubEndpoint,
  PushPullEndpoint,
  SharedObjectEndpoint,
  ServiceOptions,
  ClientOptions,
  RPCHandler,
  Handlers,
  Initials,
  SerializedError,
  HeartbeatMessage,
} from './types.ts';

export type {
  SubFrame,
  UnsubFrame,
  RpcRequestFrame,
  RpcResponseFrame,
  EndpointMessageFrame,
  HeartbeatFrame,
  SharedObjectInitFrame,
  SharedObjectUpdateFrame,
} from './wire.ts';

export type { ClientTransport } from './transports/ClientTransport.ts';
export type { ServerTransport } from './transports/ServerTransport.ts';

export type { ServicePlugin, ServiceSpec, DefineServiceSpecInput } from './plugins.ts';
export type { HealthInfo } from './plugins/health.ts';
export type { MetricsSnapshot } from './plugins/metrics.ts';
export type { AuditEvent } from './plugins/auditLog.ts';
