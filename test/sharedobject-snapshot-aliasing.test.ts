/**
 * Test: SharedObject snapshot does NOT alias _data after notify.
 *
 * tree-diff's encode() deep-clones the RHS for every leaf in the delta,
 * so after applyDelta patches _lastSnapshot, no nested references are
 * shared with _data. Mutating objects by retained reference only affects
 * _data, and subsequent diffs correctly detect the change.
 *
 * This test exercises the scenario to guard against regressions if
 * tree-diff or the snapshot update logic changes.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, delay, waitFor, waitUntil } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../src/index.ts';

describe('SharedObject snapshot aliasing', () => {
  let service: Service;
  let client: Client;
  let descriptor: Descriptor;

  before(async () => {
    descriptor = await createDescriptorAsync({
      endpoints: [
        {
          name: 'AliasTest',
          type: 'SharedObject',
          autoNotify: false,
          objectSchema: {
            type: 'object',
            properties: {
              a: {
                type: 'object',
                properties: {
                  nested: {
                    type: 'object',
                    properties: {
                      value: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        } as SharedObjectEndpoint,
      ],
    });

    service = new Service(
      descriptor,
      {},
      { AliasTest: { a: { nested: { value: 0 } } } }
    );
    await service.ready();
    client = new Client(descriptor);
    await delay(100);
  });

  after(async () => {
    client.SO('AliasTest').unsubscribe();
    await delay(100);
    client.close();
    await service.close();
    await delay(100);
  });

  it('should detect mutations made via a retained reference after notify', async () => {
    client.SO('AliasTest').subscribe();
    await waitFor(client.SO('AliasTest'), 'init', 5000);

    // Step 1: Assign a new subtree via a variable we keep a reference to.
    const x = { nested: { value: 1 } };
    service.SO<{ a: { nested: { value: number } } }>('AliasTest').rawData.a = x;
    service.SO('AliasTest').notify();

    await waitUntil(
      () => client.SO('AliasTest').data?.a?.nested?.value === 1,
      5000,
    );

    // Step 2: Mutate the deeply-nested property through the original reference.
    // tree-diff's encode() deep-clones the RHS, so _lastSnapshot.a.nested is
    // NOT the same object as x.nested. This mutation only affects _data,
    // and the next diff correctly detects the change.
    x.nested.value = 42;
    service.SO('AliasTest').notify();

    await waitUntil(
      () => client.SO('AliasTest').data?.a?.nested?.value === 42,
      5000,
    );

    assert.strictEqual(client.SO('AliasTest').data?.a?.nested?.value, 42);
  });
});
