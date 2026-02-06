/**
 * SharedObject batch notify validation rollback tests.
 *
 * Verifies that when _processBatchedNotify encounters a validation error
 * partway through processing, the internal snapshot is restored so that
 * subsequent valid mutations produce correct deltas.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, delay, waitFor, waitUntil } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint, Diff } from '../src/index.ts';

describe('SharedObject batch validation rollback', () => {
  let service: Service;
  let client: Client;
  let descriptor: Descriptor;

  before(async () => {
    descriptor = await createDescriptorAsync({
      endpoints: [
        {
          name: 'BatchTest',
          type: 'SharedObject',
          objectSchema: {
            type: 'object',
            properties: {
              count: { type: 'number' },
              name: { type: 'string' },
            },
          },
          autoNotify: false,
        } as SharedObjectEndpoint,
      ],
    });
    service = new Service(
      descriptor,
      {},
      { BatchTest: { count: 0, name: 'hello' } }
    );
    await service.ready();
    client = new Client(descriptor);
    await delay(100);
  });

  after(async () => {
    client.SO('BatchTest').unsubscribe();
    await delay(100);
    client.close();
    await service.close();
    await delay(100);
  });

  it('should throw ValidationError when notifying with invalid data', async () => {
    client.SO('BatchTest').subscribe();
    await waitFor(client.SO('BatchTest'), 'init', 5000);

    // Make a valid mutation followed by an invalid one.
    service.SO('BatchTest').data.count = 1;

    // Make invalid mutation — count should be a number.
    (service.SO('BatchTest').data as any).count = 'not a number';

    assert.throws(
      () => service.SO('BatchTest').notify(),
      (err: Error) => {
        assert.ok(err.message.includes('Validation failed'));
        return true;
      }
    );
  });

  it('should produce correct delta after failed validation (snapshot not corrupted)', async () => {
    const updates: Diff[] = [];
    client.SO('BatchTest').on('update', (delta: Diff) => updates.push(delta));

    // Fix the data back to valid state and notify.
    service.SO('BatchTest').data.count = 5;
    service.SO('BatchTest').notify();

    await waitUntil(() => updates.length >= 1);

    assert.strictEqual(updates.length, 1, 'Should receive one update');
    // The client should reflect the new valid value.
    assert.strictEqual(client.SO('BatchTest').data?.count, 5);
  });
});
