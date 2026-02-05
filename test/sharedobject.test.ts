/**
 * SharedObject pattern tests.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync, getAvailablePort, delay, waitFor, waitUntil } from './helpers.ts';
import type { Descriptor, SharedObjectEndpoint, Diff } from '../src/index.ts';

function deltaTouchesKey(delta: Diff, key: string | number): boolean {
  const stack: unknown[] = [...delta];

  while (stack.length > 0) {
    const entry = stack.pop() as any;
    if (!entry) continue;

    // Node: [path: Key[], entries: Entry[]]
    if (Array.isArray(entry[0])) {
      const path = entry[0] as unknown[];
      if (path.includes(key)) return true;
      const children = entry[1] as unknown[];
      if (Array.isArray(children)) stack.push(...children);
      continue;
    }

    // Leaf: [key, kind, ...]
    if (entry[0] === key) return true;
  }

  return false;
}

describe('SharedObject Pattern', () => {
  describe('Basic state synchronization', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'GameState',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                score: { type: 'number' },
                level: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {},
        { GameState: { score: 0, level: 1 } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('GameState').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should receive initial state on subscribe', async () => {
      client.SO('GameState').subscribe();

      const event = await waitFor(client.SO('GameState'), 'init', 5000);

      assert.strictEqual(event.data.score, 0);
      assert.strictEqual(event.data.level, 1);
      assert.ok(client.SO('GameState').ready);
    });

    it('should receive updates after notify', async () => {
      const updates: Diff[] = [];
      client.SO('GameState').on('update', (delta: Diff) => updates.push(delta));

      // Modify server state and notify
      service.SO('GameState').data.score = 100;
      service.SO('GameState').notify();

      await delay(100);

      assert.strictEqual(updates.length, 1);
      assert.strictEqual(client.SO('GameState').data?.score, 100);
    });

    it('should reflect multiple updates', async () => {
      service.SO('GameState').data.score = 200;
      service.SO('GameState').data.level = 2;
      service.SO('GameState').notify();

      await delay(100);

      assert.strictEqual(client.SO('GameState').data?.score, 200);
      assert.strictEqual(client.SO('GameState').data?.level, 2);
    });
  });

  describe('Diff broadcasting', () => {
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
                items: {
                  type: 'array',
                  items: { type: 'string' },
                },
                nested: {
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
        { State: { items: [], nested: { value: 0 } } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('State').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should detect array changes', async () => {
      client.SO('State').subscribe();
      await waitFor(client.SO('State'), 'init', 5000);

      const updates: Diff[] = [];
      client.SO('State').on('update', (delta: Diff) => updates.push(delta));

      service.SO('State').data.items.push('first');
      service.SO('State').notify();

      await delay(100);

      assert.strictEqual(updates.length, 1);
      assert.deepStrictEqual(client.SO('State').data?.items, ['first']);
    });

    it('should detect nested object changes', async () => {
      const updates: Diff[] = [];
      client.SO('State').removeAllListeners('update');
      client.SO('State').on('update', (delta: Diff) => updates.push(delta));

      service.SO('State').data.nested.value = 42;
      service.SO('State').notify();

      await delay(100);

      assert.strictEqual(updates.length, 1);
      assert.strictEqual(client.SO('State').data?.nested.value, 42);
    });
  });

  describe('Hint parameter', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Data',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                a: { type: 'number' },
                b: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {},
        { Data: { a: 1, b: 2 } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('Data').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should use hint to optimize diff computation', async () => {
      client.SO('Data').subscribe();
      await waitFor(client.SO('Data'), 'init', 5000);

      const updates: Diff[] = [];
      client.SO('Data').on('update', (delta: Diff) => updates.push(delta));

      // Only change 'a', hint to only check 'a'
      service.SO('Data').data.a = 10;
      service.SO('Data').notify(['a']);

      await delay(100);

      assert.strictEqual(updates.length, 1);
      assert.ok(deltaTouchesKey(updates[0]!, 'a'));
      assert.strictEqual(client.SO('Data').data?.a, 10);
    });
  });

  describe('Read-only proxy', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Protected',
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
      service = new Service(
        descriptor,
        {},
        { Protected: { value: 42 } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('Protected').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should prevent modification of client data', async () => {
      client.SO('Protected').subscribe();
      await waitFor(client.SO('Protected'), 'init', 5000);

      assert.throws(
        () => {
          client.SO('Protected').data!.value = 100;
        },
        (err: Error) => {
          assert.ok(err.message.includes('read-only'));
          return true;
        }
      );
    });
  });

  describe('Date handling', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Timed',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                lastUpdate: { type: 'string', format: 'date-time' },
                value: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      const now = new Date('2024-01-01T00:00:00.000Z');
      service = new Service(
        descriptor,
        {},
        { Timed: { lastUpdate: now, value: 0 } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('Timed').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should parse dates in initial state', async () => {
      client.SO('Timed').subscribe();
      await waitFor(client.SO('Timed'), 'init', 5000);

      assert.ok(client.SO('Timed').data?.lastUpdate instanceof Date);
      assert.strictEqual(
        client.SO('Timed').data?.lastUpdate.toISOString(),
        '2024-01-01T00:00:00.000Z'
      );
    });

    it('should parse dates in updates', async () => {
      const newDate = new Date('2024-06-15T12:30:00.000Z');
      service.SO('Timed').data.lastUpdate = newDate;
      service.SO('Timed').notify();

      await delay(100);

      assert.ok(client.SO('Timed').data?.lastUpdate instanceof Date);
      assert.strictEqual(
        client.SO('Timed').data?.lastUpdate.toISOString(),
        '2024-06-15T12:30:00.000Z'
      );
    });

    it('should parse dates in updates with hint', async () => {
      const newDate = new Date('2024-07-20T08:45:00.000Z');
      service.SO('Timed').data.lastUpdate = newDate;
      service.SO('Timed').notify(['lastUpdate']);

      await delay(100);

      assert.ok(client.SO('Timed').data?.lastUpdate instanceof Date);
      assert.strictEqual(
        client.SO('Timed').data?.lastUpdate.toISOString(),
        '2024-07-20T08:45:00.000Z'
      );
    });
  });

  describe('Date handling in nested objects', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'NestedDates',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                meta: {
                  type: 'object',
                  properties: {
                    updatedAt: { type: 'string', format: 'date-time' },
                    count: { type: 'number' },
                  },
                  required: ['updatedAt', 'count'],
                },
              },
              required: ['meta'],
            },
          } as SharedObjectEndpoint,
        ],
      });
      const now = new Date('2024-01-01T00:00:00.000Z');
      service = new Service(
        descriptor,
        {},
        { NestedDates: { meta: { updatedAt: now, count: 0 } } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);

      client.SO('NestedDates').subscribe();
      await waitFor(client.SO('NestedDates'), 'init', 5000);
    });

    after(async () => {
      client.SO('NestedDates').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should allow notify() with hint on nested date objects', async () => {
      const updates: Diff[] = [];
      client.SO('NestedDates').on('update', (delta: Diff) => updates.push(delta));

      const newDate = new Date('2024-08-01T00:00:00.000Z');
      service.SO('NestedDates').data.meta.updatedAt = newDate;

      assert.doesNotThrow(() => {
        service.SO('NestedDates').notify(['meta']);
      });

      await waitUntil(() => updates.length >= 1);

      assert.ok(client.SO('NestedDates').data?.meta.updatedAt instanceof Date);
      assert.strictEqual(
        client.SO('NestedDates').data?.meta.updatedAt.toISOString(),
        '2024-08-01T00:00:00.000Z'
      );
    });

    it('should auto-notify on nested date changes', async () => {
      const updates: Diff[] = [];
      client.SO('NestedDates').removeAllListeners('update');
      client.SO('NestedDates').on('update', (delta: Diff) => updates.push(delta));

      const newDate = new Date('2024-09-01T00:00:00.000Z');
      service.SO('NestedDates').data.meta.updatedAt = newDate;

      await waitUntil(() => updates.length >= 1);

      assert.ok(client.SO('NestedDates').data?.meta.updatedAt instanceof Date);
      assert.strictEqual(
        client.SO('NestedDates').data?.meta.updatedAt.toISOString(),
        '2024-09-01T00:00:00.000Z'
      );
    });
  });

  describe('Validation', () => {
    let service: Service;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Validated',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                count: { type: 'number' },
              },
              required: ['count'],
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {},
        { Validated: { count: 0 } }
      );
      await service.ready();
    });

    after(async () => {
      await service.close();
      await delay(100);
    });

    it('should validate on notify', async () => {
      // Set invalid data - this will trigger auto-detection
      (service.SO('Validated').data as any).count = 'not a number';

      // Manual notify should throw
      assert.throws(
        () => service.SO('Validated').notify(),
        (err: Error) => {
          assert.ok(err.message.includes('Validation failed'));
          return true;
        }
      );

      // Reset data to valid state before auto-detection runs
      (service.SO('Validated').data as any).count = 0;

      // Wait for auto-detection to run (it will succeed with valid data now)
      await delay(50);
    });

    it('should validate initial state', async () => {
      const badDescriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Validated',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                count: { type: 'number' },
              },
              required: ['count'],
            },
          } as SharedObjectEndpoint,
        ],
      });

      const badService = new Service(
        badDescriptor,
        {},
        { Validated: { count: 'not a number' } }
      );

      await assert.rejects(
        () => badService.ready(),
        (err: Error) => {
          assert.ok(err.message.includes('Validation failed'));
          return true;
        }
      );

      await badService.close();
      await delay(100);
    });
  });

  describe('Multiple clients', () => {
    let service: Service;
    let client1: Client;
    let client2: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'Shared',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                counter: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {},
        { Shared: { counter: 0 } }
      );
      await service.ready();
      client1 = new Client(descriptor);
      client2 = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client1.SO('Shared').unsubscribe();
      client2.SO('Shared').unsubscribe();
      await delay(100);
      client1.close();
      client2.close();
      await service.close();
      await delay(100);
    });

    it('should sync to multiple clients', async () => {
      client1.SO('Shared').subscribe();
      client2.SO('Shared').subscribe();

      await waitFor(client1.SO('Shared'), 'init', 5000);
      await waitFor(client2.SO('Shared'), 'init', 5000);

      service.SO('Shared').data.counter = 42;
      service.SO('Shared').notify();

      await delay(75);

      assert.strictEqual(client1.SO('Shared').data?.counter, 42);
      assert.strictEqual(client2.SO('Shared').data?.counter, 42);
    });
  });

  describe('Version gap handling', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'VersionTest',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                x: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {},
        { VersionTest: { x: 0 } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.close();
      await service.close();
      await delay(100);
    });

    it('should emit disconnected and recover via re-init on version gap', async () => {
      client.SO('VersionTest').subscribe();
      await waitFor(client.SO('VersionTest'), 'init', 5000);

      assert.ok(client.SO('VersionTest').ready);

      // Manually increment server version by 2 (skip v+1) to create a gap
      // Access private _version via type assertion
      const endpoint = service.SO('VersionTest') as any;
      endpoint._version += 1; // Skip one version
      // Also update snapshot to match so notify() detects a change
      endpoint._lastSnapshot = { x: endpoint._data.x };

      // Track disconnect event and ready state at disconnect time
      let readyAtDisconnect: boolean | null = null;
      const disconnectPromise = waitFor(client.SO('VersionTest'), 'disconnected', 2000);
      client.SO('VersionTest').once('disconnected', () => {
        readyAtDisconnect = client.SO('VersionTest').ready;
      });

      // Expect a fresh init after gap detection
      const reinitPromise = waitFor(client.SO('VersionTest'), 'init', 5000);

      // Now notify - client will receive version v+2 when expecting v+1
      service.SO('VersionTest').data.x = 200;
      service.SO('VersionTest').notify();

      await disconnectPromise;
      assert.strictEqual(readyAtDisconnect, false, 'ready should be false at disconnect on version gap');

      await reinitPromise;
      assert.strictEqual(client.SO('VersionTest').ready, true, 'Client should become ready again after re-init');
      assert.strictEqual(client.SO('VersionTest').data?.x, 200);
    });
  });

  describe('Automatic change detection', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'AutoDetect',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                count: { type: 'number' },
                name: { type: 'string' },
                nested: {
                  type: 'object',
                  properties: {
                    value: { type: 'number' },
                    deep: {
                      type: 'object',
                      properties: {
                        x: { type: 'number' },
                      },
                    },
                  },
                },
                items: {
                  type: 'array',
                  items: { type: 'number' },
                },
              },
            },
          } as SharedObjectEndpoint,
        ],
      });
      service = new Service(
        descriptor,
        {},
        { AutoDetect: { count: 0, name: 'test', nested: { value: 0, deep: { x: 0 } }, items: [] } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('AutoDetect').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should auto-notify on simple property change', async () => {
      client.SO('AutoDetect').subscribe();
      await waitFor(client.SO('AutoDetect'), 'init', 5000);

      const updates: Diff[] = [];
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      // Change property without manual notify()
      service.SO('AutoDetect').data.count = 42;

      // Wait for update to arrive
      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive one update');
      assert.strictEqual(client.SO('AutoDetect').data?.count, 42);
    });

    it('should auto-notify on nested property change', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      // Change nested property
      service.SO('AutoDetect').data.nested.value = 100;

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive one update');
      assert.strictEqual(client.SO('AutoDetect').data?.nested.value, 100);
    });

    it('should batch multiple synchronous changes into one notification', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      // Make multiple changes synchronously
      service.SO('AutoDetect').data.count = 1;
      service.SO('AutoDetect').data.name = 'changed';
      service.SO('AutoDetect').data.nested.value = 200;

      await waitUntil(() => updates.length >= 1);

      // Should be batched into a single update event
      assert.strictEqual(updates.length, 1, 'Multiple sync changes should batch into one update');
      assert.strictEqual(client.SO('AutoDetect').data?.count, 1);
      assert.strictEqual(client.SO('AutoDetect').data?.name, 'changed');
      assert.strictEqual(client.SO('AutoDetect').data?.nested.value, 200);
    });

    it('should merge overlapping paths (parent subsumes child)', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      // Change both parent and child paths
      service.SO('AutoDetect').data.nested.deep.x = 999;
      service.SO('AutoDetect').data.nested.value = 300;

      await waitUntil(() => updates.length >= 1);

      // Should be batched
      assert.strictEqual(updates.length, 1, 'Should receive one batched update');
      assert.strictEqual(client.SO('AutoDetect').data?.nested.deep.x, 999);
      assert.strictEqual(client.SO('AutoDetect').data?.nested.value, 300);
    });

    it('should handle array push', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      service.SO('AutoDetect').data.items.push(1, 2, 3);

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive one update for push');
      assert.deepStrictEqual(client.SO('AutoDetect').data?.items, [1, 2, 3]);
    });

    it('should handle array pop', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      const popped = service.SO('AutoDetect').data.items.pop();

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(popped, 3);
      assert.strictEqual(updates.length, 1, 'Should receive one update for pop');
      assert.deepStrictEqual(client.SO('AutoDetect').data?.items, [1, 2]);
    });

    it('should handle array splice', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      service.SO('AutoDetect').data.items.splice(1, 0, 99);

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive one update for splice');
      assert.deepStrictEqual(client.SO('AutoDetect').data?.items, [1, 99, 2]);
    });

    it('should apply multi-delete array deltas correctly', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      // Reset array to known state
      service.SO('AutoDetect').data.items = [1, 2, 3, 4, 5];

      await waitUntil(() => updates.length >= 1);
      updates.length = 0;

      // Remove multiple items in one mutation to generate multiple array diffs
      service.SO('AutoDetect').data.items.splice(2, 2);

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive one update for multi-delete');
      assert.deepStrictEqual(client.SO('AutoDetect').data?.items, [1, 2, 5]);
    });

    it('should handle property deletion', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      delete (service.SO('AutoDetect').data as any).name;

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive one update for deletion');
      assert.strictEqual((client.SO('AutoDetect').data as any).name, undefined);
    });

    it('should handle object replacement', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      service.SO('AutoDetect').data.nested = { value: 999, deep: { x: 888 } };

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive one update for object replacement');
      assert.strictEqual(client.SO('AutoDetect').data?.nested.value, 999);
      assert.strictEqual(client.SO('AutoDetect').data?.nested.deep.x, 888);
    });

    it('should work alongside manual notify() calls', async () => {
      const updates: Diff[] = [];
      client.SO('AutoDetect').removeAllListeners('update');
      client.SO('AutoDetect').on('update', (delta: Diff) => updates.push(delta));

      // Auto-detected change
      service.SO('AutoDetect').data.count = 500;

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive auto-detected update');
      assert.strictEqual(client.SO('AutoDetect').data?.count, 500);

      // Manual notify with hint
      service.SO('AutoDetect').data.count = 600;
      service.SO('AutoDetect').notify(['count']);

      await waitUntil(() => updates.length >= 2);

      assert.strictEqual(updates.length, 2, 'Should also receive manually notified update');
      assert.strictEqual(client.SO('AutoDetect').data?.count, 600);
    });
  });

  describe('Manual notification mode (autoNotify: false)', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;

    before(async () => {
      descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'ManualNotify',
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
        { ManualNotify: { count: 0, name: 'initial' } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.SO('ManualNotify').unsubscribe();
      await delay(100);
      client.close();
      await service.close();
      await delay(100);
    });

    it('should NOT auto-notify when autoNotify is false', async () => {
      client.SO('ManualNotify').subscribe();
      await waitFor(client.SO('ManualNotify'), 'init', 5000);

      const updates: Diff[] = [];
      client.SO('ManualNotify').on('update', (delta: Diff) => updates.push(delta));

      // Change property - should NOT trigger automatic notification
      service.SO('ManualNotify').data.count = 42;

      // Wait some time to ensure no auto-notification happens
      await delay(100);

      assert.strictEqual(updates.length, 0, 'Should NOT receive automatic update');
      // Client should still have old value
      assert.strictEqual(client.SO('ManualNotify').data?.count, 0);
    });

    it('should notify only when notify() is called manually', async () => {
      const updates: Diff[] = [];
      client.SO('ManualNotify').removeAllListeners('update');
      client.SO('ManualNotify').on('update', (delta: Diff) => updates.push(delta));

      // Make multiple changes
      service.SO('ManualNotify').data.count = 100;
      service.SO('ManualNotify').data.name = 'changed';

      // Still no auto-notification
      await delay(50);
      assert.strictEqual(updates.length, 0, 'Should NOT auto-notify');

      // Now manually notify
      service.SO('ManualNotify').notify();

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive update after manual notify');
      assert.strictEqual(client.SO('ManualNotify').data?.count, 100);
      assert.strictEqual(client.SO('ManualNotify').data?.name, 'changed');
    });

    it('should work with hint in manual mode', async () => {
      const updates: Diff[] = [];
      client.SO('ManualNotify').removeAllListeners('update');
      client.SO('ManualNotify').on('update', (delta: Diff) => updates.push(delta));

      // Change and notify with hint
      service.SO('ManualNotify').data.count = 200;
      service.SO('ManualNotify').notify(['count']);

      await waitUntil(() => updates.length >= 1);

      assert.strictEqual(updates.length, 1, 'Should receive update with hint');
      assert.strictEqual(client.SO('ManualNotify').data?.count, 200);
    });
  });

  describe('Disconnect handling', () => {
    let service: Service;
    let client: Client;
    let descriptor: Descriptor;
    let port: number;

    before(async () => {
      port = await getAvailablePort();
      descriptor = {
        transport: {
          server: `127.0.0.1:${port}`,
          client: `127.0.0.1:${port}`,
        },
        endpoints: [
          {
            name: 'DisconnectTest',
            type: 'SharedObject',
            objectSchema: {
              type: 'object',
              properties: {
                a: { type: 'number' },
                b: { type: 'number' },
              },
            },
          } as SharedObjectEndpoint,
        ],
      };
      service = new Service(
        descriptor,
        {},
        { DisconnectTest: { a: 1, b: 2 } }
      );
      await service.ready();
      client = new Client(descriptor);
      await delay(100);
    });

    after(async () => {
      client.close();
      await delay(100);
    });

    it('should not emit synthetic deletion diffs on disconnect', async () => {
      client.SO('DisconnectTest').subscribe();
      await waitFor(client.SO('DisconnectTest'), 'init', 5000);

      assert.strictEqual(client.SO('DisconnectTest').data?.a, 1);
      assert.strictEqual(client.SO('DisconnectTest').data?.b, 2);

      const deletionDeltas: Diff[] = [];
      client.SO('DisconnectTest').on('update', (delta: Diff) => deletionDeltas.push(delta));

      // Close server
      await service.close();

      // Wait for disconnect to be detected
      await waitFor(client.SO('DisconnectTest'), 'disconnected', 2000);

      // SharedObjects are inaccessible when non-ready; clients should react to
      // the disconnect signal rather than relying on synthetic deletion diffs.
      assert.strictEqual(deletionDeltas.length, 0, 'Should not receive update deltas on disconnect');

      // Client state should be reset
      assert.strictEqual(client.SO('DisconnectTest').ready, false);
      assert.throws(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        client.SO('DisconnectTest').data;
      });
    });
  });
});
