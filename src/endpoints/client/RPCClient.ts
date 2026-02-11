/**
 * Client-side RPC endpoint implementation.
 *
 * Uses muxed RPC over a shared WebSocket connection.
 */

import createDebug from 'debug';
import { compileSchema, serializeDates } from '../../validation.ts';
import type { CompiledValidator } from '../../validation.ts';
import type { RPCEndpoint as RPCEndpointDef } from '../../types.ts';
import type { RPCCallOptions } from '../../types.ts';
import type { MuxClient } from '../../mux/MuxClient.ts';

const debug = createDebug('node-service:rpc-client');

/**
 * Client-side RPC endpoint for making requests.
 */
export class RPCClient {
  private _mux: MuxClient;
  private _name: string;
  private _requestValidator: CompiledValidator;
  private _responseValidator: CompiledValidator;

  constructor(mux: MuxClient, endpoint: RPCEndpointDef) {
    this._mux = mux;
    this._name = endpoint.name;
    this._requestValidator = compileSchema(endpoint.requestSchema);
    this._responseValidator = compileSchema(endpoint.replySchema);
  }

  /**
   * The endpoint name.
   */
  get name(): string {
    return this._name;
  }

  /**
   * Make an RPC call.
   *
   * @param input - The request input (must match requestSchema)
   * @param options - RPC call options
   * @returns The response data
   * @throws TimeoutError if request times out
   * @throws ValidationError if input doesn't match schema
   * @throws Error if server returns an error
   */
  async call<TInput = unknown, TOutput = unknown>(
    input: TInput,
    options: RPCCallOptions = {}
  ): Promise<TOutput> {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('RPC call options must be an object');
    }

    const { timeout = 10000, ...unknownOptions } = options as RPCCallOptions &
      Record<string, unknown>;
    const unknownKeys = Object.keys(unknownOptions);
    if (unknownKeys.length > 0) {
      throw new Error(`Unknown RPC call options: ${unknownKeys.join(', ')}`);
    }

    if (!Number.isFinite(timeout)) {
      throw new TypeError('RPC timeout must be a finite number');
    }

    // Serialize dates before validation/transport
    const serializedInput = this._requestValidator.hasDates ? serializeDates(input) : input;
    this._requestValidator.validate(serializedInput);

    debug('RPC call to %s', this._name);

    const res = await this._mux.rpcCall(this._name, serializedInput, timeout);

    // Validate and parse dates in response
    return this._responseValidator.validateAndParseDates(res) as TOutput;
  }
}
