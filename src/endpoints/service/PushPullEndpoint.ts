/**
 * Server-side PushPull endpoint implementation.
 *
 * Uses WebSocket for one-to-many work distribution with round-robin.
 */

import createDebug from 'debug';
import { compileSchema, serializeDates } from '../../validation.ts';
import type { CompiledValidator } from '../../validation.ts';
import type { PushPullEndpoint as PushPullEndpointDef } from '../../types.ts';
import type { MuxServer } from '../../mux/MuxServer.ts';

const debug = createDebug('node-service:pushpull-endpoint');

/**
 * Server-side PushPull endpoint for distributing work to clients.
 */
export class PushPullEndpoint {
  private _mux: MuxServer<any>;
  private _name: string;
  private _validator: CompiledValidator;

  constructor(mux: MuxServer<any>, endpoint: PushPullEndpointDef) {
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
   * Push a work item to connected workers (round-robin).
   *
   * @param message - The message to send (must match messageSchema)
   * @returns true if sent to a worker, false if no workers available (queued)
   * @throws ValidationError if message doesn't match schema
   */
  push(message: unknown): boolean {
    const serialized = serializeDates(message);
    this._validator.validate(serialized);

    debug('Pushing work on %s', this._name);

    // Push to next available worker (round-robin)
    return this._mux.pushToWorker(this._name, { endpoint: this._name, message: serialized });
  }
}
