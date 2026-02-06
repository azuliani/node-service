import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createWriteProxy } from '../src/proxy.ts';

describe('Write proxy aliasing', () => {
  it('should report correct paths when same object is at multiple keys', () => {
    const shared = { x: 1 };
    const root = { a: shared, b: shared };
    const mutations: (string | number)[][] = [];
    const proxied = createWriteProxy(root, (path) => mutations.push(path));

    proxied.a.x = 10;
    proxied.b.x = 20;

    assert.deepStrictEqual(mutations, [['a', 'x'], ['b', 'x']]);
  });

  it('should handle reassignment invalidating the cache', () => {
    const root = { a: { x: 1 }, b: { x: 2 } };
    const mutations: (string | number)[][] = [];
    const proxied = createWriteProxy(root, (path) => mutations.push(path));

    // Replace a with a new object
    proxied.a = { x: 99 };
    mutations.length = 0;

    // Accessing a should use the NEW object, not cached proxy of the old one
    proxied.a.x = 100;
    assert.deepStrictEqual(mutations, [['a', 'x']]);
    assert.strictEqual(root.a.x, 100);
  });
});
