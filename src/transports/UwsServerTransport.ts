/**
 * uWebSockets.js server transport implementation.
 *
 * Exposes a single WebSocket endpoint at path `/`.
 */

import uWS from 'uWebSockets.js';
import createDebug from 'debug';
import type { ServerTransport } from './ServerTransport.ts';

const debug = createDebug('node-service:uws-transport');

type Conn = uWS.WebSocket<Record<string, never>>;

export class UwsServerTransport implements ServerTransport<Conn> {
  private _app: uWS.TemplatedApp;
  private _listenSocket: uWS.us_listen_socket | null = null;

  private _connections = new Set<Conn>();

  private _onConnection: ((conn: Conn) => void) | null = null;
  private _onDisconnection: ((conn: Conn, code?: number, reason?: string) => void) | null = null;
  private _onMessage: ((conn: Conn, text: string) => void) | null = null;

  constructor() {
    this._app = uWS.App();

    this._app.ws<Record<string, never>>('/', {
      open: (ws) => {
        this._connections.add(ws);
        this._onConnection?.(ws);
      },
      close: (ws, code, message) => {
        this._connections.delete(ws);
        const reason = Buffer.from(message).toString();
        this._onDisconnection?.(ws, code, reason);
      },
      message: (ws, message) => {
        // CRITICAL: ArrayBuffer is only valid during callback - must copy immediately.
        const text = Buffer.from(message).toString();
        this._onMessage?.(ws, text);
      },
    });
  }

  onConnection(cb: (conn: Conn) => void): void {
    this._onConnection = cb;
  }

  onDisconnection(cb: (conn: Conn, code?: number, reason?: string) => void): void {
    this._onDisconnection = cb;
  }

  onMessage(cb: (conn: Conn, text: string) => void): void {
    this._onMessage = cb;
  }

  send(conn: Conn, text: string): void {
    try {
      conn.send(text, false);
    } catch (err) {
      debug('send failed: %o', err);
    }
  }

  /**
   * uWS pub/sub: subscribe a connection to a topic.
   *
   * This is not part of the generic ServerTransport interface, but MuxServer can
   * opportunistically use it to speed up broadcast fanout.
   */
  subscribe(conn: Conn, topic: string): void {
    try {
      conn.subscribe(topic);
    } catch (err) {
      debug('subscribe failed: %o', err);
    }
  }

  /**
   * uWS pub/sub: unsubscribe a connection from a topic.
   */
  unsubscribe(conn: Conn, topic: string): void {
    try {
      conn.unsubscribe(topic);
    } catch (err) {
      debug('unsubscribe failed: %o', err);
    }
  }

  /**
   * uWS pub/sub: publish a message to all connections subscribed to a topic.
   */
  publish(topic: string, text: string): void {
    try {
      this._app.publish(topic, text, false);
    } catch (err) {
      debug('publish failed: %o', err);
    }
  }

  closeConnection(conn: Conn, code = 1000, reason = ''): void {
    try {
      conn.end(code, reason);
    } catch (err) {
      debug('closeConnection failed: %o', err);
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
  }

  listen(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this._app.listen(host, port, (socket) => {
        if (socket) {
          this._listenSocket = socket;
          debug('listening on %s:%d', host, port);
          resolve();
        } else {
          reject(new Error(`Failed to listen on ${host}:${port}`));
        }
      });
    });
  }

  async close(): Promise<void> {
    // Close all WebSocket connections.
    for (const ws of this._connections) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this._connections.clear();

    // Close listen socket.
    if (this._listenSocket) {
      uWS.us_listen_socket_close(this._listenSocket);
      this._listenSocket = null;
    }

    debug('closed');
  }
}
