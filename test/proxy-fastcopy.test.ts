/**
 * Fast-copy behavior tests for proxied SharedObject data.
 *
 * These tests verify that fast-copy works correctly on proxied objects
 * (both read-only client-side and write-tracking server-side).
 *
 * NOTE: structuredClone() does NOT work on Proxy objects - it throws
 * DataCloneError. Use fast-copy instead.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import copy from 'fast-copy';
import { createReadOnlyProxy, createWriteProxy } from '../src/proxy.ts';

describe('Proxy Fast-Copy Behavior', () => {
  describe('createReadOnlyProxy fast-copy', () => {
    const createTestData = () => ({
      name: 'test',
      count: 42,
      active: true,
      nested: {
        level1: {
          level2: {
            value: 'deep',
            array: [1, 2, 3],
          },
        },
      },
      items: [
        { id: 1, name: 'first' },
        { id: 2, name: 'second' },
      ],
      createdAt: new Date('2024-01-01T00:00:00Z'),
      tags: ['a', 'b', 'c'],
      nullValue: null,
      emptyArray: [],
      emptyObject: {},
    });

    describe('fast-copy', () => {
      it('should correctly clone proxied data', () => {
        const raw = createTestData();
        const proxied = createReadOnlyProxy(raw);
        const cloned = copy(proxied);

        // Values should match
        assert.strictEqual(cloned.name, 'test');
        assert.strictEqual(cloned.count, 42);
        assert.strictEqual(cloned.active, true);
        assert.strictEqual(cloned.nested.level1.level2.value, 'deep');
        assert.deepStrictEqual(cloned.nested.level1.level2.array, [1, 2, 3]);
        assert.deepStrictEqual(cloned.items, [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
        ]);
        assert.deepStrictEqual(cloned.tags, ['a', 'b', 'c']);
        assert.strictEqual(cloned.nullValue, null);
        assert.deepStrictEqual(cloned.emptyArray, []);
        assert.deepStrictEqual(cloned.emptyObject, {});
      });

      it('should preserve Date objects', () => {
        const raw = createTestData();
        const proxied = createReadOnlyProxy(raw);
        const cloned = copy(proxied);

        assert.ok(cloned.createdAt instanceof Date);
        assert.strictEqual(cloned.createdAt.toISOString(), '2024-01-01T00:00:00.000Z');
      });

      it('should return non-proxied mutable data', () => {
        const raw = createTestData();
        const proxied = createReadOnlyProxy(raw);
        const cloned = copy(proxied);

        // Should be able to mutate cloned data (proves it's not proxied)
        cloned.name = 'modified';
        cloned.count = 100;
        cloned.nested.level1.level2.value = 'changed';
        cloned.items.push({ id: 3, name: 'third' });

        assert.strictEqual(cloned.name, 'modified');
        assert.strictEqual(cloned.count, 100);
        assert.strictEqual(cloned.nested.level1.level2.value, 'changed');
        assert.strictEqual(cloned.items.length, 3);

        // Original should be unchanged
        assert.strictEqual(raw.name, 'test');
        assert.strictEqual(raw.count, 42);
      });

      it('should create independent copy (no reference sharing)', () => {
        const raw = createTestData();
        const proxied = createReadOnlyProxy(raw);
        const cloned = copy(proxied);

        // Modify cloned nested object
        cloned.nested.level1.level2.array.push(4);

        // Original should be unchanged
        assert.deepStrictEqual(raw.nested.level1.level2.array, [1, 2, 3]);
      });
    });

    describe('JSON.parse(JSON.stringify())', () => {
      it('should correctly clone proxied data', () => {
        const raw = createTestData();
        const proxied = createReadOnlyProxy(raw);
        const cloned = JSON.parse(JSON.stringify(proxied));

        assert.strictEqual(cloned.name, 'test');
        assert.strictEqual(cloned.count, 42);
        assert.strictEqual(cloned.active, true);
        assert.strictEqual(cloned.nested.level1.level2.value, 'deep');
        assert.deepStrictEqual(cloned.items, [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
        ]);
      });

      it('should convert Date to ISO string (known limitation)', () => {
        const raw = createTestData();
        const proxied = createReadOnlyProxy(raw);
        const cloned = JSON.parse(JSON.stringify(proxied));

        // JSON.stringify converts Date to string
        assert.strictEqual(typeof cloned.createdAt, 'string');
        assert.strictEqual(cloned.createdAt, '2024-01-01T00:00:00.000Z');
      });

      it('should return mutable data', () => {
        const raw = createTestData();
        const proxied = createReadOnlyProxy(raw);
        const cloned = JSON.parse(JSON.stringify(proxied));

        cloned.name = 'modified';
        assert.strictEqual(cloned.name, 'modified');
        assert.strictEqual(raw.name, 'test');
      });
    });
  });

  describe('createWriteProxy fast-copy', () => {
    const createTestData = () => ({
      players: {
        player1: { x: 10, y: 20, health: 100 },
        player2: { x: 30, y: 40, health: 80 },
      },
      entities: [
        { type: 'enemy', pos: { x: 100, y: 200 } },
        { type: 'item', pos: { x: 150, y: 250 } },
      ],
      metadata: {
        version: 1,
        lastUpdate: new Date('2024-06-15T12:00:00Z'),
      },
    });

    describe('fast-copy', () => {
      it('should correctly clone proxied data', () => {
        const mutations: (string | number)[][] = [];
        const raw = createTestData();
        const proxied = createWriteProxy(raw, (path) => mutations.push(path));
        const cloned = copy(proxied);

        assert.deepStrictEqual(cloned.players.player1, { x: 10, y: 20, health: 100 });
        assert.strictEqual(cloned.entities.length, 2);
        assert.strictEqual(cloned.entities[0].type, 'enemy');
      });

      it('should NOT trigger mutation callbacks during clone', () => {
        const mutations: (string | number)[][] = [];
        const raw = createTestData();
        const proxied = createWriteProxy(raw, (path) => mutations.push(path));

        copy(proxied);

        // No mutations should be recorded
        assert.strictEqual(mutations.length, 0);
      });

      it('should preserve Date objects', () => {
        const mutations: (string | number)[][] = [];
        const raw = createTestData();
        const proxied = createWriteProxy(raw, (path) => mutations.push(path));
        const cloned = copy(proxied);

        assert.ok(cloned.metadata.lastUpdate instanceof Date);
        assert.strictEqual(cloned.metadata.lastUpdate.toISOString(), '2024-06-15T12:00:00.000Z');
      });

      it('should return non-proxied mutable data', () => {
        const mutations: (string | number)[][] = [];
        const raw = createTestData();
        const proxied = createWriteProxy(raw, (path) => mutations.push(path));
        const cloned = copy(proxied);

        // Modify cloned - should NOT trigger mutation callback
        cloned.players.player1.x = 999;
        cloned.entities.push({ type: 'new', pos: { x: 0, y: 0 } });

        assert.strictEqual(cloned.players.player1.x, 999);
        assert.strictEqual(cloned.entities.length, 3);
        assert.strictEqual(mutations.length, 0);

        // Original should be unchanged
        assert.strictEqual(raw.players.player1.x, 10);
        assert.strictEqual(raw.entities.length, 2);
      });
    });

    describe('JSON.parse(JSON.stringify())', () => {
      it('should correctly clone proxied data', () => {
        const mutations: (string | number)[][] = [];
        const raw = createTestData();
        const proxied = createWriteProxy(raw, (path) => mutations.push(path));
        const cloned = JSON.parse(JSON.stringify(proxied));

        assert.deepStrictEqual(cloned.players.player1, { x: 10, y: 20, health: 100 });
        assert.strictEqual(cloned.entities[0].type, 'enemy');
      });

      it('should NOT trigger mutation callbacks during clone', () => {
        const mutations: (string | number)[][] = [];
        const raw = createTestData();
        const proxied = createWriteProxy(raw, (path) => mutations.push(path));

        JSON.parse(JSON.stringify(proxied));

        assert.strictEqual(mutations.length, 0);
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle deeply nested proxies correctly', () => {
      const raw = {
        a: { b: { c: { d: { e: { f: { value: 'deep' } } } } } },
      };
      const proxied = createReadOnlyProxy(raw);

      // Access deeply to create nested proxies
      const _ = proxied.a.b.c.d.e.f.value;

      const cloned = copy(proxied);
      assert.strictEqual(cloned.a.b.c.d.e.f.value, 'deep');

      // Should be mutable
      cloned.a.b.c.d.e.f.value = 'changed';
      assert.strictEqual(cloned.a.b.c.d.e.f.value, 'changed');
      assert.strictEqual(raw.a.b.c.d.e.f.value, 'deep');
    });

    it('should handle arrays with mixed content', () => {
      const raw = {
        mixed: [1, 'two', { three: 3 }, [4, 5], null, true],
      };
      const proxied = createReadOnlyProxy(raw);
      const cloned = copy(proxied);

      assert.strictEqual(cloned.mixed[0], 1);
      assert.strictEqual(cloned.mixed[1], 'two');
      assert.deepStrictEqual(cloned.mixed[2], { three: 3 });
      assert.deepStrictEqual(cloned.mixed[3], [4, 5]);
      assert.strictEqual(cloned.mixed[4], null);
      assert.strictEqual(cloned.mixed[5], true);
    });

    it('should handle empty objects and arrays', () => {
      const raw = {
        emptyObj: {},
        emptyArr: [],
        nestedEmpty: { obj: {}, arr: [] },
      };
      const proxied = createReadOnlyProxy(raw);
      const cloned = copy(proxied);

      assert.deepStrictEqual(cloned.emptyObj, {});
      assert.deepStrictEqual(cloned.emptyArr, []);
      assert.deepStrictEqual(cloned.nestedEmpty, { obj: {}, arr: [] });
    });

    it('should handle large arrays', () => {
      const raw = {
        largeArray: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          value: `item-${i}`,
        })),
      };
      const proxied = createReadOnlyProxy(raw);
      const cloned = copy(proxied);

      assert.strictEqual(cloned.largeArray.length, 1000);
      assert.strictEqual(cloned.largeArray[500].id, 500);
      assert.strictEqual(cloned.largeArray[500].value, 'item-500');
    });

    it('should handle multiple Date objects', () => {
      const raw = {
        dates: {
          created: new Date('2024-01-01'),
          updated: new Date('2024-06-15'),
          events: [
            { date: new Date('2024-02-01'), name: 'event1' },
            { date: new Date('2024-03-01'), name: 'event2' },
          ],
        },
      };
      const proxied = createReadOnlyProxy(raw);
      const cloned = copy(proxied);

      assert.ok(cloned.dates.created instanceof Date);
      assert.ok(cloned.dates.updated instanceof Date);
      assert.ok(cloned.dates.events[0].date instanceof Date);
      assert.ok(cloned.dates.events[1].date instanceof Date);

      assert.strictEqual(cloned.dates.created.toISOString(), '2024-01-01T00:00:00.000Z');
      assert.strictEqual(cloned.dates.events[1].date.toISOString(), '2024-03-01T00:00:00.000Z');
    });
  });

  describe('structuredClone limitation', () => {
    it('should throw DataCloneError on proxied objects', () => {
      const raw = { value: 1 };
      const proxied = createReadOnlyProxy(raw);

      assert.throws(
        () => structuredClone(proxied),
        /could not be cloned/
      );
    });
  });
});
