/**
 * Client-side RPC endpoint implementation.
 *
 * Uses muxed RPC over a shared WebSocket connection.
 */

import createDebug from 'debug';
import { compileSchema, serializeDates } from '../../validation.ts';
import type { CompiledValidator } from '../../validation.ts';
import type { RPCEndpoint as RPCEndpointDef } from '../../types.ts';
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
   * @param timeout - Timeout in milliseconds (default: 10000)
   * @returns The response data
   * @throws TimeoutError if request times out
   * @throws ValidationError if input doesn't match schema
   * @throws Error if server returns an error
   */
  async call<TInput = unknown, TOutput = unknown>(
    input: TInput,
    timeout = 10000
  ): Promise<TOutput> {
    // Serialize dates before validation/transport
    const serializedInput = serializeDates(input);
    this._requestValidator.validate(serializedInput);

    debug('RPC call to %s', this._name);

    const res = await this._mux.rpcCall(this._name, serializedInput, timeout);

    // Validate and parse dates in response
    return this._responseValidator.validateAndParseDates(res) as TOutput;
  }
}
