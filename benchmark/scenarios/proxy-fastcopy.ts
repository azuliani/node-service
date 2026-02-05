/**
 * Benchmark: Proxy Fast-Copy Performance
 *
 * Measures the performance of fast-copy on proxied SharedObject data
 * (with JSON as baseline comparison).
 * Compares proxied vs raw object performance.
 *
 * NOTE: structuredClone() cannot clone Proxy objects (throws DataCloneError).
 */

import copy from 'fast-copy';
import { createReadOnlyProxy, createWriteProxy } from '../../src/proxy.ts';
import { Timer, MetricsCollector, tryGC } from '../utils/metrics.ts';
import type { BenchmarkResult } from '../utils/reporter.ts';
import { progress } from '../utils/reporter.ts';

/**
 * State size configurations for benchmarking.
 */
const STATE_CONFIGS = {
  small: {
    name: 'Small (50 props)',
    properties: 50,
    depth: 2,
    arraySize: 10,
  },
  medium: {
    name: 'Medium (200 props)',
    properties: 200,
    depth: 3,
    arraySize: 20,
  },
  large: {
    name: 'Large (1000 props)',
    properties: 1000,
    depth: 4,
    arraySize: 50,
  },
} as const;

type StateSizeName = keyof typeof STATE_CONFIGS;

/**
 * Copy method implementations.
 */
const COPY_METHODS = {
  'fast-copy': <T>(obj: T): T => copy(obj),
  'JSON.parse/stringify': <T>(obj: T): T => JSON.parse(JSON.stringify(obj)),
} as const;

type CopyMethodName = keyof typeof COPY_METHODS;

export interface ProxyFastCopyOptions {
  iterations: number;
  warmup: number;
  sizes: StateSizeName[];
  methods: CopyMethodName[];
}

const DEFAULT_OPTIONS: ProxyFastCopyOptions = {
  iterations: 100,
  warmup: 10,
  sizes: ['small', 'medium', 'large'],
  methods: ['fast-copy', 'JSON.parse/stringify'],
};

/**
 * Generate test state data.
 */
function generateState(config: (typeof STATE_CONFIGS)[StateSizeName]): Record<string, unknown> {
  const state: Record<string, unknown> = {};

  // Add scalar properties
  const scalarCount = Math.floor(config.properties * 0.4);
  for (let i = 0; i < scalarCount; i++) {
    const type = i % 3;
    if (type === 0) state[`str_${i}`] = `value_${i}`;
    else if (type === 1) state[`num_${i}`] = i * 1.5;
    else state[`bool_${i}`] = i % 2 === 0;
  }

  // Add date properties
  const dateCount = Math.floor(config.properties * 0.1);
  for (let i = 0; i < dateCount; i++) {
    state[`date_${i}`] = new Date(Date.now() - i * 86400000);
  }

  // Add nested objects
  const nestedCount = Math.floor(config.properties * 0.2);
  for (let i = 0; i < nestedCount / 10; i++) {
    let current: Record<string, unknown> = {};
    state[`nested_${i}`] = current;

    for (let d = 0; d < config.depth; d++) {
      const next: Record<string, unknown> = {};
      for (let j = 0; j < 5; j++) {
        current[`prop_${j}`] = j % 2 === 0 ? `nested_${d}_${j}` : d * 10 + j;
      }
      current.child = next;
      current = next;
    }
    current.value = `leaf_${i}`;
  }

  // Add arrays
  const arrayCount = Math.floor(config.properties * 0.3) / config.arraySize;
  for (let i = 0; i < arrayCount; i++) {
    state[`array_${i}`] = Array.from({ length: config.arraySize }, (_, j) => ({
      id: j,
      name: `item_${i}_${j}`,
      value: j * 2.5,
      active: j % 2 === 0,
    }));
  }

  return state;
}

/**
 * Run benchmark for a specific configuration.
 */
async function benchmarkConfig(
  sizeName: StateSizeName,
  methodName: CopyMethodName,
  proxyType: 'raw' | 'readOnly' | 'write',
  options: ProxyFastCopyOptions
): Promise<{ name: string; stats: ReturnType<MetricsCollector['stats']> }> {
  const config = STATE_CONFIGS[sizeName];
  const copyFn = COPY_METHODS[methodName];
  const collector = new MetricsCollector();
  const timer = new Timer();

  // Generate fresh state for each benchmark
  const rawState = generateState(config);

  // Create proxied version if needed
  let testState: Record<string, unknown>;
  const mutations: (string | number)[][] = [];

  if (proxyType === 'raw') {
    testState = rawState;
  } else if (proxyType === 'readOnly') {
    testState = createReadOnlyProxy(rawState);
  } else {
    testState = createWriteProxy(rawState, (path) => mutations.push(path));
  }

  // Access some nested properties to "warm up" the proxy cache
  if (proxyType !== 'raw') {
    const keys = Object.keys(testState);
    for (const key of keys.slice(0, 20)) {
      const val = testState[key];
      if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
        const nested = val as Record<string, unknown>;
        if (nested.child) {
          const _ = (nested.child as Record<string, unknown>).prop_0;
        }
      }
    }
  }

  // Warmup
  for (let i = 0; i < options.warmup; i++) {
    copyFn(testState);
  }

  // Measurement
  for (let i = 0; i < options.iterations; i++) {
    timer.start();
    copyFn(testState);
    timer.stop();
    collector.record('latency', timer.milliseconds);
  }

  const proxyLabel = proxyType === 'raw' ? 'Raw' : proxyType === 'readOnly' ? 'ReadOnly' : 'Write';
  return {
    name: `${config.name} | ${methodName} | ${proxyLabel}`,
    stats: collector.stats('latency'),
  };
}

/**
 * Run the complete benchmark suite.
 */
export async function run(options: Partial<ProxyFastCopyOptions> = {}): Promise<BenchmarkResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: BenchmarkResult[] = [];

  progress(`Proxy fast-copy benchmark: ${opts.iterations} iterations, warmup: ${opts.warmup}`);

  for (const sizeName of opts.sizes) {
    const config = STATE_CONFIGS[sizeName];
    progress(`\n  Size: ${config.name}`);
    tryGC();

    for (const methodName of opts.methods) {
      progress(`    Method: ${methodName}`);

      // Benchmark raw (baseline)
      const rawResult = await benchmarkConfig(sizeName, methodName, 'raw', opts);
      results.push({
        name: rawResult.name,
        iterations: opts.iterations,
        warmup: opts.warmup,
        stats: rawResult.stats,
        metadata: {
          size: sizeName,
          method: methodName,
          proxyType: 'raw',
          properties: config.properties,
        },
      });

      tryGC();

      // Benchmark readOnly proxy
      const readOnlyResult = await benchmarkConfig(sizeName, methodName, 'readOnly', opts);
      results.push({
        name: readOnlyResult.name,
        iterations: opts.iterations,
        warmup: opts.warmup,
        stats: readOnlyResult.stats,
        metadata: {
          size: sizeName,
          method: methodName,
          proxyType: 'readOnly',
          properties: config.properties,
        },
      });

      tryGC();

      // Benchmark write proxy
      const writeResult = await benchmarkConfig(sizeName, methodName, 'write', opts);
      results.push({
        name: writeResult.name,
        iterations: opts.iterations,
        warmup: opts.warmup,
        stats: writeResult.stats,
        metadata: {
          size: sizeName,
          method: methodName,
          proxyType: 'write',
          properties: config.properties,
        },
      });

      // Calculate overhead
      const rawMean = rawResult.stats.mean;
      const readOnlyMean = readOnlyResult.stats.mean;
      const writeMean = writeResult.stats.mean;

      if (rawMean > 0) {
        const readOnlyOverhead = ((readOnlyMean - rawMean) / rawMean) * 100;
        const writeOverhead = ((writeMean - rawMean) / rawMean) * 100;
        progress(
          `      Raw: ${rawMean.toFixed(3)}ms | ReadOnly: ${readOnlyMean.toFixed(3)}ms (+${readOnlyOverhead.toFixed(1)}%) | Write: ${writeMean.toFixed(3)}ms (+${writeOverhead.toFixed(1)}%)`
        );
      }

      tryGC();
    }
  }

  return results;
}

/**
 * Quick benchmark for CI/testing - fewer iterations, smaller sizes.
 */
export async function runQuick(): Promise<BenchmarkResult[]> {
  return run({
    iterations: 20,
    warmup: 5,
    sizes: ['small', 'medium'],
    methods: ['fast-copy'],
  });
}
