/**
 * Tests for descriptor mismatch error emission and client self-close.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { DescriptorMismatchError } from '../src/errors.ts';
import {
  createDescriptor,
  getAvailablePort,
  delay,
  waitFor,
} from './helpers.ts';
import type { Descriptor, RPCEndpoint } from '../src/index.ts';

describe('Descriptor mismatch', () => {
  let service: Service;
  let port: number;

  before(async () => {
    port = await getAvailablePort();
    const descriptor: Descriptor = createDescriptor(port, {
      endpoints: [
        {
          name: 'Echo',
          type: 'RPC',
          requestSchema: { type: 'string' },
          replySchema: { type: 'string' },
        } as RPCEndpoint,
      ],
    });
    service = new Service(
      descriptor,
      { Echo: (msg: string) => msg },
      {},
      { heartbeatMs: 100 }
    );
    await service.ready();
  });

  after(async () => {
    await service.close();
    await delay(100);
  });

  it('should emit error and close on descriptor mismatch', async () => {
    // Create a client with a DIFFERENT descriptor pointing to the SAME server
    const mismatchedDescriptor: Descriptor = createDescriptor(port, {
      endpoints: [
        {
          name: 'Different',
          type: 'RPC',
          requestSchema: { type: 'number' },
          replySchema: { type: 'number' },
        } as RPCEndpoint,
      ],
    });

    const client = new Client(mismatchedDescriptor);

    // Wait for the error event to fire
    const err = await waitFor<Error>(client, 'error', 5000);

    // Assert the error is a DescriptorMismatchError
    assert.ok(
      err instanceof DescriptorMismatchError,
      `Expected DescriptorMismatchError but got ${err.constructor.name}: ${err.message}`
    );

    // Verify the client closed itself (mux is disconnected)
    // An RPC call on the closed client should fail
    await assert.rejects(
      () => client.RPC('Different').call(42, 1000),
      (callErr: Error) => {
        // Should get a connection or timeout error since the mux is closed
        assert.ok(callErr instanceof Error);
        return true;
      }
    );
  });
});
