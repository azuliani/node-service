/**
 * SharedObjectClient data access semantics.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, delay, waitFor } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../src/index.ts';

describe('SharedObjectClient non-ready data access', () => {
  let service: Service;
  let client: Client;
  let descriptor: Descriptor;

  before(async () => {
    descriptor = await createDescriptorAsync({
      endpoints: [
        {
          name: 'State',
          type: 'SharedObject',
          objectSchema: {
            type: 'object',
            properties: { value: { type: 'number' } },
          },
        } as SharedObjectEndpoint,
      ],
    });

    service = new Service(descriptor, {}, { State: { value: 1 } });
    await service.ready();

    client = new Client(descriptor);
    await delay(50);
  });

  after(async () => {
    client.SO('State').unsubscribe();
    await delay(50);
    client.close();
    await service.close();
    await delay(50);
  });

  it('should throw when accessing data before init', () => {
    assert.throws(() => {
      // No subscribe yet, so the SharedObject is not ready.
      // Access should throw to force an awaitable init path.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      client.SO('State').data;
    });
  });

  it('should throw when accessing data after disconnect', async () => {
    await client.SO('State').subscribe();

    await service.close();
    await waitFor(client.SO('State'), 'disconnected', 2000);

    assert.strictEqual(client.SO('State').ready, false);

    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      client.SO('State').data;
    });
  });
});

describe('Service SharedObject initials requirement', () => {
  it('should require explicit initials for each SharedObject endpoint', async () => {
    const descriptor = await createDescriptorAsync({
      endpoints: [
        {
          name: 'State',
          type: 'SharedObject',
          objectSchema: {
            type: 'object',
            properties: { value: { type: 'number' } },
          },
        } as SharedObjectEndpoint,
      ],
    });

    const service = new Service(descriptor, {}, {});

    await assert.rejects(() => service.ready());
    await service.close();
  });
});
