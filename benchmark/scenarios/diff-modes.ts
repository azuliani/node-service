/**
 * Benchmark: Diff Mode Comparison
 *
 * Compares notify() performance across different diff modes:
 * - Full diff: No hint, compares entire state
 * - Hinted diff: notify(['path']) - only compares subtree
 * - Dirty bypass: notify(['path'], true) - skips diff entirely
 */

import { Service, Client } from '../../src/index.ts';
import { delay, waitFor } from '../../src/helpers.ts';
import { createDescriptorAsync } from '../../test/helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../../src/types.ts';
import { Timer, MetricsCollector, tryGC } from '../utils/metrics.ts';
import { generateFlatObject } from '../utils/data-generators.ts';
import type { BenchmarkResult } from '../utils/reporter.ts';
import { progress } from '../utils/reporter.ts';

export interface DiffModesOptions {
  iterations: number;
  warmup: number;
  stateSize: number;
}

const DEFAULT_OPTIONS: DiffModesOptions = {
  iterations: 100,
  warmup: 10,
  stateSize: 1000,
};

export async function run(options: Partial<DiffModesOptions> = {}): Promise<BenchmarkResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: BenchmarkResult[] = [];

  progress(`Diff modes benchmark: ${opts.iterations} iterations, warmup: ${opts.warmup}`);

  let service: Service | null = null;
  let client: Client | null = null;

  try {
    // Setup
    const descriptor: Descriptor = await createDescriptorAsync({
      endpoints: [
        {
          name: 'State',
          type: 'SharedObject',
          objectSchema: {
            type: 'object',
            properties: {
              target: { type: 'number' },
              data: {
                type: 'object',
                additionalProperties: { type: 'number' },
              },
            },
          },
        } as SharedObjectEndpoint,
      ],
    });

    const initialState = {
      target: 0,
      data: generateFlatObject(opts.stateSize),
    };

    service = new Service(descriptor, {}, { State: initialState });
    await service.ready();

    client = new Client(descriptor);
    client.SO('State').subscribe();
    await waitFor(client.SO('State'), 'init', 5000);

    // Benchmark functions
    // Use rawData to avoid proxy overhead when testing manual notify() performance
    const benchmarks = [
      {
        name: 'Full diff',
        run: () => {
          (service!.SO('State').rawData as any).target++;
          service!.SO('State').notify();
        },
      },
      {
        name: 'Hinted diff',
        run: () => {
          (service!.SO('State').rawData as any).target++;
          service!.SO('State').notify(['target']);
        },
      },
      {
        name: 'Dirty bypass',
        run: () => {
          (service!.SO('State').rawData as any).target++;
          service!.SO('State').notify(['target'], true);
        },
      },
    ];

    for (const bench of benchmarks) {
      progress(`  Running: ${bench.name}`);
      tryGC();

      const collector = new MetricsCollector();
      const timer = new Timer();

      // Warmup
      for (let i = 0; i < opts.warmup; i++) {
        bench.run();
        await delay(5);
      }

      // Measurement
      for (let i = 0; i < opts.iterations; i++) {
        timer.start();
        bench.run();
        timer.stop();
        collector.record('latency', timer.milliseconds);
        // Small delay to avoid overwhelming the socket
        if (i % 10 === 9) {
          await delay(1);
        }
      }

      results.push({
        name: bench.name,
        iterations: opts.iterations,
        warmup: opts.warmup,
        stats: collector.stats('latency'),
        metadata: { stateSize: opts.stateSize },
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
