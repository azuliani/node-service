/**
 * PathTree tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PathTree } from '../src/proxy.ts';

/**
 * Generate all permutations of an array.
 */
function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

/**
 * Sort paths by length, then lexicographically for deterministic comparison.
 */
function sortPaths(paths: (string | number)[][]): (string | number)[][] {
  return [...paths].sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    // Same length: compare lexicographically
    for (let i = 0; i < a.length; i++) {
      const cmp = String(a[i]).localeCompare(String(b[i]));
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

describe('PathTree', () => {
  describe('basic operations', () => {
    it('should start empty', () => {
      const tree = new PathTree();
      assert.strictEqual(tree.isEmpty(), true);
      assert.deepStrictEqual(tree.getPaths(), []);
    });

    it('should add a single path', () => {
      const tree = new PathTree();
      tree.add(['a', 'b']);
      assert.strictEqual(tree.isEmpty(), false);
      assert.deepStrictEqual(tree.getPaths(), [['a', 'b']]);
    });

    it('should clear all paths', () => {
      const tree = new PathTree();
      tree.add(['a', 'b']);
      tree.add(['c']);
      tree.clear();
      assert.strictEqual(tree.isEmpty(), true);
      assert.deepStrictEqual(tree.getPaths(), []);
    });

    it('should handle empty path (root)', () => {
      const tree = new PathTree();
      tree.add([]);
      assert.strictEqual(tree.isEmpty(), false);
      assert.deepStrictEqual(tree.getPaths(), [[]]);
    });

    it('should handle numeric path segments', () => {
      const tree = new PathTree();
      tree.add(['items', 0, 'name']);
      tree.add(['items', 1]);
      assert.deepStrictEqual(tree.getPaths(), [
        ['items', 1],
        ['items', 0, 'name'],
      ]);
    });
  });

  describe('subsumption', () => {
    it('should subsume longer path when shorter is added second', () => {
      const tree = new PathTree();
      tree.add(['a', 'b', 'c']);
      tree.add(['a', 'b']);
      assert.deepStrictEqual(tree.getPaths(), [['a', 'b']]);
    });

    it('should ignore longer path when shorter exists', () => {
      const tree = new PathTree();
      tree.add(['a', 'b']);
      tree.add(['a', 'b', 'c']);
      assert.deepStrictEqual(tree.getPaths(), [['a', 'b']]);
    });

    it('should keep sibling paths', () => {
      const tree = new PathTree();
      tree.add(['a', 'b']);
      tree.add(['a', 'c']);
      assert.deepStrictEqual(tree.getPaths(), [
        ['a', 'b'],
        ['a', 'c'],
      ]);
    });

    it('should subsume all descendants when parent added', () => {
      const tree = new PathTree();
      tree.add(['a', 'b', 'c']);
      tree.add(['a', 'b', 'd']);
      tree.add(['a', 'b', 'e', 'f']);
      tree.add(['a', 'b']); // Should subsume all above
      assert.deepStrictEqual(tree.getPaths(), [['a', 'b']]);
    });

    it('should handle root path subsuming everything', () => {
      const tree = new PathTree();
      tree.add(['a', 'b']);
      tree.add(['c']);
      tree.add(['d', 'e', 'f']);
      tree.add([]); // Root subsumes all
      assert.deepStrictEqual(tree.getPaths(), [[]]);
    });
  });

  describe('sorting', () => {
    it('should return paths sorted by length (shortest first)', () => {
      const tree = new PathTree();
      tree.add(['a', 'b', 'c']);
      tree.add(['x']);
      tree.add(['p', 'q']);
      assert.deepStrictEqual(tree.getPaths(), [
        ['x'],
        ['p', 'q'],
        ['a', 'b', 'c'],
      ]);
    });
  });

  describe('permutation invariance', () => {
    it('should produce same result for any permutation of [a,b,c], [a,b], [c]', () => {
      const paths: (string | number)[][] = [
        ['a', 'b', 'c'],
        ['a', 'b'],
        ['c'],
      ];

      // Expected: ['a','b'] subsumes ['a','b','c'], ['c'] is independent
      // Sorted by length: [['c'], ['a', 'b']]
      const expected = [['c'], ['a', 'b']];

      const allPermutations = permutations(paths);
      assert.strictEqual(allPermutations.length, 6); // 3! = 6 permutations

      for (const perm of allPermutations) {
        const tree = new PathTree();
        for (const path of perm) {
          tree.add(path);
        }
        assert.deepStrictEqual(
          tree.getPaths(),
          expected,
          `Failed for permutation: ${JSON.stringify(perm)}`
        );
      }
    });

    it('should produce same result for any permutation of [a], [a,b], [a,b,c], [b]', () => {
      const paths: (string | number)[][] = [
        ['a'],
        ['a', 'b'],
        ['a', 'b', 'c'],
        ['b'],
      ];

      // Expected: ['a'] subsumes ['a','b'] and ['a','b','c'], ['b'] is independent
      // Sorted by length, then lexicographically: [['a'], ['b']]
      const expected = [['a'], ['b']];

      const allPermutations = permutations(paths);
      assert.strictEqual(allPermutations.length, 24); // 4! = 24 permutations

      for (const perm of allPermutations) {
        const tree = new PathTree();
        for (const path of perm) {
          tree.add(path);
        }
        // Sort both for deterministic comparison (same-length paths may be in any order)
        assert.deepStrictEqual(
          sortPaths(tree.getPaths()),
          sortPaths(expected),
          `Failed for permutation: ${JSON.stringify(perm)}`
        );
      }
    });

    it('should produce same result for any permutation with numeric indices', () => {
      const paths: (string | number)[][] = [
        ['items', 0],
        ['items', 0, 'name'],
        ['items', 1],
        ['count'],
      ];

      // Expected: ['items',0] subsumes ['items',0,'name']
      // Sorted by length, then lexicographically: [['count'], ['items',0], ['items',1]]
      const expected = [['count'], ['items', 0], ['items', 1]];

      const allPermutations = permutations(paths);

      for (const perm of allPermutations) {
        const tree = new PathTree();
        for (const path of perm) {
          tree.add(path);
        }
        // Sort both for deterministic comparison (same-length paths may be in any order)
        assert.deepStrictEqual(
          sortPaths(tree.getPaths()),
          sortPaths(expected),
          `Failed for permutation: ${JSON.stringify(perm)}`
        );
      }
    });
  });

  describe('edge cases', () => {
    it('should handle adding same path twice', () => {
      const tree = new PathTree();
      tree.add(['a', 'b']);
      tree.add(['a', 'b']);
      assert.deepStrictEqual(tree.getPaths(), [['a', 'b']]);
    });

    it('should handle deeply nested paths', () => {
      const tree = new PathTree();
      tree.add(['a', 'b', 'c', 'd', 'e', 'f']);
      tree.add(['a', 'b', 'c']);
      assert.deepStrictEqual(tree.getPaths(), [['a', 'b', 'c']]);
    });

    it('should handle many sibling paths', () => {
      const tree = new PathTree();
      tree.add(['a']);
      tree.add(['b']);
      tree.add(['c']);
      tree.add(['d']);
      tree.add(['e']);
      assert.deepStrictEqual(tree.getPaths(), [
        ['a'],
        ['b'],
        ['c'],
        ['d'],
        ['e'],
      ]);
    });
  });
});
