/**
 * Tests for error utility functions and constants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ErrorCode,
  hasErrorCode,
  getErrorCode,
  ValidationError,
  TimeoutError,
  ConnectionError,
  DescriptorMismatchError,
  MissingHandlerError,
  UnknownEndpointError,
} from '../src/errors.ts';

describe('Error Utilities', () => {
  describe('ErrorCode constants', () => {
    it('should have all expected error code keys', () => {
      const expectedKeys = [
        'VALIDATION_FAILED',
        'TIMEOUT',
        'CONNECTION_FAILED',
        'DESCRIPTOR_MISMATCH',
        'MISSING_HANDLER',
        'UNKNOWN_ENDPOINT',
      ];
      const actualKeys = Object.keys(ErrorCode);
      assert.deepStrictEqual(actualKeys.sort(), expectedKeys.sort());
    });

    it('should have string values matching their keys', () => {
      assert.strictEqual(ErrorCode.VALIDATION_FAILED, 'VALIDATION_FAILED');
      assert.strictEqual(ErrorCode.TIMEOUT, 'TIMEOUT');
      assert.strictEqual(ErrorCode.CONNECTION_FAILED, 'CONNECTION_FAILED');
      assert.strictEqual(ErrorCode.DESCRIPTOR_MISMATCH, 'DESCRIPTOR_MISMATCH');
      assert.strictEqual(ErrorCode.MISSING_HANDLER, 'MISSING_HANDLER');
      assert.strictEqual(ErrorCode.UNKNOWN_ENDPOINT, 'UNKNOWN_ENDPOINT');
    });
  });

  describe('hasErrorCode', () => {
    it('should return true for errors with a code property', () => {
      const err = new ValidationError('test');
      assert.strictEqual(hasErrorCode(err), true);
    });

    it('should return true for each error class', () => {
      assert.strictEqual(hasErrorCode(new TimeoutError()), true);
      assert.strictEqual(hasErrorCode(new ConnectionError()), true);
      assert.strictEqual(hasErrorCode(new DescriptorMismatchError()), true);
      assert.strictEqual(hasErrorCode(new MissingHandlerError('ep')), true);
      assert.strictEqual(hasErrorCode(new UnknownEndpointError('ep')), true);
    });

    it('should return false for plain errors without code', () => {
      const err = new Error('plain error');
      assert.strictEqual(hasErrorCode(err), false);
    });

    it('should return false for non-error values', () => {
      assert.strictEqual(hasErrorCode('string'), false);
      assert.strictEqual(hasErrorCode(42), false);
      assert.strictEqual(hasErrorCode(null), false);
      assert.strictEqual(hasErrorCode(undefined), false);
      assert.strictEqual(hasErrorCode({ code: 'FAKE' }), false);
    });

    it('should return true for errors with a manually added code', () => {
      const err = new Error('custom') as Error & { code: string };
      (err as any).code = 'CUSTOM_CODE';
      assert.strictEqual(hasErrorCode(err), true);
    });
  });

  describe('getErrorCode', () => {
    it('should return the code string for coded errors', () => {
      assert.strictEqual(getErrorCode(new ValidationError('x')), 'VALIDATION_FAILED');
      assert.strictEqual(getErrorCode(new TimeoutError()), 'TIMEOUT');
      assert.strictEqual(getErrorCode(new ConnectionError()), 'CONNECTION_FAILED');
      assert.strictEqual(getErrorCode(new DescriptorMismatchError()), 'DESCRIPTOR_MISMATCH');
      assert.strictEqual(getErrorCode(new MissingHandlerError('ep')), 'MISSING_HANDLER');
      assert.strictEqual(getErrorCode(new UnknownEndpointError('ep')), 'UNKNOWN_ENDPOINT');
    });

    it('should return undefined for plain errors', () => {
      assert.strictEqual(getErrorCode(new Error('plain')), undefined);
    });

    it('should return undefined for non-error values', () => {
      assert.strictEqual(getErrorCode('string'), undefined);
      assert.strictEqual(getErrorCode(42), undefined);
      assert.strictEqual(getErrorCode(null), undefined);
      assert.strictEqual(getErrorCode(undefined), undefined);
      assert.strictEqual(getErrorCode({ code: 'NOT_AN_ERROR' }), undefined);
    });
  });
});
