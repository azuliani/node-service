/**
 * Server-side SharedObject endpoint implementation.
 *
 * Maintains synchronized state between server and clients using deltas.
 */

import createDebug from 'debug';
import { diff as computeDelta, apply as applyDelta } from '@azuliani/tree-diff';
import copy from 'fast-copy';
import {
  compileSchema,
  serializeDates,
  getSubSchemaInfo,
  validatePrimitive,
} from '../../validation.ts';
import { ValidationError } from '../../errors.ts';
import { createWriteProxy, PathTree } from '../../proxy.ts';
import type { CompiledValidator } from '../../validation.ts';
import type { SharedObjectEndpoint as SharedObjectEndpointDef, Diff } from '../../types.ts';
import type { MuxServer } from '../../mux/MuxServer.ts';
import type { SharedObjectInitFrame, SharedObjectUpdateFrame } from '../../wire.ts';

const debug = createDebug('node-service:sharedobject-endpoint');

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isPlainObject(value);
}

function sameContainerKind(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return true;
  if (isPlainObject(a) && isPlainObject(b)) return true;
  return false;
}

/**
 * Get value at path in object.
 */
function getAtPath(obj: any, path: (string | number)[]): any {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Server-side SharedObject endpoint for state synchronization.
 */
export class SharedObjectEndpoint<T extends object = object> {
  private _mux: MuxServer<any>;
  private _name: string;
  private _validator: CompiledValidator;
  private _schema: SharedObjectEndpointDef['objectSchema'];
  private _data: T;
  private _dataProxy: T;
  private _lastSnapshot: T;
  private _version = 0;
  private _autoNotify: boolean;
  private _warnedManualNotify = false;

  // Batching state for auto-detection
  private _pendingPaths = new PathTree();
  private _notifyScheduled = false;

  constructor(mux: MuxServer<any>, endpoint: SharedObjectEndpointDef, initial: T) {
    this._mux = mux;
    this._name = endpoint.name;
    this._schema = endpoint.objectSchema;
    this._validator = compileSchema(endpoint.objectSchema);
    this._data = initial;
    // Validate initial state before exposing it.
    const serializedInitial = this._validator.hasDates ? serializeDates(this._data) : this._data;
    this._validator.validate(serializedInitial);
    this._lastSnapshot = copy(initial);
    this._autoNotify = endpoint.autoNotify !== false; // default true

    // Create write proxy for automatic change detection
    this._dataProxy = createWriteProxy(this._data, (path) => this._recordMutation(path));

    // Register init handler - mux sends init on subscription.
    this._mux.registerSharedObjectEndpoint(this._name, (conn) => this._sendInit(conn));
  }

  /**
   * Send init message to a newly connected client.
   */
  private _sendInit(conn: any): void {
    const initMessage: SharedObjectInitFrame = {
      endpoint: this._name,
      type: 'init',
      data: this._validator.hasDates ? serializeDates(copy(this._data)) : copy(this._data),
      v: this._version,
    };
    this._mux.send(conn, initMessage);
    debug('Sent init to new client for %s (v%d)', this._name, this._version);
  }

  /**
   * The endpoint name.
   */
  get name(): string {
    return this._name;
  }

  /**
   * The current version number.
   */
  get version(): number {
    return this._version;
  }

  /**
   * The current mutable data object (proxied for auto-detection).
   */
  get data(): T {
    return this._dataProxy;
  }

  /**
   * Direct access to the underlying data without proxy overhead.
   *
   * Use this for performance-critical code where you are calling notify()
   * manually and don't need automatic change detection. This avoids the
   * overhead of the proxy's mutation tracking.
   *
   * @example
   * ```typescript
   * // Bypass auto-detection for bulk updates
   * const raw = endpoint.rawData;
   * for (let i = 0; i < 1000; i++) {
   *   raw.items[i].value = i;
   * }
   * endpoint.notify(['items']);
   * ```
   */
  get rawData(): T {
    return this._data;
  }

  /**
   * Notify clients of state changes.
   *
   * @param hint - Optional path to the changed subtree for optimized diff computation.
   *   When provided, only the subtree at this path is validated and diffed, reducing
   *   computation from O(full_state) to O(subtree_size). Example: `['players', 'player1']`
   *
   * @remarks
   * When `autoNotify` is enabled (default), calling `notify()` manually will print a warning.
   *
   * @throws ValidationError if current data doesn't match schema
   */
  notify(hint?: string[]): void {
    if (this._autoNotify && !this._warnedManualNotify) {
      this._warnedManualNotify = true;
      console.warn(
        `[node-service] SharedObject "${this._name}" has autoNotify enabled; calling notify() manually is usually unnecessary. ` +
          `Remove notify() calls or set autoNotify: false for this endpoint.`
      );
    }

    const paths = hint && hint.length > 0
      ? [hint as (string | number)[]]
      : [[] as (string | number)[]];
    this._publishFromPaths(paths);
  }

  /**
   * Record a mutation path for batched notification.
   * No-op when autoNotify is disabled.
   */
  private _recordMutation(path: (string | number)[]): void {
    if (!this._autoNotify) return;
    this._pendingPaths.add(path); // Tree handles subsumption automatically
    this._scheduleNotify();
  }

  /**
   * Schedule a batched notification using setImmediate.
   */
  private _scheduleNotify(): void {
    if (this._notifyScheduled) return;
    this._notifyScheduled = true;
    setImmediate(() => this._processBatchedNotify());
  }

  /**
   * Process all pending mutation paths and send a single notification.
   * Uses path-based diffing for efficiency.
   */
  private _processBatchedNotify(): void {
    this._notifyScheduled = false;
    if (this._pendingPaths.isEmpty()) return;

    // Get merged paths (shortest first) and clear tree.
    const paths = this._pendingPaths.getPaths();
    this._pendingPaths.clear();
    this._publishFromPaths(paths);
  }

  private _publishFromPaths(paths: (string | number)[][]): void {
    const allDelta: Diff = [];
    const snapshotBackup = copy(this._lastSnapshot);

    try {
      for (const path of paths) {
        this._validatePath(path);

        const pathDelta = this._computeDeltaForPath(path);
        if (!pathDelta || pathDelta.length === 0) {
          continue;
        }

        // Keep snapshot in sync incrementally as we process multiple paths.
        applyDelta(this._lastSnapshot as unknown as Record<string, unknown>, pathDelta);
        allDelta.push(...pathDelta);
      }
    } catch (err) {
      this._lastSnapshot = snapshotBackup;
      throw err;
    }

    if (allDelta.length === 0) {
      debug('No changes detected for %s', this._name);
      return;
    }

    this._version++;
    debug('Broadcasting delta (%d entries) for %s (v%d)', allDelta.length, this._name, this._version);

    const update: SharedObjectUpdateFrame = {
      endpoint: this._name,
      type: 'update',
      delta: allDelta,
      v: this._version,
      now: new Date().toISOString(),
    };
    this._mux.broadcast(this._name, update);
  }

  private _validatePath(path: (string | number)[]): void {
    if (path.length === 0) {
      // Root change: full-schema validation.
      const serialized = this._validator.hasDates ? serializeDates(this._data) : this._data;
      this._validator.validate(serialized);
      return;
    }

    const currentValue = getAtPath(this._data, path);
    if (currentValue === undefined) {
      // Deletion is represented as undefined at the hinted path.
      return;
    }

    const subSchemaInfo = getSubSchemaInfo(this._schema, path);
    if (!subSchemaInfo) return;

    // Date format fields accept Date objects or parseable strings.
    if (subSchemaInfo.dateFormat) {
      if (currentValue instanceof Date) {
        if (isNaN(currentValue.getTime())) {
          throw new ValidationError(`: Invalid ${subSchemaInfo.dateFormat} value`);
        }
      } else if (typeof currentValue === 'string') {
        if (isNaN(Date.parse(currentValue))) {
          throw new ValidationError(`: Invalid ${subSchemaInfo.dateFormat} format`);
        }
      } else {
        throw new ValidationError(`: Expected Date or string for ${subSchemaInfo.dateFormat}`);
      }
      return;
    }

    if (subSchemaInfo.isPrimitive) {
      validatePrimitive(currentValue, subSchemaInfo.schema);
      return;
    }

    if (subSchemaInfo.validator) {
      const valueToValidate = subSchemaInfo.validator.hasDates
        ? serializeDates(currentValue)
        : currentValue;
      subSchemaInfo.validator.validate(valueToValidate);
    }
  }

  private _wrapDeltaAtPath(path: (string | number)[], entries: Diff): Diff {
    if (path.length === 0) return entries;
    // Tree-diff node paths must be non-empty and must point to an existing container.
    return [[path, entries]] as unknown as Diff;
  }

  private _computeDeltaForPath(path: (string | number)[]): Diff | null {
    // Root: diff entire state.
    if (path.length === 0) {
      if (!isContainer(this._lastSnapshot) || !isContainer(this._data) || !sameContainerKind(this._lastSnapshot, this._data)) {
        throw new Error(`[node-service] SharedObject root must be a plain object or array for "${this._name}"`);
      }
      const rootDelta = computeDelta(this._lastSnapshot as unknown, this._data as unknown);
      return rootDelta.length === 0 ? null : (rootDelta as unknown as Diff);
    }

    const oldValue = getAtPath(this._lastSnapshot, path);
    const currentValue = getAtPath(this._data, path);

    // If the changed path points at a container present in both snapshots, compute a nested delta.
    if (isContainer(oldValue) && isContainer(currentValue) && sameContainerKind(oldValue, currentValue)) {
      const subtreeDelta = computeDelta(oldValue, currentValue);
      if (subtreeDelta.length === 0) return null;
      return this._wrapDeltaAtPath(path, subtreeDelta as unknown as Diff);
    }

    const parentPath = path.slice(0, -1);
    const key = path[path.length - 1];

    // Array element changes: diff the entire parent array (tree-diff array patches are tail-strict).
    const oldParent = getAtPath(this._lastSnapshot, parentPath);
    const currentParent = getAtPath(this._data, parentPath);
    if (Array.isArray(oldParent) && Array.isArray(currentParent)) {
      const arrDelta = computeDelta(oldParent, currentParent);
      if (arrDelta.length === 0) return null;
      return this._wrapDeltaAtPath(parentPath, arrDelta as unknown as Diff);
    }

    // Object property changes: diff a 1-key wrapper so we preserve delete vs explicit undefined.
    if (isPlainObject(oldParent) && isPlainObject(currentParent) && typeof key === 'string') {
      const oldHas = Object.prototype.hasOwnProperty.call(oldParent, key);
      const currentHas = Object.prototype.hasOwnProperty.call(currentParent, key);

      const oldWrapper: Record<string, unknown> = oldHas ? { [key]: oldParent[key] } : {};
      const currentWrapper: Record<string, unknown> = currentHas ? { [key]: currentParent[key] } : {};

      const wrapperDelta = computeDelta(oldWrapper, currentWrapper);
      if (wrapperDelta.length === 0) return null;
      return this._wrapDeltaAtPath(parentPath, wrapperDelta as unknown as Diff);
    }

    // Fallback: compute full root delta.
    const fallback = this._computeDeltaForPath([]);
    return fallback;
  }
}
