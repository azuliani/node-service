/**
 * Service.close() race with _init().
 *
 * Verifies that calling close() immediately after construction
 * (before _init() completes) causes ready() to reject cleanly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Service } from '../src/index.ts';
import { createDescriptorAsync, delay } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../src/index.ts';

describe('Service.close() race with _init()', () => {
  it('should reject ready() when close() is called before init completes', async () => {
    const descriptor: Descriptor = await createDescriptorAsync({
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

    const service = new Service(descriptor, {}, { State: { value: 0 } });

    // Immediately close — do NOT await ready() first.
    await service.close();

    await assert.rejects(
      () => service.ready(),
      (err: Error) => {
        assert.ok(
          err.message.includes('closed'),
          `Expected error about "closed", got: ${err.message}`
        );
        return true;
      }
    );

    await delay(50);
  });

  it('should reject ready() even with no endpoints', async () => {
    const descriptor: Descriptor = await createDescriptorAsync({
      endpoints: [],
    });

    const service = new Service(descriptor, {}, {});

    // Close immediately.
    await service.close();

    await assert.rejects(
      () => service.ready(),
      (err: Error) => {
        assert.ok(err.message.includes('closed'));
        return true;
      }
    );

    await delay(50);
  });
});
