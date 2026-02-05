/**
 * Benchmark: Client Scaling
 *
 * Measures how notify() performance changes with multiple subscribed clients.
 * Tests fanout to 1, 5, 10, and 50 clients.
 */

import { Service, Client } from '../../src/index.ts';
import { delay, waitFor } from '../../src/helpers.ts';
import { createDescriptorAsync } from '../../test/helpers.ts';
import type { Descriptor, SharedObjectEndpoint } from '../../src/types.ts';
import { Timer, MetricsCollector, tryGC } from '../utils/metrics.ts';
import { generateSimpleSchema, generateSimpleState } from '../utils/data-generators.ts';
import type { BenchmarkResult } from '../utils/reporter.ts';
import { progress } from '../utils/reporter.ts';

export interface ClientScalingOptions {
  iterations: number;
  warmup: number;
  clientCounts: number[];
}

const DEFAULT_OPTIONS: ClientScalingOptions = {
  iterations: 50,
  warmup: 5,
  clientCounts: [1, 5, 10, 50],
};

export async function run(options: Partial<ClientScalingOptions> = {}): Promise<BenchmarkResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: BenchmarkResult[] = [];

  progress(`Client scaling benchmark: ${opts.iterations} iterations, warmup: ${opts.warmup}`);

  for (const clientCount of opts.clientCounts) {
    progress(`  Running: ${clientCount} client(s)`);
    tryGC();

    let service: Service | null = null;
    const clients: Client[] = [];

    try {
      const descriptor: Descriptor = await createDescriptorAsync({
        endpoints: [
          {
            name: 'State',
            type: 'SharedObject',
            objectSchema: generateSimpleSchema(),
          } as SharedObjectEndpoint,
        ],
      });

      const initialState = generateSimpleState();

      service = new Service(descriptor, {}, { State: initialState });
      await service.ready();

      // Create and subscribe all clients
      for (let i = 0; i < clientCount; i++) {
        const client = new Client(descriptor);
        client.SO('State').subscribe();
        clients.push(client);
      }

      // Wait for all clients to initialize
      await Promise.all(
        clients.map((c) => waitFor(c.SO('State'), 'init', 10000).catch(() => null))
      );

      // Extra delay to ensure all subscriptions are stable
      await delay(100);

      const collector = new MetricsCollector();
      const timer = new Timer();

      // Warmup
      // Use rawData to avoid proxy overhead when testing manual notify() performance
      for (let i = 0; i < opts.warmup; i++) {
        (service.SO('State').rawData as any).counter = i;
        service.SO('State').notify();
        await delay(20);
      }

      // Measurement
      for (let i = 0; i < opts.iterations; i++) {
        (service.SO('State').rawData as any).counter = opts.warmup + i;

        timer.start();
        service.SO('State').notify();
        timer.stop();

        collector.record('latency', timer.milliseconds);

        if (i % 10 === 9) {
          await delay(10);
        }
      }

      results.push({
        name: `${clientCount} client${clientCount > 1 ? 's' : ''}`,
        iterations: opts.iterations,
        warmup: opts.warmup,
        stats: collector.stats('latency'),
        metadata: { clientCount },
      });
    } finally {
      // Teardown clients
      for (const client of clients) {
        client.SO('State').unsubscribe();
      }
      await delay(50);
      for (const client of clients) {
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
