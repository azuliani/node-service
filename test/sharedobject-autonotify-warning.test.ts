/**
 * SharedObjectEndpoint warning when calling notify() with autoNotify enabled.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service } from '../src/index.ts';
import { createDescriptorAsync, delay } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../src/index.ts';

describe('SharedObjectEndpoint autoNotify warning', () => {
  let service: Service;
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
            required: ['value'],
          },
        } as SharedObjectEndpoint,
      ],
    });

    service = new Service(descriptor, {}, { State: { value: 0 } });
    await service.ready();
    await delay(25);
  });

  after(async () => {
    await service.close();
    await delay(25);
  });

  it('should warn once when notify() is called with autoNotify enabled', () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];

    console.warn = (...args: any[]) => {
      warnings.push(args.map((a) => String(a)).join(' '));
    };

    try {
      service.SO('State').data.value = 1;
      service.SO('State').notify();
      service.SO('State').notify();
    } finally {
      console.warn = originalWarn;
    }

    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0]?.includes('autoNotify'));
    assert.ok(warnings[0]?.includes('State'));
  });
});
