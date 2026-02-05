/**
 * Benchmark: Init Latency
 *
 * Measures time from subscribe() to 'init' event across different state sizes.
 * Tests cold-start timing for SharedObject initialization.
 */

import { Service, Client } from '../../src/index.ts';
import { delay, waitFor } from '../../src/helpers.ts';
import { createDescriptorAsync } from '../../test/helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../../src/types.ts';
import { Timer, MetricsCollector, tryGC } from '../utils/metrics.ts';
import { STATE_SIZES, generateState, generateSchema } from '../utils/data-generators.ts';
import type { BenchmarkResult } from '../utils/reporter.ts';
import { progress } from '../utils/reporter.ts';

export interface InitLatencyOptions {
  iterations: number;
  warmup: number;
  sizes: string[];
}

const DEFAULT_OPTIONS: InitLatencyOptions = {
  iterations: 20,
  warmup: 2,
  sizes: ['small', 'medium', 'large'],
};

export async function run(options: Partial<InitLatencyOptions> = {}): Promise<BenchmarkResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: BenchmarkResult[] = [];

  progress(`Init latency benchmark: ${opts.iterations} iterations, warmup: ${opts.warmup}`);

  for (const sizeName of opts.sizes) {
    const config = STATE_SIZES[sizeName];
    if (!config) {
      progress(`  Skipping unknown size: ${sizeName}`);
      continue;
    }

    progress(`  Running: ${config.name} (${config.properties} props)`);

    // For init latency, we create fresh service/client pairs each iteration
    // to measure true cold-start time
    const collector = new MetricsCollector();
    const timer = new Timer();

    // Warmup iterations (not measured)
    for (let i = 0; i < opts.warmup; i++) {
      tryGC();

      const descriptor: Descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'State',
            type: 'SharedObject',
            objectSchema: generateSchema(config),
          } as SharedObjectEndpoint,
        ],
      });

      const service = new Service(descriptor, {}, { State: generateState(config) });
      await service.ready();

      const client = new Client(descriptor);
      client.SO('State').subscribe();
      await waitFor(client.SO('State'), 'init', 10000);

      client.SO('State').unsubscribe();
      await delay(50);
      client.close();
      await service.close();
      await delay(50);
    }

    // Measured iterations
    for (let i = 0; i < opts.iterations; i++) {
      tryGC();

      const descriptor: Descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'State',
            type: 'SharedObject',
            objectSchema: generateSchema(config),
          } as SharedObjectEndpoint,
        ],
      });

      const service = new Service(descriptor, {}, { State: generateState(config) });
      await service.ready();

      const client = new Client(descriptor);

      // Measure time from subscribe to init
      timer.start();
      client.SO('State').subscribe();
      await waitFor(client.SO('State'), 'init', 10000);
      timer.stop();

      collector.record('latency', timer.milliseconds);

      // Cleanup
      client.SO('State').unsubscribe();
      await delay(50);
      client.close();
      await service.close();
      await delay(50);
    }

    results.push({
      name: config.name,
      iterations: opts.iterations,
      warmup: opts.warmup,
      stats: collector.stats('latency'),
      metadata: {
        properties: config.properties,
        depth: config.depth,
        arraySize: config.arraySize,
      },
    });
  }

  return results;
}
