/**
 * Validation system tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  compileSchema,
  validate,
  validateAndParseDates,
  isValid,
  serializeDates,
} from '../src/validation.ts';
import { ValidationError } from '../src/errors.ts';
import type { JSONSchema } from '../src/index.ts';

describe('Validation', () => {
  describe('compileSchema', () => {
    it('should compile a simple schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const validator = compileSchema(schema);
      assert.ok(validator.check({ name: 'Alice', age: 30 }));
      assert.ok(validator.check({ name: 'Bob' }));
      assert.ok(!validator.check({ age: 30 })); // missing required name
      assert.ok(!validator.check('invalid')); // wrong type
    });

    it('should validate arrays', () => {
      const schema: JSONSchema = {
        type: 'array',
        items: { type: 'number' },
      };

      const validator = compileSchema(schema);
      assert.ok(validator.check([1, 2, 3]));
      assert.ok(validator.check([]));
      assert.ok(!validator.check([1, 'two', 3]));
    });

    it('should validate nested objects', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
        },
      };

      const validator = compileSchema(schema);
      assert.ok(validator.check({ user: { name: 'Alice' } }));
      assert.ok(!validator.check({ user: { name: 123 } }));
    });

    it('should validate additionalProperties', () => {
      const schema: JSONSchema = {
        type: 'object',
        additionalProperties: { type: 'number' },
      };

      const validator = compileSchema(schema);
      assert.ok(validator.check({ a: 1, b: 2 }));
      assert.ok(!validator.check({ a: 'one' }));
    });
  });

  describe('validate', () => {
    it('should return the value on success', () => {
      const schema: JSONSchema = { type: 'string' };
      const result = validate(schema, 'hello');
      assert.strictEqual(result, 'hello');
    });

    it('should throw ValidationError on failure', () => {
      const schema: JSONSchema = { type: 'number' };
      assert.throws(
        () => validate(schema, 'not a number'),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('Validation failed!'));
          assert.strictEqual(err.code, 'VALIDATION_FAILED');
          return true;
        }
      );
    });
  });

  describe('Date handling', () => {
    it('should detect date paths in schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          createdAt: { type: 'string', format: 'date' },
          updatedAt: { type: 'string', format: 'date-time' },
          name: { type: 'string' },
        },
      };

      const validator = compileSchema(schema);
      assert.deepStrictEqual(validator.datePaths, [['createdAt'], ['updatedAt']]);
    });

    it('should detect date paths in nested objects', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              lastLogin: { type: 'string', format: 'date-time' },
            },
          },
        },
      };

      const validator = compileSchema(schema);
      assert.deepStrictEqual(validator.datePaths, [['user', 'lastLogin']]);
    });

    it('should detect date paths with additionalProperties', () => {
      const schema: JSONSchema = {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            timestamp: { type: 'string', format: 'date' },
          },
        },
      };

      const validator = compileSchema(schema);
      assert.deepStrictEqual(validator.datePaths, [['*', 'timestamp']]);
    });

    it('should detect date paths in array items', () => {
      const schema: JSONSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
          },
        },
      };

      const validator = compileSchema(schema);
      assert.deepStrictEqual(validator.datePaths, [['#', 'date']]);
    });

    it('should parse dates at simple paths', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          createdAt: { type: 'string', format: 'date' },
          name: { type: 'string' },
        },
      };

      const input = {
        createdAt: '2024-01-15T10:30:00.000Z',
        name: 'Test',
      };

      const result = validateAndParseDates(schema, input);
      assert.ok(result.createdAt instanceof Date);
      assert.strictEqual(result.createdAt.toISOString(), '2024-01-15T10:30:00.000Z');
      assert.strictEqual(result.name, 'Test');
    });

    it('should parse dates in nested objects', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              lastLogin: { type: 'string', format: 'date-time' },
            },
          },
        },
      };

      const input = {
        user: {
          lastLogin: '2024-01-15T10:30:00.000Z',
        },
      };

      const result = validateAndParseDates(schema, input);
      assert.ok(result.user.lastLogin instanceof Date);
    });

    it('should parse dates with additionalProperties', () => {
      const schema: JSONSchema = {
        type: 'object',
        additionalProperties: {
          type: 'string',
          format: 'date',
        },
      };

      const input = {
        date1: '2024-01-15T10:30:00.000Z',
        date2: '2024-02-20T15:45:00.000Z',
      };

      const result = validateAndParseDates(schema, input);
      assert.ok(result.date1 instanceof Date);
      assert.ok(result.date2 instanceof Date);
    });

    it('should parse dates in array items', () => {
      const schema: JSONSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
          },
        },
      };

      const input = [
        { date: '2024-01-15T10:30:00.000Z' },
        { date: '2024-02-20T15:45:00.000Z' },
      ];

      const result = validateAndParseDates(schema, input);
      assert.ok(result[0].date instanceof Date);
      assert.ok(result[1].date instanceof Date);
    });

    it('should not mutate the original input', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          createdAt: { type: 'string', format: 'date' },
        },
      };

      const input = {
        createdAt: '2024-01-15T10:30:00.000Z',
      };

      validateAndParseDates(schema, input);
      assert.strictEqual(typeof input.createdAt, 'string');
    });
  });

  describe('isValid', () => {
    it('should return true for valid values', () => {
      const schema: JSONSchema = { type: 'number' };
      assert.strictEqual(isValid(schema, 42), true);
    });

    it('should return false for invalid values', () => {
      const schema: JSONSchema = { type: 'number' };
      assert.strictEqual(isValid(schema, 'hello'), false);
    });
  });

  describe('serializeDates', () => {
    it('should convert Date objects to ISO strings', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const result = serializeDates(date);
      assert.strictEqual(result, '2024-01-15T10:30:00.000Z');
    });

    it('should handle nested Date objects', () => {
      const input = {
        createdAt: new Date('2024-01-15T10:30:00.000Z'),
        user: {
          lastLogin: new Date('2024-02-20T15:45:00.000Z'),
        },
      };

      const result = serializeDates(input);
      assert.strictEqual(result.createdAt, '2024-01-15T10:30:00.000Z');
      assert.strictEqual(result.user.lastLogin, '2024-02-20T15:45:00.000Z');
    });

    it('should handle arrays with Date objects', () => {
      const input = [
        new Date('2024-01-15T10:30:00.000Z'),
        new Date('2024-02-20T15:45:00.000Z'),
      ];

      const result = serializeDates(input);
      assert.strictEqual(result[0], '2024-01-15T10:30:00.000Z');
      assert.strictEqual(result[1], '2024-02-20T15:45:00.000Z');
    });

    it('should handle null and undefined', () => {
      assert.strictEqual(serializeDates(null), null);
      assert.strictEqual(serializeDates(undefined), undefined);
    });

    it('should pass through primitive values', () => {
      assert.strictEqual(serializeDates(42), 42);
      assert.strictEqual(serializeDates('hello'), 'hello');
      assert.strictEqual(serializeDates(true), true);
    });
  });

  describe('date format validation', () => {
    it('should validate date format strings', () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'date',
      };

      const validator = compileSchema(schema);
      assert.ok(validator.check('2024-01-15T10:30:00.000Z'));
      assert.ok(validator.check('2024-01-15'));
      assert.ok(!validator.check('not a date'));
      assert.ok(!validator.check('2024-99-99'));
    });

    it('should validate date-time format strings', () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'date-time',
      };

      const validator = compileSchema(schema);
      assert.ok(validator.check('2024-01-15T10:30:00.000Z'));
      assert.ok(!validator.check('not a date'));
    });
  });
});

describe('Helpers', () => {
  describe('createDescriptor', async () => {
    const { createDescriptor } = await import('./helpers.ts');

    it('should create descriptor with transport', () => {
      const desc = createDescriptor(5000);
      assert.ok(desc.transport);
      assert.strictEqual(desc.transport.server, '127.0.0.1:5000');
      assert.strictEqual(desc.transport.client, '127.0.0.1:5000');
    });

    it('should create descriptor with default port', () => {
      const desc = createDescriptor(3000);
      assert.ok(desc.transport);
      assert.strictEqual(desc.transport.server, '127.0.0.1:3000');
      assert.strictEqual(desc.transport.client, '127.0.0.1:3000');
    });

    it('should include provided endpoints', () => {
      const endpoints = [
        { name: 'TestRPC', type: 'RPC' as const, requestSchema: {}, replySchema: {} },
      ];
      const desc = createDescriptor(5000, { endpoints });
      assert.strictEqual(desc.endpoints.length, 1);
      assert.strictEqual(desc.endpoints[0]!.name, 'TestRPC');
    });

    it('should use custom hostname', () => {
      const desc = createDescriptor(5000, { hostname: 'localhost' });
      assert.ok(desc.transport.server.includes('localhost'));
    });
  });

  describe('parseHostPort', async () => {
    const { parseHostPort } = await import('../src/helpers.ts');

    it('should parse host and port from simple format', () => {
      const result = parseHostPort('127.0.0.1:5000');
      assert.strictEqual(result.host, '127.0.0.1');
      assert.strictEqual(result.port, 5000);
    });

    it('should parse localhost', () => {
      const result = parseHostPort('localhost:3000');
      assert.strictEqual(result.host, 'localhost');
      assert.strictEqual(result.port, 3000);
    });

    it('should throw on invalid format', () => {
      assert.throws(() => parseHostPort('invalid'), /Invalid URL format/);
    });

    it('should throw on invalid port', () => {
      assert.throws(() => parseHostPort('localhost:abc'), /Invalid port/);
    });
  });

  describe('waitFor', async () => {
    const { waitFor } = await import('../src/helpers.ts');
    const { EventEmitter } = await import('events');

    it('should resolve when event is emitted', async () => {
      const emitter = new EventEmitter();
      const promise = waitFor(emitter, 'test');
      emitter.emit('test', { data: 'value' });
      const result = await promise;
      assert.deepStrictEqual(result, { data: 'value' });
    });

    it('should reject on timeout', async () => {
      const emitter = new EventEmitter();
      await assert.rejects(
        () => waitFor(emitter, 'test', 50),
        /Timeout waiting for event: test/
      );
    });
  });

  describe('delay', async () => {
    const { delay } = await import('../src/helpers.ts');

    it('should delay for specified time', async () => {
      const start = Date.now();
      await delay(50);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 45, `Expected at least 45ms, got ${elapsed}ms`);
    });
  });
});

describe('Error classes', () => {
  it('ValidationError should have correct properties', () => {
    const err = new ValidationError('test error');
    assert.strictEqual(err.name, 'ValidationError');
    assert.strictEqual(err.code, 'VALIDATION_FAILED');
    assert.ok(err.message.includes('Validation failed!'));
    assert.ok(err.message.includes('test error'));
  });

  it('Error toJSON should serialize correctly', () => {
    const err = new ValidationError('test');
    const json = err.toJSON();
    assert.strictEqual(json.name, 'ValidationError');
    assert.strictEqual(json.code, 'VALIDATION_FAILED');
    assert.ok(json.message.includes('test'));
  });
});
