/**
 * Benchmark: Update Frequency / Throughput
 *
 * Measures maximum updates per second the system can sustain.
 * Tests different target rates to find throughput limits.
 *
 * Note: ZeroMQ PUB sockets require a minimum delay between sends to avoid
 * "Socket is busy" errors. This benchmark respects that constraint by using
 * a minimum 1ms interval between updates.
 */

import { Service, Client } from '../../src/index.ts';
import { delay, waitFor } from '../../src/helpers.ts';
import { createDescriptorAsync } from '../../test/helpers.ts';
import type { Descriptor, SharedObjectEndpoint, Diff } from '../../src/types.ts';
import { tryGC } from '../utils/metrics.ts';
import { generateSimpleSchema, generateSimpleState } from '../utils/data-generators.ts';
import type { BenchmarkResult } from '../utils/reporter.ts';
import { progress } from '../utils/reporter.ts';

export interface UpdateFrequencyOptions {
  testDurationMs: number;
  targetRates: number[];
}

const DEFAULT_OPTIONS: UpdateFrequencyOptions = {
  testDurationMs: 2000,
  // Rates are capped by ZMQ socket constraints (~500-1000/sec practical max)
  targetRates: [50, 100, 200, 500],
};

export async function run(
  options: Partial<UpdateFrequencyOptions> = {}
): Promise<BenchmarkResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: BenchmarkResult[] = [];

  progress(`Update frequency benchmark: ${opts.testDurationMs}ms per rate`);

  for (const targetRate of opts.targetRates) {
    progress(`  Testing: ${targetRate} updates/sec`);
    tryGC();

    let service: Service | null = null;
    let client: Client | null = null;

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

      client = new Client(descriptor);

      let updatesReceived = 0;

      client.SO('State').on('update', (_delta: Diff) => {
        updatesReceived++;
      });

      client.SO('State').subscribe();
      await waitFor(client.SO('State'), 'init', 5000);

      // Calculate interval between updates (minimum 1ms to avoid socket busy errors)
      const intervalMs = Math.max(1, Math.floor(1000 / targetRate));
      const totalUpdates = Math.floor((opts.testDurationMs / 1000) * targetRate);

      // Reset counter
      updatesReceived = 0;

      const startTime = Date.now();
      let updatesSent = 0;

      // Send updates at target rate
      while (updatesSent < totalUpdates) {
        (service.SO('State').data as any).counter = updatesSent;
        service.SO('State').notify(['counter'], true); // Use dirty bypass for max speed
        updatesSent++;

        // Wait between sends to avoid socket busy errors
        await delay(intervalMs);
      }

      const endTime = Date.now();
      const actualDuration = endTime - startTime;

      // Wait for remaining updates to arrive
      await delay(300);

      // Calculate metrics
      const actualRate = (updatesSent / actualDuration) * 1000;
      const receiveRate = (updatesReceived / actualDuration) * 1000;
      const lossRate = Math.max(0, ((updatesSent - updatesReceived) / updatesSent) * 100);
      // Average time per update in ms
      const avgTimePerUpdate = actualDuration / updatesSent;

      results.push({
        name: `${targetRate}/sec`,
        iterations: updatesSent,
        warmup: 0,
        stats: {
          count: updatesSent,
          mean: avgTimePerUpdate,
          min: avgTimePerUpdate,
          max: avgTimePerUpdate,
          p50: avgTimePerUpdate,
          p95: avgTimePerUpdate,
          p99: avgTimePerUpdate,
          stddev: 0,
          opsPerSec: actualRate,
        },
        metadata: {
          targetRate,
          actualRate: Math.round(actualRate),
          receiveRate: Math.round(receiveRate),
          updatesReceived,
          updatesSent,
          lossRate: lossRate.toFixed(2) + '%',
          durationMs: actualDuration,
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
