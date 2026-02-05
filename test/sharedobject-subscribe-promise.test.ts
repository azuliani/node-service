/**
 * SharedObjectClient.subscribe() promise behavior.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, delay } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../src/index.ts';

describe('SharedObjectClient.subscribe() Promise', () => {
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
            properties: {
              value: { type: 'number' },
            },
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

  it('returns a Promise that resolves on init', async () => {
    const initPromise = client.SO('State').subscribe();
    assert.ok(initPromise instanceof Promise);

    const init = await initPromise;
    assert.strictEqual(init.v, 0);
    assert.strictEqual(init.data.value, 1);
    assert.strictEqual(client.SO('State').ready, true);
    assert.strictEqual(client.SO('State').data?.value, 1);
  });
});
