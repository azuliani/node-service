/**
 * Proxy utilities for SharedObject state management.
 *
 * - createReadOnlyProxy: Public export for client-side read-only access
 * - createWriteProxy: Internal for server-side mutation detection
 */

/**
 * Array methods that mutate the array.
 */
const MUTATING_ARRAY_METHODS = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
] as const;

function normalizeArrayKey(prop: string | number): string | number {
  if (typeof prop === 'number') return prop;
  const index = Number(prop);
  if (Number.isInteger(index) && index >= 0 && String(index) === prop) {
    return index;
  }
  return prop;
}

/**
 * Tree node for PathTree.
 */
interface PathTreeNode {
  children: Map<string | number, PathTreeNode>;
  isEndpoint: boolean; // true if this path was explicitly added
}

/**
 * PathTree - Efficient path storage with automatic subsumption.
 *
 * Used for batching mutations during automatic change detection in SharedObject.
 * Stores paths hierarchically where shorter paths automatically subsume
 * (remove) longer descendant paths.
 *
 * ## Algorithm
 *
 * - **Insertion complexity**: O(path_length)
 * - **Subsumption**: When adding path ["a", "b"], any existing ["a", "b", "c"] is removed
 * - **Coverage**: When adding path ["a"], both ["a", "b"] and ["a", "c", "d"] are removed
 * - **Traversal**: Yields only the shortest (most general) paths
 *
 * ## How it works
 *
 * The tree structure mirrors the object path hierarchy. Each node tracks:
 * - `children`: Map of child nodes keyed by path segment
 * - `isEndpoint`: Whether this path was explicitly added (vs being just a traversal node)
 *
 * On insertion:
 * 1. Walk down the tree following path segments
 * 2. If we encounter an endpoint, stop (our path is already covered by a shorter one)
 * 3. If we reach the end, mark as endpoint and clear children (we subsume longer paths)
 *
 * ## Example
 *
 * ```typescript
 * const tree = new PathTree();
 * tree.add(["user", "profile", "name"]);  // stored
 * tree.add(["user", "profile"]);          // subsumes previous, only this stored
 * tree.add(["user", "profile", "age"]);   // ignored, already covered by parent
 * tree.getPaths();  // [["user", "profile"]]
 * ```
 *
 * ## Use case
 *
 * When multiple mutations happen synchronously to a SharedObject:
 * ```typescript
 * data.user.name = "Alice";     // records ["user", "name"]
 * data.user.age = 30;           // records ["user", "age"]
 * data.user = { name: "Bob" };  // records ["user"], subsumes both above
 * ```
 *
 * The tree ensures we only diff at ["user"], not redundantly at the child paths.
 */
export class PathTree {
  private root: PathTreeNode = { children: new Map(), isEndpoint: false };

  /**
   * Add a path to the tree.
   * - If a prefix already exists as endpoint, this path is subsumed (no-op)
   * - If this path is added, any longer paths (children) are removed
   */
  add(path: (string | number)[]): void {
    let node = this.root;

    for (const segment of path) {
      // If current node is an endpoint, this path is already covered
      if (node.isEndpoint) return;

      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), isEndpoint: false });
      }
      node = node.children.get(segment)!;
    }

    // Mark as endpoint and clear children (they're now subsumed)
    node.isEndpoint = true;
    node.children.clear();
  }

  /**
   * Get all paths (endpoints only), sorted by length (shortest first).
   */
  getPaths(): (string | number)[][] {
    const result: (string | number)[][] = [];
    this._collect(this.root, [], result);
    result.sort((a, b) => a.length - b.length);
    return result;
  }

  private _collect(
    node: PathTreeNode,
    currentPath: (string | number)[],
    result: (string | number)[][]
  ): void {
    if (node.isEndpoint) {
      result.push([...currentPath]);
      return; // Don't recurse - children were cleared
    }
    for (const [segment, child] of node.children) {
      this._collect(child, [...currentPath, segment], result);
    }
  }

  /**
   * Clear all paths from the tree.
   */
  clear(): void {
    this.root = { children: new Map(), isEndpoint: false };
  }

  /**
   * Check if the tree has no paths.
   */
  isEmpty(): boolean {
    return this.root.children.size === 0 && !this.root.isEndpoint;
  }
}

/**
 * Create a read-only proxy for an object.
 * Throws on any attempt to set or delete properties.
 *
 * @param obj - The object to wrap
 * @returns A read-only proxy of the object
 */
export function createReadOnlyProxy<T extends object>(obj: T): T {
  const handler: ProxyHandler<T> = {
    get: (target, prop, receiver) => {
      const value = Reflect.get(target, prop, receiver);

      // Handle Date objects specially - don't proxy them
      if (value instanceof Date) {
        return value;
      }

      // Recursively proxy nested objects
      if (value !== null && typeof value === 'object') {
        return new Proxy(value, handler as ProxyHandler<typeof value>);
      }

      return value;
    },

    set: () => {
      throw new Error('Cannot modify read-only SharedObject data');
    },

    deleteProperty: () => {
      throw new Error('Cannot modify read-only SharedObject data');
    },
  };

  return new Proxy(obj, handler);
}

/**
 * Create a write proxy that tracks mutations.
 * Calls onMutation with the path of each change.
 *
 * @param target - The object to wrap
 * @param onMutation - Callback called with the path of each mutation
 * @returns A proxy that tracks mutations
 */
export function createWriteProxy<T extends object>(
  target: T,
  onMutation: (path: (string | number)[]) => void
): T {
  return createNestedProxy(target, [], onMutation);
}

/**
 * Create a nested proxy with path tracking.
 */
function createNestedProxy<T extends object>(
  target: T,
  basePath: (string | number)[],
  onMutation: (path: (string | number)[]) => void
): T {
  // Cache for proxied nested objects to maintain reference equality
  const proxyCache = new WeakMap<object, object>();

  const handler: ProxyHandler<T> = {
    get: (obj, prop, receiver) => {
      const value = Reflect.get(obj, prop, receiver);

      // Handle symbols (used by array methods, iterators, etc.)
      if (typeof prop === 'symbol') {
        return value;
      }

      // Handle Date objects - don't proxy them
      if (value instanceof Date) {
        return value;
      }

      // Wrap mutating array methods
      if (Array.isArray(obj) && (MUTATING_ARRAY_METHODS as readonly string[]).includes(prop as string)) {
        return wrapArrayMethod(obj, prop as string, basePath, onMutation);
      }

      // Recursively proxy nested objects
      if (value !== null && typeof value === 'object') {
        // Check cache first
        if (proxyCache.has(value)) {
          return proxyCache.get(value);
        }

        // Convert numeric string props to numbers for array access
        const key = Array.isArray(obj) ? normalizeArrayKey(prop as string) : prop;
        const nestedPath = [...basePath, key as string | number];
        const proxy = createNestedProxy(value, nestedPath, onMutation);
        proxyCache.set(value, proxy);
        return proxy;
      }

      return value;
    },

    set: (obj, prop, value, receiver) => {
      // Handle symbols
      if (typeof prop === 'symbol') {
        return Reflect.set(obj, prop, value, receiver);
      }

      // Convert numeric string props to numbers for array access
      const key = Array.isArray(obj) ? normalizeArrayKey(prop as string) : prop;
      const path = Array.isArray(obj) && key === 'length'
        ? [...basePath]
        : [...basePath, key as string | number];

      // Invalidate cache for the old value if it was an object (before set)
      const oldValue = Reflect.get(obj, prop);
      if (oldValue !== null && typeof oldValue === 'object') {
        proxyCache.delete(oldValue as object);
      }

      // Perform the set
      const result = Reflect.set(obj, prop, value, receiver);

      // Only trigger mutation if value actually changed
      if (result) {
        onMutation(path);
      }

      return result;
    },

    deleteProperty: (obj, prop) => {
      // Handle symbols
      if (typeof prop === 'symbol') {
        return Reflect.deleteProperty(obj, prop);
      }

      const key = Array.isArray(obj) ? normalizeArrayKey(prop as string) : prop;
      const path = Array.isArray(obj) && key === 'length'
        ? [...basePath]
        : [...basePath, key as string | number];

      // Invalidate cache for the value if it was an object
      const value = Reflect.get(obj, prop);
      if (value !== null && typeof value === 'object') {
        proxyCache.delete(value as object);
      }

      const result = Reflect.deleteProperty(obj, prop);

      if (result) {
        onMutation(path);
      }

      return result;
    },
  };

  return new Proxy(target, handler);
}

/**
 * Wrap an array mutating method to trigger onMutation.
 */
function wrapArrayMethod(
  arr: unknown[],
  method: string,
  basePath: (string | number)[],
  onMutation: (path: (string | number)[]) => void
): (...args: unknown[]) => unknown {
  const original = (arr as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!;

  return function (...args: unknown[]) {
    const result = original.apply(arr, args);
    // Notify at the array level - the entire array may have changed
    onMutation(basePath);
    return result;
  };
}
