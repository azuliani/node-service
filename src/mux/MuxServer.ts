/**
 * Server-side multiplexer.
 *
 * Routes all endpoint types over a single WebSocket connection.
 */

import createDebug from 'debug';
import type { ServerTransport } from '../transports/ServerTransport.ts';
import type {
  ClientToServerFrame,
  EndpointMessageFrame,
  HeartbeatFrame,
  RpcRequestFrame,
  RpcResponseFrame,
  SharedObjectInitFrame,
  SharedObjectUpdateFrame,
} from '../wire.ts';

const debug = createDebug('node-service:mux-server');

type EndpointKind = 'pubsub' | 'sharedobject';

type PubSubServerTransport<Conn> = ServerTransport<Conn> & {
  subscribe: (conn: Conn, topic: string) => void;
  unsubscribe: (conn: Conn, topic: string) => void;
  publish: (topic: string, text: string) => void;
};

function isPubSubTransport<Conn>(t: ServerTransport<Conn>): t is PubSubServerTransport<Conn> {
  const anyT = t as any;
  return (
    typeof anyT.subscribe === 'function' &&
    typeof anyT.unsubscribe === 'function' &&
    typeof anyT.publish === 'function'
  );
}

export class MuxServer<Conn> {
  private _transport: ServerTransport<Conn>;
  private _pubsub: PubSubServerTransport<Conn> | null = null;

  private _connections = new Set<Conn>();
  private _kinds = new Map<string, EndpointKind>();

  private _subs = new Map<string, Set<Conn>>();

  private _sharedInitHandlers = new Map<string, (conn: Conn) => void>();

  private _rpcHandler: ((req: RpcRequestFrame) => Promise<{ err: RpcResponseFrame['err']; res?: any }>) | null = null;

  constructor(transport: ServerTransport<Conn>) {
    this._transport = transport;
    this._pubsub = isPubSubTransport(transport) ? transport : null;

    this._transport.onConnection((conn) => {
      this._connections.add(conn);
      debug('connection open (total=%d)', this._connections.size);
    });

    this._transport.onDisconnection((conn, code) => {
      this._connections.delete(conn);
      this._removeConnFromAllSubs(conn);
      debug('connection close code=%s (total=%d)', String(code), this._connections.size);
    });

    this._transport.onMessage((conn, text) => {
      let frame: ClientToServerFrame;
      try {
        frame = JSON.parse(text) as ClientToServerFrame;
      } catch {
        debug('malformed JSON from client, closing connection');
        this._transport.closeConnection(conn, 1002, 'Malformed JSON');
        return;
      }
      this._handleFrame(conn, frame);
    });
  }

  get connectionCount(): number {
    return this._connections.size;
  }

  setRpcHandler(handler: (req: RpcRequestFrame) => Promise<{ err: RpcResponseFrame['err']; res?: any }>): void {
    this._rpcHandler = handler;
  }

  registerPubSubEndpoint(name: string): void {
    this._kinds.set(name, 'pubsub');
    this._ensureSubs(name);
  }

  registerSharedObjectEndpoint(name: string, initHandler: (conn: Conn) => void): void {
    this._kinds.set(name, 'sharedobject');
    this._ensureSubs(name);
    this._sharedInitHandlers.set(name, initHandler);
  }

  broadcastHeartbeat(frequencyMs: number): void {
    const frame: HeartbeatFrame = { type: 'heartbeat', frequencyMs };
    const text = JSON.stringify(frame);
    let total = 0;
    for (const conn of this._connections) {
      this._transport.send(conn, text);
      total++;
    }
    debug('heartbeat broadcast to %d conns', total);
  }

  send(conn: Conn, frame: RpcResponseFrame | HeartbeatFrame | EndpointMessageFrame | SharedObjectInitFrame | SharedObjectUpdateFrame): void {
    this._transport.send(conn, JSON.stringify(frame));
  }

  broadcast(endpoint: string, frame: EndpointMessageFrame | SharedObjectUpdateFrame): void {
    const conns = this._subs.get(endpoint);
    if (!conns || conns.size === 0) return;
    const text = JSON.stringify(frame);

    // If the transport supports pub/sub, use native publish for fanout to reduce JS overhead.
    // For a single subscriber, direct send can be slightly cheaper than publish.
    if (this._pubsub && conns.size > 1) {
      this._pubsub.publish(endpoint, text);
      return;
    }

    for (const conn of conns) {
      this._transport.send(conn, text);
    }
  }

  private _handleFrame(conn: Conn, frame: ClientToServerFrame): void {
    if (!frame || typeof frame !== 'object') return;

    switch (frame.type) {
      case 'sub':
        this._handleSub(conn, frame.endpoint);
        return;
      case 'unsub':
        this._handleUnsub(conn, frame.endpoint);
        return;
      case 'rpc:req':
        this._handleRpc(conn, frame);
        return;
      default:
        return;
    }
  }

  private _handleSub(conn: Conn, endpoint: string): void {
    const kind = this._kinds.get(endpoint);
    if (!kind) return;

    if (kind === 'sharedobject') {
      const initHandler = this._sharedInitHandlers.get(endpoint);
      if (!initHandler) return;

      // Send init BEFORE adding to broadcast set to preserve init->update ordering.
      initHandler(conn);
    }

    if (this._pubsub && (kind === 'pubsub' || kind === 'sharedobject')) {
      // Subscribe AFTER init for SharedObject ordering guarantees.
      this._pubsub.subscribe(conn, endpoint);
    }

    const set = this._ensureSubs(endpoint);
    if (!set.has(conn)) {
      set.add(conn);
    }
  }

  private _handleUnsub(conn: Conn, endpoint: string): void {
    const kind = this._kinds.get(endpoint);
    if (!kind) return;

    if (this._pubsub && (kind === 'pubsub' || kind === 'sharedobject')) {
      this._pubsub.unsubscribe(conn, endpoint);
    }

    const set = this._subs.get(endpoint);
    if (set) set.delete(conn);
  }

  private _handleRpc(conn: Conn, req: RpcRequestFrame): void {
    if (!this._rpcHandler) {
      debug('no rpc handler');
      return;
    }

    // Do not allow an exception in an RPC handler to crash the server.
    this._rpcHandler(req)
      .then((partial) => {
        const res: RpcResponseFrame = {
          type: 'rpc:res',
          id: req.id,
          endpoint: req.endpoint,
          err: partial.err ?? null,
          ...(partial.res !== undefined ? { res: partial.res } : {}),
        };
        this._transport.send(conn, JSON.stringify(res));
      })
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        const res: RpcResponseFrame = {
          type: 'rpc:res',
          id: req.id,
          endpoint: req.endpoint,
          err: {
            message: error.message,
            name: error.name,
            endpoint: req.endpoint,
            ...(error.stack ? { stack: error.stack } : {}),
          },
          res: undefined,
        };
        this._transport.send(conn, JSON.stringify(res));
      });
  }

  private _ensureSubs(endpoint: string): Set<Conn> {
    let set = this._subs.get(endpoint);
    if (!set) {
      set = new Set();
      this._subs.set(endpoint, set);
    }
    return set;
  }

  private _removeConnFromAllSubs(conn: Conn): void {
    for (const [, set] of this._subs.entries()) {
      set.delete(conn);
    }
  }
}
