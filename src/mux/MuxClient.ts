/**
 * Client-side multiplexer.
 *
 * Maintains a single WebSocket connection and routes messages to endpoint clients.
 */

import { EventEmitter } from 'events';
import createDebug from 'debug';
import type { ClientTransport } from '../transports/ClientTransport.ts';
import {
  ConnectionError,
  TimeoutError,
} from '../errors.ts';
import type {
  HeartbeatFrame,
  RpcRequestFrame,
  RpcResponseFrame,
  ServerToClientFrame,
} from '../wire.ts';

const debug = createDebug('node-service:mux-client');

interface PendingRpc {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export class MuxClient extends EventEmitter {
  private _transport: ClientTransport;
  private _url: string;

  private _subscribed = new Set<string>();
  private _handlers = new Map<string, (frame: ServerToClientFrame) => void>();

  private _nextRpcId = 1;
  private _pending = new Map<number, PendingRpc>();

  constructor(transport: ClientTransport, url: string) {
    super();
    this._transport = transport;
    this._url = url;

    this._transport.onOpen(() => {
      debug('open');
      // Re-subscribe everything on (re)connect.
      for (const endpoint of this._subscribed) {
        this._send({ type: 'sub', endpoint });
      }

      this.emit('open');
    });

    this._transport.onClose((code, reason) => {
      debug('close code=%d reason=%s', code, reason);

      // Fail all in-flight RPC calls - requests are not replayed.
      for (const [id, pending] of this._pending.entries()) {
        clearTimeout(pending.timeoutId);
        pending.reject(new ConnectionError(`Connection closed (rpc id ${id})`));
      }
      this._pending.clear();

      this.emit('close', code, reason);
    });

    this._transport.onError((err) => {
      debug('transport error: %o', err);
      this.emit('error', err);
    });

    this._transport.onMessage((text) => {
      // Crash-fast: malformed JSON is a protocol bug.
      const frame = JSON.parse(text) as ServerToClientFrame;
      this._handleFrame(frame);
    });
  }

  get connected(): boolean {
    return this._transport.connected;
  }

  connect(): void {
    this._transport.connect(this._url).catch((err) => {
      // Transport may auto-reconnect; surface error for observability.
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  }

  close(): void {
    this._transport.close();
  }

  subscribe(endpoint: string): void {
    if (this._subscribed.has(endpoint)) return;
    this._subscribed.add(endpoint);
    if (this._transport.connected) {
      this._send({ type: 'sub', endpoint });
    }
  }

  /**
   * Send a `sub` frame even if already subscribed.
   * Used to force a SharedObject re-init without tearing down the entire connection.
   */
  resubscribe(endpoint: string): void {
    if (!this._subscribed.has(endpoint)) return;
    if (!this._transport.connected) return;
    this._send({ type: 'sub', endpoint });
  }

  unsubscribe(endpoint: string): void {
    if (!this._subscribed.has(endpoint)) return;
    this._subscribed.delete(endpoint);
    if (this._transport.connected) {
      this._send({ type: 'unsub', endpoint });
    }
  }

  setEndpointHandler(endpoint: string, handler: (frame: ServerToClientFrame) => void): void {
    this._handlers.set(endpoint, handler);
  }

  clearEndpointHandler(endpoint: string): void {
    this._handlers.delete(endpoint);
  }

  async rpcCall(endpoint: string, input: any, timeoutMs: number): Promise<any> {
    const deadline = Date.now() + timeoutMs;

    // Ensure the underlying WebSocket is open before sending.
    if (!this._transport.connected) {
      // Kick off (re)connect attempts if needed.
      this.connect();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new TimeoutError('timeout');
      await this._waitForOpen(remaining);
    }

    const id = this._nextRpcId++;
    const req: RpcRequestFrame = { type: 'rpc:req', id, endpoint, input };

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new TimeoutError('timeout');

    const promise = new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._pending.delete(id);
        reject(new TimeoutError('timeout'));
      }, remaining);

      this._pending.set(id, { resolve, reject, timeoutId });
    });

    this._send(req);

    return promise;
  }

  /**
   * Barrier that resolves only after the server has processed all earlier
   * client->server frames on this connection.
   *
   * Implemented using the internal `_descriptor` RPC endpoint so we don't need
   * an explicit subscribe ack frame.
   */
  async flush(timeoutMs = 2000): Promise<void> {
    await this.rpcCall('_descriptor', null, timeoutMs);
  }

  private _waitForOpen(timeoutMs: number): Promise<void> {
    if (this._transport.connected) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new TimeoutError('timeout'));
      }, timeoutMs);

      const onOpen = () => {
        cleanup();
        resolve();
      };

      const onClose = () => {
        cleanup();
        reject(new ConnectionError('Connection closed'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off('open', onOpen);
        this.off('close', onClose);
      };

      this.on('open', onOpen);
      this.on('close', onClose);
    });
  }

  private _send(frame: unknown): void {
    const text = JSON.stringify(frame);
    this._transport.send(text);
  }

  private _handleFrame(frame: ServerToClientFrame): void {
    if (!frame || typeof frame !== 'object') return;

    if ('type' in frame && (frame as any).type === 'heartbeat') {
      const hb = frame as HeartbeatFrame;
      this.emit('heartbeat', hb);
      return;
    }

    if ('type' in frame && (frame as any).type === 'rpc:res') {
      this._handleRpcResponse(frame as RpcResponseFrame);
      return;
    }

    if ('endpoint' in frame && typeof (frame as any).endpoint === 'string') {
      const endpoint = (frame as any).endpoint as string;
      const handler = this._handlers.get(endpoint);
      if (handler) {
        handler(frame);
      }
      return;
    }
  }

  private _handleRpcResponse(res: RpcResponseFrame): void {
    const pending = this._pending.get(res.id);
    if (!pending) return;

    this._pending.delete(res.id);
    clearTimeout(pending.timeoutId);

    if (res.err) {
      const err = res.err;
      const error = new Error(err.message) as Error & { code?: string; serverStack?: string };
      error.name = err.name;
      if (err.code) {
        error.code = err.code;
      }
      if (err.stack) {
        error.serverStack = err.stack;
      }
      pending.reject(error);
      return;
    }

    pending.resolve(res.res);
  }
}
