/**
 * Test: Assigning a client SharedObject's .data proxy as a value on a
 * server SharedObject, then notifying.
 *
 * The write proxy detects read-only proxies via the UNWRAP_PROXY symbol
 * and deep-copies the underlying target. This prevents storing live
 * references to foreign SharedObject state.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, delay, waitFor, waitUntil } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../src/index.ts';

describe('SharedObject cross-proxy assignment', () => {
  let service: Service;
  let client: Client;
  let descriptor: Descriptor;

  before(async () => {
    descriptor = await createDescriptorAsync({
      endpoints: [
        {
          name: 'Source',
          type: 'SharedObject',
          autoNotify: false,
          objectSchema: {
            type: 'object',
            properties: {
              value: { type: 'number' },
            },
          },
        } as SharedObjectEndpoint,
        {
          name: 'Target',
          type: 'SharedObject',
          autoNotify: false,
          objectSchema: {
            type: 'object',
            properties: {
              captured: {
                type: 'object',
                properties: {
                  value: { type: 'number' },
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
      {
        Source: { value: 1 },
        Target: { captured: { value: 0 } },
      }
    );
    await service.ready();
    client = new Client(descriptor);
    await delay(100);

    // Subscribe to both SOs and wait for init
    const sourceInit = waitFor(client.SO('Source'), 'init', 5000);
    client.SO('Source').subscribe();
    await sourceInit;

    const targetInit = waitFor(client.SO('Target'), 'init', 5000);
    client.SO('Target').subscribe();
    await targetInit;
  });

  after(async () => {
    client.SO('Source').unsubscribe();
    client.SO('Target').unsubscribe();
    await delay(100);
    client.close();
    await service.close();
    await delay(100);
  });

  it('should deep-copy when a client SO proxy is assigned via the write proxy', async () => {
    assert.strictEqual(client.SO('Source').data?.value, 1);
    assert.strictEqual(client.SO('Target').data?.captured?.value, 0);

    // Assign the client's Source .data (a read-only proxy) into the
    // server's Target SO via the write proxy. The write proxy detects
    // the UNWRAP_PROXY symbol and deep-copies the underlying target.
    service.SO<{ captured: { value: number } }>('Target').data.captured = client.SO('Source').data as any;
    service.SO('Target').notify();

    await waitUntil(
      () => client.SO('Target').data?.captured?.value === 1,
      5000,
    );

    assert.strictEqual(client.SO('Target').data?.captured?.value, 1);
  });

  it('should NOT create a live reference — Source mutations do not leak into Target', async () => {
    const targetVersionBefore = (service.SO('Target') as any)._version as number;

    // Update Source on the server side.
    service.SO<{ value: number }>('Source').rawData.value = 99;
    service.SO('Source').notify();

    await waitUntil(
      () => client.SO('Source').data?.value === 99,
      5000,
    );

    // Because the write proxy deep-copied the proxy's target, Target._data
    // holds a plain object, NOT a live reference to Source's client state.
    // Notifying Target should detect no changes.
    service.SO('Target').notify();
    await delay(100);

    const targetVersionAfter = (service.SO('Target') as any)._version as number;
    assert.strictEqual(
      targetVersionAfter,
      targetVersionBefore,
      'Target version should not change — no live reference exists',
    );

    // Client still sees the value from the initial assignment (1), not 99.
    assert.strictEqual(client.SO('Target').data?.captured?.value, 1);
  });

  it('should allow writing to children of the copied subtree', async () => {
    // Since the proxy was deep-copied into a plain object, writing
    // to its children via the write proxy works normally.
    service.SO<{ captured: { value: number } }>('Target').data.captured.value = 888;
    service.SO('Target').notify();

    await waitUntil(
      () => client.SO('Target').data?.captured?.value === 888,
      5000,
    );

    assert.strictEqual(client.SO('Target').data?.captured?.value, 888);
  });

  it('should still store proxy as-is when bypassing write proxy via rawData', async () => {
    // rawData bypasses the write proxy, so no UNWRAP_PROXY detection.
    // The proxy is stored directly — this is the "you know what you're doing" path.
    const clientSourceProxy = client.SO('Source').data;
    service.SO<{ captured: { value: number } }>('Target').rawData.captured = clientSourceProxy as any;
    service.SO('Target').notify();

    await waitUntil(
      () => client.SO('Target').data?.captured?.value === 99,
      5000,
    );

    // Verify it IS a live reference: update Source, then notify Target.
    service.SO<{ value: number }>('Source').rawData.value = 500;
    service.SO('Source').notify();
    await waitUntil(() => client.SO('Source').data?.value === 500, 5000);

    service.SO('Target').notify();
    await waitUntil(
      () => client.SO('Target').data?.captured?.value === 500,
      5000,
    );

    assert.strictEqual(
      client.SO('Target').data?.captured?.value,
      500,
      'rawData bypasses write proxy — proxy stored as live reference',
    );
  });
});
