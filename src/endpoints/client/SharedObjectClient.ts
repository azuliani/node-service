/**
 * Client-side SharedObject endpoint implementation.
 *
 * Maintains synchronized state with server using deltas over the mux connection.
 */

import createDebug from 'debug';
import { EventEmitter } from 'events';
import { apply } from '@azuliani/tree-diff';
import { compileSchema } from '../../validation.ts';
import { createReadOnlyProxy } from '../../proxy.ts';
import type { CompiledValidator } from '../../validation.ts';
import type { SharedObjectEndpoint as SharedObjectEndpointDef, Diff } from '../../types.ts';
import type { MuxClient } from '../../mux/MuxClient.ts';
import type { ServerToClientFrame, SharedObjectInitFrame, SharedObjectUpdateFrame } from '../../wire.ts';

const debug = createDebug('node-service:sharedobject-client');

/**
 * Events emitted by SharedObjectClient.
 */
export interface SharedObjectClientEvents {
  init: [data: { v: number; data: unknown }];
  update: [delta: Diff];
  connected: [];
  disconnected: [];
  error: [error: Error];
  timing: [averageLatencyMs: number];
}

type InitResult<T extends object> = { v: number; data: T };

/**
 * Client-side SharedObject endpoint for state synchronization.
 */
export class SharedObjectClient<T extends object = object> extends EventEmitter {
  private _mux: MuxClient;
  private _name: string;
  private _validator: CompiledValidator;
  private _initTimeout: number;

  private _subscribed = false;

  private _data: T | null = null;
  private _v = 0;
  private _ready = false;

  // Init timeout timer
  private _initTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // Timing tracking
  private _latencies: number[] = [];
  private _timingInterval: ReturnType<typeof setInterval> | null = null;

  // Proxy for read-only access
  private _dataProxy: T | null = null;

  // Deferred for subscribe() promise
  private _initDeferred:
    | {
        promise: Promise<InitResult<T>>;
        resolve: (value: InitResult<T>) => void;
        reject: (err: Error) => void;
      }
    | null = null;

  constructor(
    mux: MuxClient,
    endpoint: SharedObjectEndpointDef,
    options: { initTimeout?: number } = {}
  ) {
    super();
    this._mux = mux;
    this._name = endpoint.name;
    this._validator = compileSchema(endpoint.objectSchema);
    this._initTimeout = options.initTimeout ?? 3000;

    this._reset(null);

    this._mux.setEndpointHandler(this._name, (frame) => this._handleFrame(frame));

    this._mux.on('open', () => {
      if (!this._subscribed) return;
      this.emit('connected');
      if (!this._ready) {
        this._startInitTimeout();
      }
    });

    this._mux.on('close', () => {
      if (!this._subscribed) return;
      this._handleDisconnectInternal();
      this.emit('disconnected');
    });
  }

  get name(): string {
    return this._name;
  }

  get connected(): boolean {
    return this._mux.connected;
  }

  get subscribed(): boolean {
    return this._subscribed;
  }

  /**
   * Whether initial state has been loaded.
   */
  get ready(): boolean {
    return this._ready;
  }

  /**
   * Current synchronized state (read-only).
   * Throws until the initial state has been received.
   */
  get data(): T {
    if (!this._ready || !this._data) {
      throw new Error(`SharedObject not ready: ${this._name}`);
    }

    // Return cached proxy or create new one.
    if (!this._dataProxy) {
      this._dataProxy = createReadOnlyProxy(this._data);
    }
    return this._dataProxy;
  }

  /**
   * Subscribe to state updates.
   */
  subscribe(): Promise<InitResult<T>> {
    if (!this._subscribed) {
      this._subscribed = true;
      this._mux.subscribe(this._name);

      if (this._mux.connected) {
        this.emit('connected');
        if (!this._ready) {
          this._startInitTimeout();
        }
      }

      this._startTimingReports();
    } else if (this._mux.connected && !this._ready) {
      // Idempotency: if already subscribed but we're not ready, make sure the
      // init timeout is running (e.g., after user calls subscribe() again).
      this._startInitTimeout();
    }

    return this._waitForInit();
  }

  /**
   * Unsubscribe from state updates.
   */
  unsubscribe(): void {
    if (!this._subscribed) return;
    this._subscribed = false;

    this._mux.unsubscribe(this._name);
    this._stopTimingReports();

    this._rejectInitPromise(new Error(`Unsubscribed from ${this._name} before init`));

    // Mirror previous behavior: treat unsubscribe like a disconnect/reset.
    this._handleDisconnectInternal();
    this.emit('disconnected');
  }

  /**
   * Close (unsubscribe and detach from mux).
   */
  close(): void {
    this.unsubscribe();
    this._mux.clearEndpointHandler(this._name);
  }

  /**
   * Handle disconnect from source (public API for Client heartbeat timeout).
   */
  handleDisconnect(): void {
    this._handleDisconnectInternal();
    this.emit('disconnected');
  }

  private _handleFrame(frame: ServerToClientFrame): void {
    if (!this._subscribed) return;

    // SharedObject frames are { endpoint, type, ... }.
    if (!frame || typeof frame !== 'object') return;
    if (!('type' in frame)) return;

    const typed = frame as { type: string };
    if (typed.type === 'init') {
      this._handleInit(frame as SharedObjectInitFrame);
      return;
    }
    if (typed.type === 'update') {
      this._handleUpdate(frame as SharedObjectUpdateFrame);
      return;
    }
  }

  /**
   * Handle init message from server.
   */
  private _handleInit(message: SharedObjectInitFrame): void {
    this._clearInitTimeout();

    this._data = this._validator.validateAndParseDates(message.data) as T;
    this._dataProxy = null; // Invalidate proxy.
    this._v = message.v;
    this._ready = true;

    debug('Init complete for %s (v%d)', this._name, this._v);
    this.emit('init', { v: this._v, data: this._data });
    this._resolveInitPromise();
  }

  /**
   * Handle update message from server.
   */
  private _handleUpdate(message: SharedObjectUpdateFrame): void {
    if (!this._ready) {
      debug('Update received before init on %s (v%d), ignoring', this._name, message.v);
      return;
    }

    // Check version sequence - must be exactly v+1.
    if (message.v !== this._v + 1) {
      debug('[SharedObject %s] Version gap: expected %d, got %d', this._name, this._v + 1, message.v);

      // Reset local state and request a fresh init without tearing down the mux connection.
      this._handleDisconnectInternal();
      this.emit('disconnected');

      this._mux.resubscribe(this._name);
      this._startInitTimeout();
      return;
    }

    this._applyUpdate(message);
  }

  /**
   * Apply an update to local state.
   */
  private _applyUpdate(update: SharedObjectUpdateFrame): void {
    if (!this._data) return;

    try {
      apply(this._data as unknown as Record<string, unknown>, update.delta);
    } catch (err) {
      debug('Error applying delta to %s (v%d): %o', this._name, update.v, err);

      // Treat patch failures as divergence: reset local state and request a fresh init.
      this._handleDisconnectInternal();
      this.emit('disconnected');

      this._mux.resubscribe(this._name);
      this._startInitTimeout();
      return;
    }

    this._dataProxy = null; // Invalidate proxy.
    this._v = update.v;

    // Track latency.
    const now = new Date();
    const serverTime = new Date(update.now);
    const latency = now.getTime() - serverTime.getTime();
    this._latencies.push(latency);

    debug('Applied delta (%d entries) to %s (v%d)', update.delta.length, this._name, this._v);
    this.emit('update', update.delta);
  }

  /**
   * Internal disconnect handling - shared logic.
   */
  private _handleDisconnectInternal(): void {
    this._clearInitTimeout();
    this._reset(null);
  }

  /**
   * Start init timeout timer.
   */
  private _startInitTimeout(): void {
    this._clearInitTimeout();
    this._initTimeoutTimer = setTimeout(() => {
      if (!this._ready && this._subscribed) {
        debug('Init timeout for %s, resubscribing', this._name);
        this._mux.resubscribe(this._name);
        this._startInitTimeout();
      }
    }, this._initTimeout);
  }

  /**
   * Clear init timeout timer.
   */
  private _clearInitTimeout(): void {
    if (this._initTimeoutTimer) {
      clearTimeout(this._initTimeoutTimer);
      this._initTimeoutTimer = null;
    }
  }

  private _reset(nextData: T | null): void {
    this._data = nextData;
    this._dataProxy = null;
    this._v = 0;
    this._ready = false;
    this._latencies = [];
  }

  private _waitForInit(): Promise<InitResult<T>> {
    if (this._ready && this._data) {
      return Promise.resolve({ v: this._v, data: this._data });
    }

    if (this._initDeferred) {
      return this._initDeferred.promise;
    }

    let resolve!: (value: InitResult<T>) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<InitResult<T>>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this._initDeferred = { promise, resolve, reject };
    return promise;
  }

  private _resolveInitPromise(): void {
    if (!this._initDeferred) return;
    if (!this._data) return;
    this._initDeferred.resolve({ v: this._v, data: this._data });
    this._initDeferred = null;
  }

  private _rejectInitPromise(err: Error): void {
    if (!this._initDeferred) return;
    this._initDeferred.reject(err);
    this._initDeferred = null;
  }

  /**
   * Start emitting timing reports.
   */
  private _startTimingReports(): void {
    if (this._timingInterval) return;
    this._timingInterval = setInterval(() => {
      if (this._latencies.length > 0) {
        const avg = this._latencies.reduce((a, b) => a + b, 0) / this._latencies.length;
        this.emit('timing', avg);
        this._latencies = [];
      }
    }, 5000);
  }

  /**
   * Stop timing reports.
   */
  private _stopTimingReports(): void {
    if (this._timingInterval) {
      clearInterval(this._timingInterval);
      this._timingInterval = null;
    }
  }
}
