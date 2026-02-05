/**
 * Core type definitions for the messaging library.
 */

import type { TreeDelta } from '@azuliani/tree-diff';
import type { ClientTransport } from './transports/ClientTransport.ts';
import type { ServerTransport } from './transports/ServerTransport.ts';

/**
 * SharedObject delta format from `@azuliani/tree-diff`.
 */
export type Diff = TreeDelta;

/**
 * JSON Schema definition (subset relevant for this library)
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  additionalProperties?: boolean | JSONSchema;
  items?: JSONSchema | JSONSchema[];
  required?: string[];
  format?: string;
  enum?: any[];
  const?: any;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: any;
  description?: string;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: JSONSchema;
}

/**
 * Transport configuration.
 * - `client`: Base URL for client connections (e.g., "localhost:3000")
 * - `server`: Bind address for server (e.g., "0.0.0.0:3000")
 *
 * All patterns use a single WebSocket connection at `ws://{client}/`.
 */
export interface TransportConfig {
  client: string;
  server: string;
}

/**
 * RPC endpoint definition.
 */
export interface RPCEndpoint {
  name: string;
  type: 'RPC';
  requestSchema: JSONSchema;
  replySchema: JSONSchema;
}

/**
 * PubSub endpoint definition (plain publish/subscribe).
 */
export interface PubSubEndpoint {
  name: string;
  type: 'PubSub';
  messageSchema: JSONSchema;
}

/**
 * PushPull endpoint definition (work distribution).
 */
export interface PushPullEndpoint {
  name: string;
  type: 'PushPull';
  messageSchema: JSONSchema;
}

/**
 * SharedObject endpoint definition (state synchronization).
 */
export interface SharedObjectEndpoint {
  name: string;
  type: 'SharedObject';
  objectSchema: JSONSchema;
  /**
   * Whether mutations to `data` automatically trigger batched notifications.
   * When true (default), changes are detected via proxy and batched via setImmediate.
   * When false, you must call `notify()` manually after making changes.
   */
  autoNotify?: boolean;
}

/**
 * Union of all endpoint types.
 */
export type Endpoint =
  | RPCEndpoint
  | PubSubEndpoint
  | PushPullEndpoint
  | SharedObjectEndpoint;

/**
 * Service/Client descriptor defining transport and endpoints.
 */
export interface Descriptor {
  transport: TransportConfig;
  endpoints: Endpoint[];
}

/**
 * Service configuration options.
 */
export interface ServiceOptions {
  /** Heartbeat interval in milliseconds. Default: 5000 */
  heartbeatMs?: number;
  /**
   * Override the server transport implementation.
   * Default: uWebSockets.js transport.
   */
  serverTransport?: ServerTransport<any>;
}

/**
 * Client configuration options.
 */
export interface ClientOptions {
  /** Timeout waiting for init message in milliseconds. Default: 3000 */
  initTimeout?: number;
  /**
   * Override the client transport implementation.
   * Default: `ws` transport.
   */
  clientTransport?: ClientTransport;
}

/**
 * Handler function type for RPC endpoints.
 */
export type RPCHandler<TInput = any, TOutput = any> = (input: TInput) => Promise<TOutput>;

/**
 * Map of endpoint names to handler functions.
 */
export type Handlers = Record<string, RPCHandler>;

/**
 * Map of endpoint names to initial state (for SharedObject endpoints).
 *
 * Required for every SharedObject endpoint on the Service.
 */
export type Initials = Record<string, any>;

/**
 * Serialized error format for RPC transmission.
 */
export interface SerializedError {
  message: string;
  name: string;
  code?: string;
  endpoint?: string;
  stack?: string;
}

/**
 * Heartbeat message wire format.
 */
export interface HeartbeatMessage {
  type: 'heartbeat';
  frequencyMs: number;
}
