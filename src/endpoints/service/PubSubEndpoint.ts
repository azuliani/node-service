/**
 * Server-side PubSub endpoint implementation.
 *
 * Uses WebSocket for one-to-many pub/sub broadcasting.
 */

import createDebug from 'debug';
import { compileSchema, serializeDates } from '../../validation.ts';
import type { CompiledValidator } from '../../validation.ts';
import type { PubSubEndpoint as PubSubEndpointDef } from '../../types.ts';
import type { MuxServer } from '../../mux/MuxServer.ts';

const debug = createDebug('node-service:pubsub-endpoint');

/**
 * Server-side PubSub endpoint for publishing messages.
 */
export class PubSubEndpoint {
  private _mux: MuxServer<any>;
  private _name: string;
  private _validator: CompiledValidator;

  constructor(mux: MuxServer<any>, endpoint: PubSubEndpointDef) {
    this._mux = mux;
    this._name = endpoint.name;
    this._validator = compileSchema(endpoint.messageSchema);
  }

  /**
   * The endpoint name.
   */
  get name(): string {
    return this._name;
  }

  /**
   * Send a message to all subscribers.
   *
   * @param message - The message to send (must match messageSchema)
   * @throws ValidationError if message doesn't match schema
   */
  send(message: unknown): void {
    const serialized = serializeDates(message);
    this._validator.validate(serialized);

    debug('Sending message on %s', this._name);

    // Broadcast to all connected clients
    this._mux.broadcast(this._name, {
      endpoint: this._name,
      message: serialized,
    });
  }
}
