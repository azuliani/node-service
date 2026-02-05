/**
 * Benchmark: State Size Scaling
 *
 * Measures how notify() performance scales with state size.
 * Tests Small, Medium, Large, and XL state configurations.
 */

import { Service, Client } from '../../src/index.ts';
import { delay, waitFor } from '../../src/helpers.ts';
import { createDescriptorAsync } from '../../test/helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../../src/types.ts';
import { Timer, MetricsCollector, tryGC } from '../utils/metrics.ts';
import { STATE_SIZES, generateState, generateSchema } from '../utils/data-generators.ts';
import type { BenchmarkResult } from '../utils/reporter.ts';
import { progress } from '../utils/reporter.ts';

export interface StateSizesOptions {
  iterations: number;
  warmup: number;
  sizes: string[];
}

const DEFAULT_OPTIONS: StateSizesOptions = {
  iterations: 50,
  warmup: 5,
  sizes: ['small', 'medium', 'large'],
};

export async function run(options: Partial<StateSizesOptions> = {}): Promise<BenchmarkResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: BenchmarkResult[] = [];

  progress(`State sizes benchmark: ${opts.iterations} iterations, warmup: ${opts.warmup}`);

  for (const sizeName of opts.sizes) {
    const config = STATE_SIZES[sizeName];
    if (!config) {
      progress(`  Skipping unknown size: ${sizeName}`);
      continue;
    }

    progress(`  Running: ${config.name} (${config.properties} props, depth ${config.depth})`);
    tryGC();

    let service: Service | null = null;
    let client: Client | null = null;

    try {
      const descriptor: Descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'State',
            type: 'SharedObject',
            objectSchema: generateSchema(config),
          } as SharedObjectEndpoint,
        ],
      });

      const initialState = generateState(config);

      service = new Service(descriptor, {}, { State: initialState });
      await service.ready();

      client = new Client(descriptor);
      client.SO('State').subscribe();
      await waitFor(client.SO('State'), 'init', 10000);

      const collector = new MetricsCollector();
      const timer = new Timer();

      // Warmup
      // Use rawData to avoid proxy overhead when testing manual notify() performance
      for (let i = 0; i < opts.warmup; i++) {
        (service.SO('State').rawData as any).counter = i;
        service.SO('State').notify();
        await delay(10);
      }

      // Measurement - full diff
      for (let i = 0; i < opts.iterations; i++) {
        (service.SO('State').rawData as any).counter = opts.warmup + i;

        timer.start();
        service.SO('State').notify();
        timer.stop();

        collector.record('latency', timer.milliseconds);

        if (i % 10 === 9) {
          await delay(5);
        }
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
    } finally {
      if (client) {
        client.SO('State').unsubscribe();
        await delay(50);
        client.close();
      }
      if (service) {
        await service.close();
      }
      await delay(100);
    }
  }

  return results;
}
