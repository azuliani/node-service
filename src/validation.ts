/**
 * Validation utilities using TypeBox.
 *
 * Provides schema compilation, validation, and date handling.
 */

import { Type } from 'typebox';
import type { TSchema } from 'typebox';
import { Compile, Validator } from 'typebox/compile';
import * as Format from 'typebox/format';
import * as Value from 'typebox/value';
import copy from 'fast-copy';
import { ValidationError } from './errors.ts';
import type { JSONSchema } from './types.ts';

// Register date format handlers that accept both Date objects and ISO strings.
// This allows validation without serializeDates() preprocessing.
Format.Set('date', (value: unknown) => {
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value === 'string') return !isNaN(Date.parse(value));
  return false;
});

Format.Set('date-time', (value: unknown) => {
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value === 'string') return !isNaN(Date.parse(value));
  return false;
});

/**
 * Compiled validator for a schema.
 */
export interface CompiledValidator<T = any> {
  /** Check if value is valid */
  check: (value: unknown) => value is T;
  /** Validate and throw on error */
  validate: (value: unknown) => T;
  /** Validate and parse dates */
  validateAndParseDates: (value: unknown) => T;
  /** Get paths that have date format */
  datePaths: string[][];
  /** Whether this schema has any date fields */
  hasDates: boolean;
}

/**
 * Find all paths in a schema that have date format.
 */
function findDatePaths(schema: JSONSchema, currentPath: string[] = []): string[][] {
  const paths: string[][] = [];

  if (schema.format === 'date' || schema.format === 'date-time') {
    paths.push([...currentPath]);
  }

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      paths.push(...findDatePaths(prop, [...currentPath, key]));
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    // Mark with '*' to indicate dynamic key
    paths.push(...findDatePaths(schema.additionalProperties, [...currentPath, '*']));
  }

  if (schema.items) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((item, index) => {
        paths.push(...findDatePaths(item, [...currentPath, index.toString()]));
      });
    } else {
      // Mark with '#' to indicate array item
      paths.push(...findDatePaths(schema.items, [...currentPath, '#']));
    }
  }

  if (schema.allOf) {
    for (const subSchema of schema.allOf) {
      paths.push(...findDatePaths(subSchema, currentPath));
    }
  }

  if (schema.anyOf) {
    for (const subSchema of schema.anyOf) {
      paths.push(...findDatePaths(subSchema, currentPath));
    }
  }

  if (schema.oneOf) {
    for (const subSchema of schema.oneOf) {
      paths.push(...findDatePaths(subSchema, currentPath));
    }
  }

  return paths;
}

/**
 * Convert ISO date strings to Date objects at specified paths.
 */
function parseDatesAtPaths(value: any, datePaths: string[][]): any {
  if (datePaths.length === 0 || value === null || value === undefined) {
    return value;
  }

  // Deep clone to avoid mutating input
  const result = copy(value);

  for (const path of datePaths) {
    parseDateAtPath(result, path, 0);
  }

  return result;
}

/**
 * Recursively parse dates at a specific path.
 */
function parseDateAtPath(obj: any, path: string[], index: number): void {
  if (obj === null || obj === undefined || index >= path.length) {
    return;
  }

  const segment = path[index];

  if (segment === undefined) {
    return;
  }

  if (index === path.length - 1) {
    // Last segment - convert the value
    if (segment === '*') {
      // Dynamic keys - convert all values
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'string') {
          obj[key] = new Date(obj[key]);
        }
      }
    } else if (segment === '#') {
      // Array items - convert all elements
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          if (typeof obj[i] === 'string') {
            obj[i] = new Date(obj[i]);
          }
        }
      }
    } else {
      // Regular key
      if (typeof obj[segment] === 'string') {
        obj[segment] = new Date(obj[segment]);
      }
    }
  } else {
    // Intermediate segment - recurse
    if (segment === '*') {
      // Dynamic keys - recurse into all values
      for (const key of Object.keys(obj)) {
        parseDateAtPath(obj[key], path, index + 1);
      }
    } else if (segment === '#') {
      // Array items - recurse into all elements
      if (Array.isArray(obj)) {
        for (const item of obj) {
          parseDateAtPath(item, path, index + 1);
        }
      }
    } else {
      // Regular key
      parseDateAtPath(obj[segment], path, index + 1);
    }
  }
}

/**
 * TypeBox localized validation error type.
 */
interface LocalizedValidationError {
  keyword: string;
  schemaPath: string;
  instancePath: string;
  params: object;
  message: string;
}

/**
 * Format validation errors for display.
 */
function formatErrors(errors: LocalizedValidationError[]): string {
  if (errors.length === 0) {
    return 'Unknown validation error';
  }
  return errors.map((e) => `${e.instancePath || '/'}: ${e.message}`).join('; ');
}

/**
 * Compile a JSON Schema into a validator.
 */
export function compileSchema<T = any>(schema: JSONSchema): CompiledValidator<T> {
  // Convert JSON Schema to TypeBox schema
  // TypeBox can work with plain JSON Schema objects
  const tbSchema = schema as TSchema;

  // Compile the schema
  const compiled = Compile(tbSchema);
  const datePaths = findDatePaths(schema);

  const hasDates = datePaths.length > 0;

  return {
    check: (value: unknown): value is T => {
      return compiled.Check(value);
    },

    validate: (value: unknown): T => {
      if (!compiled.Check(value)) {
        const errors = compiled.Errors(value);
        throw new ValidationError(formatErrors(errors));
      }
      return value as T;
    },

    validateAndParseDates: (value: unknown): T => {
      if (!compiled.Check(value)) {
        const errors = compiled.Errors(value);
        throw new ValidationError(formatErrors(errors));
      }
      return parseDatesAtPaths(value, datePaths) as T;
    },

    datePaths,
    hasDates,
  };
}

/**
 * Validate a value against a schema without pre-compilation.
 * Use compileSchema for repeated validation of the same schema.
 */
export function validate<T = any>(schema: JSONSchema, value: unknown): T {
  const validator = compileSchema<T>(schema);
  return validator.validate(value);
}

/**
 * Validate and parse dates in a value.
 */
export function validateAndParseDates<T = any>(schema: JSONSchema, value: unknown): T {
  const validator = compileSchema<T>(schema);
  return validator.validateAndParseDates(value);
}

/**
 * Check if a value matches a schema.
 */
export function isValid(schema: JSONSchema, value: unknown): boolean {
  const validator = compileSchema(schema);
  return validator.check(value);
}

/**
 * Serialize Date objects to ISO strings for transmission.
 */
export function serializeDates(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeDates);
  }

  if (typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = serializeDates(val);
    }
    return result;
  }

  return value;
}

/**
 * Check if a schema represents a primitive type (no nested structure).
 */
export function isPrimitiveSchema(schema: JSONSchema): boolean {
  const type = schema.type;
  return type === 'number' || type === 'string' || type === 'boolean' || type === 'integer';
}

/**
 * Fast validation for primitive values without TypeBox overhead.
 * Throws ValidationError if value doesn't match schema type.
 */
export function validatePrimitive(value: unknown, schema: JSONSchema): void {
  const type = schema.type;

  if (type === 'string') {
    // Accept Date objects for string schemas (serialized before transport)
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new ValidationError(`/: Invalid date value`);
      }
      return;
    }
    if (typeof value !== 'string') {
      throw new ValidationError(`/: Expected string, got ${typeof value}`);
    }
    // Handle format validation for date strings
    if (schema.format === 'date' || schema.format === 'date-time') {
      if (isNaN(Date.parse(value))) {
        throw new ValidationError(`/: Invalid ${schema.format} format`);
      }
    }
    return;
  }

  if (type === 'number') {
    if (typeof value !== 'number') {
      throw new ValidationError(`/: Expected number, got ${typeof value}`);
    }
    return;
  }

  if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new ValidationError(`/: Expected integer, got ${typeof value === 'number' ? 'float' : typeof value}`);
    }
    return;
  }

  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new ValidationError(`/: Expected boolean, got ${typeof value}`);
    }
    return;
  }
}

/**
 * Get the sub-schema at a given path.
 * Returns undefined if path doesn't lead to a valid sub-schema.
 */
export function getSubSchemaAtPath(schema: JSONSchema, path: (string | number)[]): JSONSchema | undefined {
  let current: JSONSchema | undefined = schema;

  for (const segment of path) {
    if (!current) return undefined;

    if (typeof segment === 'number' || !isNaN(Number(segment))) {
      // Array index - use items schema
      if (current.items) {
        if (Array.isArray(current.items)) {
          const idx = typeof segment === 'number' ? segment : parseInt(segment, 10);
          current = current.items[idx];
        } else {
          current = current.items;
        }
      } else {
        return undefined;
      }
    } else {
      // Object property
      if (current.properties && current.properties[segment]) {
        current = current.properties[segment];
      } else if (current.additionalProperties && typeof current.additionalProperties === 'object') {
        current = current.additionalProperties;
      } else {
        return undefined;
      }
    }
  }

  return current;
}

/**
 * Cached info for a sub-schema path.
 */
interface CachedSubSchema {
  schema: JSONSchema;
  isPrimitive: boolean;
  primitiveType?: string;
  dateFormat?: string;
  validator?: CompiledValidator; // Only compiled for non-primitives
}

/**
 * Cache for sub-schema lookups.
 * Key format: JSON.stringify(path)
 */
const subSchemaCache = new WeakMap<JSONSchema, Map<string, CachedSubSchema | null>>();

/**
 * Get cached sub-schema info at a path.
 * Returns null if path doesn't exist, undefined if not yet cached.
 */
function getCachedSubSchema(
  rootSchema: JSONSchema,
  pathKey: string
): CachedSubSchema | null | undefined {
  const cache = subSchemaCache.get(rootSchema);
  if (!cache) return undefined;
  return cache.get(pathKey);
}

/**
 * Cache sub-schema info for a path.
 */
function setCachedSubSchema(
  rootSchema: JSONSchema,
  pathKey: string,
  info: CachedSubSchema | null
): void {
  let cache = subSchemaCache.get(rootSchema);
  if (!cache) {
    cache = new Map();
    subSchemaCache.set(rootSchema, cache);
  }
  cache.set(pathKey, info);
}

/**
 * Get or compute sub-schema info at a path (cached).
 * For primitives, returns lightweight info without TypeBox compilation.
 * For complex types, compiles and caches a TypeBox validator.
 */
export function getSubSchemaInfo(
  rootSchema: JSONSchema,
  path: (string | number)[]
): CachedSubSchema | null {
  const pathKey = path.join('|');

  // Check cache
  const cached = getCachedSubSchema(rootSchema, pathKey);
  if (cached !== undefined) return cached;

  // Get sub-schema
  const subSchema = getSubSchemaAtPath(rootSchema, path);
  if (!subSchema) {
    setCachedSubSchema(rootSchema, pathKey, null);
    return null;
  }

  // Build cached info
  const isPrimitive = isPrimitiveSchema(subSchema);
  const info: CachedSubSchema = {
    schema: subSchema,
    isPrimitive,
  };

  // Only set optional properties if they have values
  if (isPrimitive && typeof subSchema.type === 'string') {
    info.primitiveType = subSchema.type;
  }
  if (subSchema.format) {
    info.dateFormat = subSchema.format;
  }

  // Only compile TypeBox validator for non-primitives
  if (!isPrimitive) {
    info.validator = compileSchema(subSchema);
  }

  setCachedSubSchema(rootSchema, pathKey, info);
  return info;
}

// Re-export TypeBox utilities for advanced usage
export { Type, Value, Compile, Validator };
export type { TSchema };
