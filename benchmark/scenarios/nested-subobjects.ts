/**
 * Benchmark: Large Nested Subobjects
 *
 * Tests performance of replacing whole subobjects in a large parent object.
 * Parent object has 200 child subobjects, each ~200KB (total ~40MB state).
 *
 * Compares two approaches:
 * 1. Small modification inside subobject: data.children[i].level1.level2.value = x
 * 2. Replace whole subobject: data.children[i] = modifiedChild
 */

import { Service, Client } from '../../src/index.ts';
import { delay, waitFor } from '../../src/helpers.ts';
import { createDescriptorAsync } from '../../test/helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../../src/types.ts';
import { Timer, MetricsCollector, tryGC } from '../utils/metrics.ts';
import { generate200KBObject, generateLargeNestedSchema } from '../utils/data-generators.ts';
import type { BenchmarkResult } from '../utils/reporter.ts';
import { progress } from '../utils/reporter.ts';

export interface NestedSubobjectsOptions {
  iterations: number;
  warmup: number;
  childCount: number;
}

const DEFAULT_OPTIONS: NestedSubobjectsOptions = {
  iterations: 20, // Lower iterations due to large state size
  warmup: 3,
  childCount: 50, // Reduced from 200 for practical benchmark runtime
};

export async function run(options: Partial<NestedSubobjectsOptions> = {}): Promise<BenchmarkResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: BenchmarkResult[] = [];

  progress(`Nested subobjects benchmark: ${opts.iterations} iterations, warmup: ${opts.warmup}`);
  progress(`  Child count: ${opts.childCount} (each ~200KB)`);

  let service: Service | null = null;
  let client: Client | null = null;

  try {
    // Setup
    const descriptor: Descriptor = await createDescriptorAsync({
      endpoints: [
        {
          name: 'State',
          type: 'SharedObject',
          objectSchema: generateLargeNestedSchema(),
        } as SharedObjectEndpoint,
      ],
    });

    // Generate initial state with specified number of children
    const children: Record<string, object> = {};
    for (let i = 0; i < opts.childCount; i++) {
      children[`child${i}`] = generate200KBObject(3);
    }
    const initialState = { children, counter: 0 };

    progress(`  Initializing service with ~${(opts.childCount * 200) / 1024}MB state...`);
    service = new Service(descriptor, {}, { State: initialState });
    await service.ready();

    client = new Client(descriptor);
    client.SO('State').subscribe();
    progress('  Waiting for client init...');
    await waitFor(client.SO('State'), 'init', 60000); // Longer timeout for large state

    // Test 1: Small modification inside a subobject (hinted diff)
    progress('  Running: Small nested change (hinted)');
    tryGC();
    {
      const collector = new MetricsCollector();
      const timer = new Timer();

      // Warmup
      for (let i = 0; i < opts.warmup; i++) {
        const childKey = `child${i % opts.childCount}`;
        (service.SO('State').rawData as any).children[childKey].level1.level2.field0 = `warmup${i}`;
        service.SO('State').notify(['children', childKey]);
        await delay(50);
      }

      // Measurement
      for (let i = 0; i < opts.iterations; i++) {
        const childKey = `child${i % opts.childCount}`;

        timer.start();
        (service.SO('State').rawData as any).children[childKey].level1.level2.field0 = `test${i}`;
        service.SO('State').notify(['children', childKey]);
        timer.stop();

        collector.record('latency', timer.milliseconds);
        await delay(20);
      }

      results.push({
        name: 'Small nested change (hinted)',
        iterations: opts.iterations,
        warmup: opts.warmup,
        stats: collector.stats('latency'),
        metadata: { childCount: opts.childCount, approxStateSizeMB: (opts.childCount * 200) / 1024 },
      });
    }

    // Test 2: Replace whole subobject (dirty bypass)
    progress('  Running: Replace subobject (dirty bypass)');
    tryGC();
    {
      const collector = new MetricsCollector();
      const timer = new Timer();

      // Warmup
      for (let i = 0; i < opts.warmup; i++) {
        const childKey = `child${i % opts.childCount}`;
        const newChild = generate200KBObject(3);
        (newChild as any).meta.id = `warmup${i}`;
        (service.SO('State').rawData as any).children[childKey] = newChild;
        service.SO('State').notify(['children', childKey], true);
        await delay(50);
      }

      // Measurement
      for (let i = 0; i < opts.iterations; i++) {
        const childKey = `child${i % opts.childCount}`;

        timer.start();
        const newChild = generate200KBObject(3);
        (newChild as any).meta.id = `test${i}`;
        (service.SO('State').rawData as any).children[childKey] = newChild;
        service.SO('State').notify(['children', childKey], true);
        timer.stop();

        collector.record('latency', timer.milliseconds);
        await delay(20);
      }

      results.push({
        name: 'Replace subobject (dirty bypass)',
        iterations: opts.iterations,
        warmup: opts.warmup,
        stats: collector.stats('latency'),
        metadata: { childCount: opts.childCount, approxStateSizeMB: (opts.childCount * 200) / 1024 },
      });
    }

    // Test 3: Replace whole subobject (with diff)
    progress('  Running: Replace subobject (with diff)');
    tryGC();
    {
      const collector = new MetricsCollector();
      const timer = new Timer();

      // Warmup
      for (let i = 0; i < opts.warmup; i++) {
        const childKey = `child${i % opts.childCount}`;
        const newChild = generate200KBObject(3);
        (newChild as any).meta.id = `warmup${i}`;
        (service.SO('State').rawData as any).children[childKey] = newChild;
        service.SO('State').notify(['children', childKey]);
        await delay(50);
      }

      // Measurement
      for (let i = 0; i < opts.iterations; i++) {
        const childKey = `child${i % opts.childCount}`;

        timer.start();
        const newChild = generate200KBObject(3);
        (newChild as any).meta.id = `test${i}`;
        (service.SO('State').rawData as any).children[childKey] = newChild;
        service.SO('State').notify(['children', childKey]);
        timer.stop();

        collector.record('latency', timer.milliseconds);
        await delay(20);
      }

      results.push({
        name: 'Replace subobject (with diff)',
        iterations: opts.iterations,
        warmup: opts.warmup,
        stats: collector.stats('latency'),
        metadata: { childCount: opts.childCount, approxStateSizeMB: (opts.childCount * 200) / 1024 },
      });
    }
  } finally {
    // Teardown
    if (client) {
      client.SO('State').unsubscribe();
      await delay(50);
      client.close();
    }
    if (service) {
      await service.close();
    }
    await delay(50);
  }

  return results;
}
