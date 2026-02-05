/**
 * Test data generators for benchmarks.
 */

import type { JSONSchema } from '../../src/types.ts';

/**
 * State size configuration.
 */
export interface StateSizeConfig {
  name: string;
  properties: number;
  depth: number;
  arraySize: number;
}

/**
 * Predefined state size configurations.
 */
export const STATE_SIZES: Record<string, StateSizeConfig> = {
  small: { name: 'Small', properties: 10, depth: 2, arraySize: 10 },
  medium: { name: 'Medium', properties: 100, depth: 3, arraySize: 100 },
  large: { name: 'Large', properties: 1000, depth: 4, arraySize: 1000 },
  xl: { name: 'XL', properties: 10000, depth: 5, arraySize: 10000 },
};

/**
 * Generate a flat object with the specified number of properties.
 */
export function generateFlatObject(count: number): Record<string, number> {
  const obj: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    obj[`prop${i}`] = i;
  }
  return obj;
}

/**
 * Generate a nested object with the specified depth.
 */
export function generateNestedObject(depth: number, breadth: number): object {
  if (depth <= 1) {
    return generateFlatObject(breadth);
  }
  const obj: Record<string, unknown> = {};
  const childBreadth = Math.max(2, Math.floor(breadth / 3));
  for (let i = 0; i < 3; i++) {
    obj[`level${i}`] = generateNestedObject(depth - 1, childBreadth);
  }
  return obj;
}

/**
 * Generate an array with the specified size.
 */
export function generateArray(size: number): number[] {
  return Array.from({ length: size }, (_, i) => i);
}

/**
 * Generate test state based on size configuration.
 */
export function generateState(config: StateSizeConfig): object {
  return {
    flat: generateFlatObject(config.properties),
    nested: generateNestedObject(config.depth, Math.floor(config.properties / 10)),
    items: generateArray(config.arraySize),
    counter: 0,
  };
}

/**
 * Generate a JSON schema for the state.
 *
 * NOTE: Uses additionalProperties instead of explicit property definitions.
 * Defining 1000+ explicit properties causes TypeBox to generate a massive
 * alternation regex for property validation, which is extremely slow.
 */
export function generateSchema(_config: StateSizeConfig): JSONSchema {
  return {
    type: 'object',
    properties: {
      flat: {
        type: 'object',
        additionalProperties: { type: 'number' },
      },
      nested: {
        type: 'object',
        additionalProperties: true,
      },
      items: {
        type: 'array',
        items: { type: 'number' },
      },
      counter: { type: 'number' },
    },
  };
}

/**
 * Generate a simple schema for basic benchmarks.
 */
export function generateSimpleSchema(): JSONSchema {
  return {
    type: 'object',
    properties: {
      counter: { type: 'number' },
      data: {
        type: 'object',
        additionalProperties: true,
      },
      items: {
        type: 'array',
        items: { type: 'number' },
      },
    },
  };
}

/**
 * Generate simple state for basic benchmarks.
 */
export function generateSimpleState(): object {
  return {
    counter: 0,
    data: generateFlatObject(100),
    items: generateArray(100),
  };
}

/**
 * Generate a ~200KB nested object.
 *
 * Structure: 3 levels deep, with string padding to reach target size.
 * Each leaf level contains 200 fields with 250-char strings = 50KB.
 * With 3 nested levels (level1, level2, level3), total is ~150-200KB.
 */
export function generate200KBObject(depth: number = 3): object {
  if (depth <= 1) {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      obj[`field${i}`] = 'x'.repeat(250); // 200 * 250 = 50KB per leaf
    }
    return obj;
  }
  return {
    level1: generate200KBObject(depth - 1),
    level2: generate200KBObject(depth - 1),
    level3: generate200KBObject(depth - 1),
    meta: { id: Math.random(), timestamp: Date.now() },
  };
}

/**
 * Generate a large nested state with 200 child subobjects.
 *
 * Each child is ~200KB, so total state is ~40MB.
 * Used for testing performance with large nested structures.
 */
export function generateLargeNestedState(): { children: Record<string, object>; counter: number } {
  const children: Record<string, object> = {};
  for (let i = 0; i < 200; i++) {
    children[`child${i}`] = generate200KBObject(3);
  }
  return { children, counter: 0 };
}

/**
 * Schema for the large nested state.
 */
export function generateLargeNestedSchema(): JSONSchema {
  return {
    type: 'object',
    properties: {
      children: {
        type: 'object',
        additionalProperties: true, // Allow any nested structure
      },
      counter: { type: 'number' },
    },
  };
}
