/**
 * Client-side PubSub endpoint implementation.
 *
 * Uses mux subscription over a shared WebSocket connection.
 */

import createDebug from 'debug';
import { EventEmitter } from 'events';
import { compileSchema } from '../../validation.ts';
import type { CompiledValidator } from '../../validation.ts';
import type { PubSubEndpoint as PubSubEndpointDef } from '../../types.ts';
import type { EndpointMessageFrame, ServerToClientFrame } from '../../wire.ts';
import type { MuxClient } from '../../mux/MuxClient.ts';

const debug = createDebug('node-service:pubsub-client');

/**
 * Events emitted by PubSubClient
 */
export interface PubSubClientEvents {
  message: [data: unknown];
  connected: [];
  disconnected: [];
  error: [error: Error];
}

/**
 * Client-side PubSub endpoint for receiving published messages.
 */
export class PubSubClient extends EventEmitter {
  private _mux: MuxClient;
  private _name: string;
  private _validator: CompiledValidator;
  private _subscribed = false;

  constructor(mux: MuxClient, endpoint: PubSubEndpointDef) {
    super();
    this._mux = mux;
    this._name = endpoint.name;
    this._validator = compileSchema(endpoint.messageSchema);

    this._mux.setEndpointHandler(this._name, (frame) => {
      this._handleFrame(frame);
    });

    this._mux.on('open', () => {
      if (!this._subscribed) return;
      this._mux.flush().then(() => {
        if (this._subscribed) this.emit('connected');
      }).catch((err) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    });
    this._mux.on('close', () => {
      if (this._subscribed) this.emit('disconnected');
    });
    this._mux.on('error', (err) => {
      if (this._subscribed) this.emit('error', err);
    });
  }

  /**
   * The endpoint name.
   */
  get name(): string {
    return this._name;
  }

  get subscribed(): boolean {
    return this._subscribed;
  }

  subscribe(): void {
    if (this._subscribed) return;
    this._subscribed = true;
    this._mux.subscribe(this._name);
    if (this._mux.connected) {
      this._mux.flush().then(() => {
        if (this._subscribed && this._mux.connected) this.emit('connected');
      }).catch((err) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  unsubscribe(): void {
    if (!this._subscribed) return;
    this._subscribed = false;
    this._mux.unsubscribe(this._name);
    queueMicrotask(() => this.emit('disconnected'));
  }

  close(): void {
    this.unsubscribe();
    this._mux.clearEndpointHandler(this._name);
  }

  private _handleFrame(frame: ServerToClientFrame): void {
    if (!this._subscribed) return;

    // PubSub messages have { endpoint, message } format.
    const msg = frame as EndpointMessageFrame;
    if (msg.endpoint !== this._name) return;

    try {
      const validated = this._validator.validateAndParseDates(msg.message);
      this.emit('message', validated);
    } catch (err) {
      debug('Validation error for message on %s: %o', this._name, err);
    }
  }
}
