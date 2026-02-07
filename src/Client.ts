/**
 * Client class - Client-side implementation.
 *
 * Creates and manages a single mux connection and endpoints.
 */

import { EventEmitter } from 'events';
import createDebug from 'debug';
import { DescriptorMismatchError } from './errors.ts';
import { computeEndpointsHash, validateConnectionConfig } from './helpers.ts';
import type {
  ConnectionConfig,
  Descriptor,
  ClientOptions,
} from './types.ts';
import type { HeartbeatFrame } from './wire.ts';
import { RPCClient } from './endpoints/client/RPCClient.ts';
import { PubSubClient } from './endpoints/client/PubSubClient.ts';
import { SharedObjectClient } from './endpoints/client/SharedObjectClient.ts';
import { MuxClient } from './mux/MuxClient.ts';
import { WsClientTransport } from './transports/WsClientTransport.ts';

const debug = createDebug('node-service:client');

function getClientEndpointType(
  endpoint: RPCClient | PubSubClient | SharedObjectClient
): 'RPC' | 'PubSub' | 'SharedObject' {
  if (endpoint instanceof RPCClient) return 'RPC';
  if (endpoint instanceof PubSubClient) return 'PubSub';
  return 'SharedObject';
}

/**
 * Client class for client-side messaging.
 */
export class Client extends EventEmitter {
  private _descriptor: Descriptor;
  private _options: { initTimeout: number; clientTransport?: ClientOptions['clientTransport'] };
  private _descriptorHash: string;
  private _connection: ConnectionConfig;
  private _mux: MuxClient;

  // Heartbeat
  private _heartbeatFrequencyMs: number | null = null;
  private _lastMessageTime: number = 0;
  private _heartbeatCheckInterval: ReturnType<typeof setInterval> | null = null;
  private _descriptorValidated = false;

  // Endpoint instances
  private _endpoints: Map<string, RPCClient | PubSubClient | SharedObjectClient> =
    new Map();
  private _pubSubClients: PubSubClient[] = [];
  private _sharedObjectClients: SharedObjectClient[] = [];

  constructor(descriptor: Descriptor, options: ClientOptions = {}) {
    super();
    this._descriptor = descriptor;
    this._options = {
      initTimeout: options.initTimeout ?? 3000,
      ...(options.clientTransport ? { clientTransport: options.clientTransport } : {}),
    };

    // Validate both sides to enforce descriptor transport shape at runtime.
    validateConnectionConfig(descriptor.transport.server, 'transport.server');
    this._connection = validateConnectionConfig(descriptor.transport.client, 'transport.client');

    const wsUrl = `ws://${this._connection.host}:${this._connection.port}/`;
    const transport = this._options.clientTransport ?? new WsClientTransport();
    this._mux = new MuxClient(transport, wsUrl);
    // Set maxListeners based on endpoint count to avoid spurious warnings.
    // Each PubSub adds 3 (open, close, error), each SharedObject adds 2 (open, close),
    // plus Client's own listeners (heartbeat: 1, rawMessage: 1).
    const listenerCount = this._descriptor.endpoints.reduce((n, ep) => {
      if (ep.type === 'PubSub') return n + 3;
      if (ep.type === 'SharedObject') return n + 2;
      return n;
    }, 2) + 10; // pad with 10 for headroom
    this._mux.setMaxListeners(listenerCount);
    this._mux.on('heartbeat', (hb: HeartbeatFrame) => this._handleHeartbeat(hb));
    this._mux.on('rawMessage', () => {
      if (this._lastMessageTime > 0) this._lastMessageTime = Date.now();
    });
    this._mux.connect();

    // Compute descriptor hash for validation
    this._descriptorHash = computeEndpointsHash(this._descriptor.endpoints);

    // Initialize endpoints
    this._initEndpoints();
  }

  /**
   * Get a typed endpoint by name.
   *
   * @param name - The endpoint name
   * @returns The endpoint instance
   * @throws Error if endpoint doesn't exist
   *
   * @example
   * ```typescript
   * const state = client.getEndpoint<SharedObjectClient<MyState>>('State');
   * await state.subscribe();
   * console.log(state.data);
   * ```
   */
  getEndpoint<T = unknown>(name: string): T {
    const ep = this._endpoints.get(name);
    if (!ep) {
      throw new Error(`Unknown endpoint: ${name}`);
    }
    return ep as T;
  }

  /**
   * Get an RPC endpoint by name.
   */
  RPC(name: string): RPCClient {
    const ep = this._endpoints.get(name);
    if (!ep) throw new Error(`Unknown endpoint: ${name}`);
    if (!(ep instanceof RPCClient)) {
      throw new Error(`Endpoint "${name}" is ${getClientEndpointType(ep)}, expected RPC`);
    }
    return ep;
  }

  /**
   * Get a PubSub endpoint by name.
   */
  PS(name: string): PubSubClient {
    const ep = this._endpoints.get(name);
    if (!ep) throw new Error(`Unknown endpoint: ${name}`);
    if (!(ep instanceof PubSubClient)) {
      throw new Error(`Endpoint "${name}" is ${getClientEndpointType(ep)}, expected PubSub`);
    }
    return ep;
  }

  /**
   * Get a SharedObject endpoint by name.
   */
  SO<T extends object = object>(name: string): SharedObjectClient<T> {
    const ep = this._endpoints.get(name);
    if (!ep) throw new Error(`Unknown endpoint: ${name}`);
    if (!(ep instanceof SharedObjectClient)) {
      throw new Error(`Endpoint "${name}" is ${getClientEndpointType(ep)}, expected SharedObject`);
    }
    return ep as unknown as SharedObjectClient<T>;
  }

  /**
   * Close all transports.
   */
  close(): void {
    debug('Closing client');

    // Stop heartbeat checking
    if (this._heartbeatCheckInterval) {
      clearInterval(this._heartbeatCheckInterval);
      this._heartbeatCheckInterval = null;
    }

    // Close all PubSub clients
    for (const client of this._pubSubClients) {
      client.close();
    }

    // Close all SharedObject clients
    for (const client of this._sharedObjectClients) {
      client.close();
    }

    // Close mux connection
    this._mux.close();

    debug('Client closed');
  }

  /**
   * Initialize endpoints based on descriptor.
   */
  private _initEndpoints(): void {
    for (const endpoint of this._descriptor.endpoints) {
      switch (endpoint.type) {
        case 'RPC': {
          const rpcClient = new RPCClient(this._mux, endpoint);
          this._endpoints.set(endpoint.name, rpcClient);
          break;
        }

        case 'PubSub': {
          const pubSubClient = new PubSubClient(this._mux, endpoint);
          this._endpoints.set(endpoint.name, pubSubClient);
          this._pubSubClients.push(pubSubClient);
          break;
        }

        case 'SharedObject': {
          const sharedObjClient = new SharedObjectClient(
            this._mux,
            endpoint,
            { initTimeout: this._options.initTimeout }
          );
          this._endpoints.set(endpoint.name, sharedObjClient);
          this._sharedObjectClients.push(sharedObjClient);
          break;
        }
      }
    }
  }

  /**
   * Handle heartbeat message.
   */
  private _handleHeartbeat(heartbeat: HeartbeatFrame): void {
    debug('Received heartbeat (frequencyMs: %d)', heartbeat.frequencyMs);

    this._lastMessageTime = Date.now();

    // Learn frequency from first heartbeat
    if (this._heartbeatFrequencyMs === null) {
      this._heartbeatFrequencyMs = heartbeat.frequencyMs;
      this._startHeartbeatChecking();
    }

    // Validate descriptor on first heartbeat if not already done
    if (!this._descriptorValidated) {
      this._validateDescriptor();
    }
  }

  /**
   * Start checking for heartbeat timeout.
   */
  private _startHeartbeatChecking(): void {
    if (this._heartbeatCheckInterval) return;
    if (!this._heartbeatFrequencyMs) return;

    const checkInterval = this._heartbeatFrequencyMs;
    const timeout = this._heartbeatFrequencyMs * 3;

    this._heartbeatCheckInterval = setInterval(() => {
      if (this._lastMessageTime === 0) return;

      const elapsed = Date.now() - this._lastMessageTime;
      if (elapsed > timeout) {
        debug('Heartbeat timeout (elapsed: %dms, threshold: %dms)', elapsed, timeout);
        this._handleHeartbeatTimeout();
      }
    }, checkInterval);
    this._heartbeatCheckInterval!.unref();
  }

  /**
   * Handle heartbeat timeout.
   */
  private _handleHeartbeatTimeout(): void {
    // Stop further checking — will restart on next heartbeat after reconnect
    if (this._heartbeatCheckInterval) {
      clearInterval(this._heartbeatCheckInterval);
      this._heartbeatCheckInterval = null;
    }
    this._heartbeatFrequencyMs = null;
    this._lastMessageTime = 0;

    // Emit disconnected events on all endpoints
    for (const client of this._pubSubClients) {
      client.handleDisconnect();
    }
    for (const client of this._sharedObjectClients) {
      client.handleDisconnect();
    }
  }

  /**
   * Validate descriptor against server.
   */
  private async _validateDescriptor(): Promise<void> {
    if (this._descriptorValidated) return;

    try {
      const serverHash = await this._mux.rpcCall('_descriptor', null, 5000);

      if (serverHash !== this._descriptorHash) {
        throw new DescriptorMismatchError(
          `Descriptor mismatch: client=${this._descriptorHash.slice(0, 8)}... server=${serverHash.slice(0, 8)}...`
        );
      }

      this._descriptorValidated = true;
      debug('Descriptor validated');
    } catch (err) {
      if (err instanceof DescriptorMismatchError) {
        this.emit('error', err);
        this.close();
        return;
      }
      // Transient errors (timeout, connection) are debug-only — will retry on next heartbeat
      debug('Descriptor validation failed: %o', err);
    }
  }
}
