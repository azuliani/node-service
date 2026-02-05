/**
 * Client transport using the `ws` package.
 *
 * Provides a single reconnecting WebSocket connection. The mux layer handles
 * JSON parsing/routing; this transport only deals with raw text frames.
 */

import { WebSocket } from 'ws';
import createDebug from 'debug';
import type { ClientTransport } from './ClientTransport.ts';

const debug = createDebug('node-service:ws-client-transport');

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export class WsClientTransport implements ClientTransport {
  private _url: string | null = null;
  private _ws: WebSocket | null = null;
  private _state: ConnectionState = 'disconnected';
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _shouldReconnect = false;
  private _reconnectAttempt = 0;
  private _connectPromise: Promise<void> | null = null;

  private _onOpen: (() => void)[] = [];
  private _onClose: ((code: number, reason: string) => void)[] = [];
  private _onError: ((err: Error) => void)[] = [];
  private _onMessage: ((text: string) => void)[] = [];

  // Exponential backoff constants.
  private static readonly BASE_DELAY = 1000;
  private static readonly MAX_DELAY = 30000;
  private static readonly JITTER_FACTOR = 0.3;

  get connected(): boolean {
    return this._state === 'connected';
  }

  onOpen(cb: () => void): void {
    this._onOpen.push(cb);
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose.push(cb);
  }
  onError(cb: (err: Error) => void): void {
    this._onError.push(cb);
  }
  onMessage(cb: (text: string) => void): void {
    this._onMessage.push(cb);
  }

  connect(url: string): Promise<void> {
    this._url = url;
    this._shouldReconnect = true;

    if (this._state === 'connected') return Promise.resolve();
    if (this._state === 'connecting' && this._connectPromise) return this._connectPromise;

    return this._doConnect();
  }

  private _doConnect(): Promise<void> {
    if (!this._url) {
      return Promise.reject(new Error('No URL'));
    }
    const url = this._url;
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        this._connectPromise = null;
        if (err) reject(err);
        else resolve();
      };

      this._state = 'connecting';
      debug('Connecting to %s', url);

      this._ws = new WebSocket(url);

      this._ws.on('open', () => {
        this._state = 'connected';
        this._reconnectAttempt = 0;
        debug('Connected to %s', url);
        for (const cb of this._onOpen) cb();
        finish();
      });

      this._ws.on('message', (data: Buffer) => {
        const text = data.toString();
        for (const cb of this._onMessage) cb(text);
      });

      this._ws.on('close', (code, reason) => {
        this._state = 'disconnected';
        this._ws = null;
        const reasonText = reason.toString();
        debug('Disconnected from %s (code: %d)', url, code);
        for (const cb of this._onClose) cb(code, reasonText);

        // If we never connected, treat as failure for the connect() Promise.
        if (!settled) {
          finish(new Error(`WebSocket closed before open (code: ${code})`));
        }

        if (this._shouldReconnect) {
          this._scheduleReconnect();
        }
      });

      this._ws.on('error', (err) => {
        debug('WebSocket error on %s: %o', url, err);

        if (this._state === 'connecting') {
          this._state = 'disconnected';
          this._ws = null;
          finish(err);

          if (this._shouldReconnect) {
            this._scheduleReconnect();
          }
          return;
        }

        for (const cb of this._onError) cb(err instanceof Error ? err : new Error(String(err)));
      });
    });

    return this._connectPromise;
  }

  private _scheduleReconnect(): void {
    if (this._reconnectTimer) return;

    const baseDelay = Math.min(
      WsClientTransport.BASE_DELAY * Math.pow(2, this._reconnectAttempt),
      WsClientTransport.MAX_DELAY
    );
    const jitter = baseDelay * WsClientTransport.JITTER_FACTOR * (Math.random() - 0.5);
    const delay = Math.round(baseDelay + jitter);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectAttempt++;
      if (this._shouldReconnect && this._state === 'disconnected') {
        debug('Attempting reconnect (attempt %d, delay %dms)', this._reconnectAttempt, delay);
        this._doConnect().catch((err) => debug('Reconnect failed: %o', err));
      }
    }, delay);
  }

  send(text: string): void {
    if (!this._ws || this._state !== 'connected') {
      debug('Cannot send, not connected');
      return;
    }
    this._ws.send(text);
  }

  close(): void {
    this._shouldReconnect = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }

    this._state = 'disconnected';
  }
}
