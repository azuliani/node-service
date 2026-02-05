/**
 * Service class - Server-side implementation.
 *
 * Creates and manages server-side transport + mux and endpoints.
 */

import createDebug from 'debug';
import { MissingHandlerError, TimeoutError, UnknownEndpointError, getErrorCode } from './errors.ts';
import { compileSchema, serializeDates } from './validation.ts';
import { parseHostPort, computeEndpointsHash } from './helpers.ts';
import type { CompiledValidator } from './validation.ts';
import type {
  Descriptor,
  Handlers,
  Initials,
  ServiceOptions,
  SerializedError,
} from './types.ts';
import type { ServerTransport } from './transports/ServerTransport.ts';
import { UwsServerTransport } from './transports/UwsServerTransport.ts';
import { MuxServer } from './mux/MuxServer.ts';
import { PubSubEndpoint } from './endpoints/service/PubSubEndpoint.ts';
import { PushPullEndpoint } from './endpoints/service/PushPullEndpoint.ts';
import { SharedObjectEndpoint } from './endpoints/service/SharedObjectEndpoint.ts';
import type { RpcRequestFrame } from './wire.ts';

const debug = createDebug('node-service:service');

function getServiceEndpointType(
  endpoint: PubSubEndpoint | PushPullEndpoint | SharedObjectEndpoint
): 'PubSub' | 'PushPull' | 'SharedObject' {
  if (endpoint instanceof PubSubEndpoint) return 'PubSub';
  if (endpoint instanceof PushPullEndpoint) return 'PushPull';
  return 'SharedObject';
}

/**
 * Service class for server-side messaging.
 */
export class Service {
  private _descriptor: Descriptor;
  private _handlers: Handlers;
  private _initials: Initials;
  private _options: { heartbeatMs: number; serverTransport?: ServerTransport<any> };
  private _descriptorHash: string;

  // Transport + mux
  private _transport: ServerTransport<any> | null = null;
  private _mux: MuxServer<any> | null = null;

  // Heartbeat
  private _heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // Ready state
  private _readyPromise: Promise<void>;
  private _readyResolve!: () => void;
  private _readyReject!: (err: Error) => void;
  private _readySettled = false;

  // Endpoint instances
  private _endpoints: Map<string, PubSubEndpoint | PushPullEndpoint | SharedObjectEndpoint> = new Map();
  private _rpcValidators: Map<string, { request: CompiledValidator; reply: CompiledValidator }> = new Map();
  private _rpcInvokers: Map<string, { name: string; call: <TInput = unknown, TOutput = unknown>(input: TInput, timeout?: number) => Promise<TOutput> }> = new Map();

  constructor(
    descriptor: Descriptor,
    handlers: Handlers,
    initials: Initials,
    options: ServiceOptions = {}
  ) {
    this._descriptor = descriptor;
    this._handlers = handlers;
    this._initials = initials;
    this._options = {
      heartbeatMs: options.heartbeatMs ?? 5000,
      ...(options.serverTransport ? { serverTransport: options.serverTransport } : {}),
    };

    // Create ready promise
    this._readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = () => {
        if (!this._readySettled) {
          this._readySettled = true;
          resolve();
        }
      };
      this._readyReject = (err: Error) => {
        if (!this._readySettled) {
          this._readySettled = true;
          reject(err);
        }
      };
    });

    // Compute descriptor hash for validation
    this._descriptorHash = computeEndpointsHash(this._descriptor.endpoints);

    // Validate that all RPC endpoints have handlers
    this._validateHandlers();

    // Initialize transports and endpoints
    this._init();
  }

  /**
   * Wait for the service to be ready (server listening).
   */
  ready(): Promise<void> {
    return this._readyPromise;
  }

  /**
   * Close all transports and stop heartbeat.
   */
  close(): Promise<void> {
    debug('Closing service');

    // Stop heartbeat
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }

    // Close transport (which closes all WS connections)
    if (this._transport) {
      const t = this._transport;
      this._transport = null;
      this._mux = null;
      return t.close().then(() => {
        debug('Service closed');
      });
    }

    debug('Service closed');
    return Promise.resolve();
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
   * const state = service.getEndpoint<SharedObjectEndpoint<MyState>>('State');
   * state.data.counter++;
   * state.notify(['counter']);
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
   * Get an RPC endpoint by name (local invocation).
   *
   * This does not use the network/mux; it validates input/output against the
   * descriptor schemas and calls the handler directly.
   */
  RPC(name: string): {
    name: string;
    call: <TInput = unknown, TOutput = unknown>(input: TInput, timeout?: number) => Promise<TOutput>;
  } {
    const cached = this._rpcInvokers.get(name);
    if (cached) return cached;

    const validators = this._rpcValidators.get(name);
    const handler = this._handlers[name];

    if (!validators || !handler) {
      const nonRpc = this._endpoints.get(name);
      if (nonRpc) {
        throw new Error(`Endpoint "${name}" is ${getServiceEndpointType(nonRpc)}, expected RPC`);
      }
      throw new Error(`Unknown endpoint: ${name}`);
    }

    const invoker = {
      name,
      call: async <TInput = unknown, TOutput = unknown>(input: TInput, timeout = 10000): Promise<TOutput> => {
        const serializedInput = serializeDates(input);
        const validatedInput = validators.request.validateAndParseDates(serializedInput);

        const handlerPromise = Promise.resolve(handler(validatedInput));
        const result = await withTimeout(handlerPromise, timeout);

        const serializedOutput = serializeDates(result);
        validators.reply.validate(serializedOutput);
        return validators.reply.validateAndParseDates(serializedOutput) as TOutput;
      },
    };

    this._rpcInvokers.set(name, invoker);
    return invoker;
  }

  /**
   * Get a PubSub endpoint by name.
   */
  PS(name: string): PubSubEndpoint {
    const ep = this._endpoints.get(name);
    if (!ep) throw new Error(`Unknown endpoint: ${name}`);
    if (!(ep instanceof PubSubEndpoint)) {
      throw new Error(`Endpoint "${name}" is ${getServiceEndpointType(ep)}, expected PubSub`);
    }
    return ep;
  }

  /**
   * Get a PushPull endpoint by name.
   */
  PP(name: string): PushPullEndpoint {
    const ep = this._endpoints.get(name);
    if (!ep) throw new Error(`Unknown endpoint: ${name}`);
    if (!(ep instanceof PushPullEndpoint)) {
      throw new Error(`Endpoint "${name}" is ${getServiceEndpointType(ep)}, expected PushPull`);
    }
    return ep;
  }

  /**
   * Get a SharedObject endpoint by name.
   */
  SO<T extends object = object>(name: string): SharedObjectEndpoint<T> {
    const ep = this._endpoints.get(name);
    if (!ep) throw new Error(`Unknown endpoint: ${name}`);
    if (!(ep instanceof SharedObjectEndpoint)) {
      throw new Error(`Endpoint "${name}" is ${getServiceEndpointType(ep)}, expected SharedObject`);
    }
    return ep as SharedObjectEndpoint<T>;
  }

  /**
   * Validate that all RPC endpoints have handlers.
   */
  private _validateHandlers(): void {
    for (const endpoint of this._descriptor.endpoints) {
      if (endpoint.type === 'RPC') {
        if (!this._handlers[endpoint.name]) {
          throw new MissingHandlerError(endpoint.name);
        }
      }
    }
  }

  /**
   * Initialize transports and endpoints.
   */
  private async _init(): Promise<void> {
    try {
      await this._initTransports();
      this._initEndpoints();
      await this._startListening();
      this._startHeartbeat();
      this._readyResolve();
    } catch (err) {
      this._readyReject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Initialize transport + mux.
   */
  private async _initTransports(): Promise<void> {
    const { host, port } = parseHostPort(this._descriptor.transport.server);

    const transport = this._options.serverTransport ?? new UwsServerTransport();
    this._transport = transport as ServerTransport<any>;

    const mux = new MuxServer<any>(this._transport);
    this._mux = mux;

    mux.setRpcHandler((req: RpcRequestFrame) => this._processRpcRequest(req));

    // Listening happens after endpoints are registered.
    this._listenHost = host;
    this._listenPort = port;
  }

  private _listenHost: string | null = null;
  private _listenPort: number | null = null;

  private async _startListening(): Promise<void> {
    if (!this._transport) throw new Error('Transport not initialized');
    if (!this._listenHost || this._listenPort === null) throw new Error('Listen address not set');
    await this._transport.listen(this._listenHost, this._listenPort);
    debug('Service listening on %s:%d', this._listenHost, this._listenPort);
  }

  /**
   * Initialize endpoints based on descriptor.
   */
  private _initEndpoints(): void {
    if (!this._mux) {
      throw new Error('Mux not initialized');
    }

    for (const endpoint of this._descriptor.endpoints) {
      switch (endpoint.type) {
        case 'RPC':
          // Store validators for RPC handling
          this._rpcValidators.set(endpoint.name, {
            request: compileSchema(endpoint.requestSchema),
            reply: compileSchema(endpoint.replySchema),
          });
          break;

        case 'PubSub': {
          this._mux.registerPubSubEndpoint(endpoint.name);
          const sourceEp = new PubSubEndpoint(this._mux, endpoint);
          this._endpoints.set(endpoint.name, sourceEp);
          break;
        }

        case 'PushPull': {
          this._mux.registerPushPullEndpoint(endpoint.name);
          const pushPullEp = new PushPullEndpoint(this._mux, endpoint);
          this._endpoints.set(endpoint.name, pushPullEp);
          break;
        }

        case 'SharedObject': {
          const initial = this._initials[endpoint.name];
          if (initial === undefined) {
            throw new Error(`Missing initial state for SharedObject endpoint: ${endpoint.name}`);
          }

          const sharedObjEp = new SharedObjectEndpoint(this._mux, endpoint, initial as object);
          this._endpoints.set(endpoint.name, sharedObjEp);
          break;
        }
      }
    }
  }

  /**
   * Process an RPC request.
   */
  private async _processRpcRequest(req: RpcRequestFrame): Promise<{ err: SerializedError | null; res?: any }> {
    const { endpoint, input } = req;

    // Handle internal endpoints
    if (endpoint === '_descriptor') {
      return { err: null, res: this._descriptorHash };
    }

    // Look up validators and handler
    const validators = this._rpcValidators.get(endpoint);
    const handler = this._handlers[endpoint];

    if (!validators || !handler) {
      const err = new UnknownEndpointError(endpoint);
      return { err: err.toJSON() as SerializedError, res: null };
    }

    try {
      // Validate request and parse dates
      const validatedInput = validators.request.validateAndParseDates(input);

      // Call handler
      const result = await handler(validatedInput);

      // Serialize dates and validate result
      const serialized = serializeDates(result);
      validators.reply.validate(serialized);

      return { err: null, res: serialized };
    } catch (err) {
      const code = getErrorCode(err);
      const stack = err instanceof Error ? err.stack : undefined;
      return {
        err: {
          message: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Error',
          ...(code && { code }),
          ...(stack && { stack }),
          endpoint,
        },
        res: undefined,
      };
    }
  }

  /**
   * Start heartbeat broadcasting.
   */
  private _startHeartbeat(): void {
    if (!this._mux) return;

    const sendHeartbeat = () => {
      this._mux!.broadcastHeartbeat(this._options.heartbeatMs);
      debug('Sent heartbeat');
    };

    // Send initial heartbeat
    sendHeartbeat();

    // Schedule recurring heartbeats
    this._heartbeatInterval = setInterval(sendHeartbeat, this._options.heartbeatMs);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
