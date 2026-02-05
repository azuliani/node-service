/**
 * Metrics collection utilities for benchmarking.
 */

/**
 * High-resolution timer using process.hrtime.bigint().
 */
export class Timer {
  private _start: bigint = 0n;
  private _end: bigint = 0n;

  start(): void {
    this._start = process.hrtime.bigint();
  }

  stop(): void {
    this._end = process.hrtime.bigint();
  }

  /** Get elapsed time in nanoseconds. */
  get nanoseconds(): bigint {
    return this._end - this._start;
  }

  /** Get elapsed time in milliseconds. */
  get milliseconds(): number {
    return Number(this._end - this._start) / 1_000_000;
  }

  /** Get elapsed time in microseconds. */
  get microseconds(): number {
    return Number(this._end - this._start) / 1_000;
  }
}

/**
 * Collected statistics from a set of measurements.
 */
export interface Stats {
  count: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  stddev: number;
  /** Throughput: operations per second based on mean latency */
  opsPerSec: number;
}

/**
 * Calculate percentile from sorted array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

/**
 * Calculate statistics from an array of measurements.
 * Values are expected to be in milliseconds.
 */
export function calculateStats(values: number[]): Stats {
  if (values.length === 0) {
    return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, stddev: 0, opsPerSec: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;

  // Calculate standard deviation
  const squaredDiffs = sorted.map((v) => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / sorted.length;
  const stddev = Math.sqrt(avgSquaredDiff);

  // Calculate throughput (ops/sec) from mean latency (ms)
  const opsPerSec = mean > 0 ? 1000 / mean : 0;

  return {
    count: sorted.length,
    mean,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    stddev,
    opsPerSec,
  };
}

/**
 * Collector for recording measurements during a benchmark.
 */
export class MetricsCollector {
  private _measurements: Map<string, number[]> = new Map();

  /**
   * Record a measurement.
   */
  record(name: string, value: number): void {
    let arr = this._measurements.get(name);
    if (!arr) {
      arr = [];
      this._measurements.set(name, arr);
    }
    arr.push(value);
  }

  /**
   * Get all measurements for a metric.
   */
  get(name: string): number[] {
    return this._measurements.get(name) ?? [];
  }

  /**
   * Calculate stats for a metric.
   */
  stats(name: string): Stats {
    return calculateStats(this.get(name));
  }

  /**
   * Get all metric names.
   */
  names(): string[] {
    return Array.from(this._measurements.keys());
  }

  /**
   * Clear all measurements.
   */
  clear(): void {
    this._measurements.clear();
  }
}

/**
 * Try to force garbage collection if --expose-gc flag is set.
 */
export function tryGC(): void {
  if (typeof global.gc === 'function') {
    global.gc();
  }
}
