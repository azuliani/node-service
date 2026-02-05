/**
 * Benchmark comparison: OLD vs NEW library
 *
 * Run with: node benchmark/compare-old-new.ts
 */

import { createRequire } from 'module';
import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync } from '../test/helpers.ts';

const require = createRequire(import.meta.url);

// OLD library (CommonJS)
const OldService = require('../../node-service/Service/Service');
const OldClient = require('../../node-service/Client/Client');

// Timer utility
class Timer {
  private _start = 0n;
  private _end = 0n;

  start() { this._start = process.hrtime.bigint(); }
  stop() { this._end = process.hrtime.bigint(); }
  get ms() { return Number(this._end - this._start) / 1_000_000; }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface Stats {
  mean: number;
  p50: number;
  p99: number;
  opsPerSec: number;
}

function calculateStats(values: number[]): Stats {
  if (values.length === 0) return { mean: 0, p50: 0, p99: 0, opsPerSec: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
  const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
  return { mean, p50, p99, opsPerSec: mean > 0 ? 1000 / mean : 0 };
}

function generateFlatObject(size: number): Record<string, number> {
  const obj: Record<string, number> = {};
  for (let i = 0; i < size; i++) {
    obj[`key${i}`] = i;
  }
  return obj;
}

async function benchmarkOld(iterations: number, warmup: number, stateSize: number) {
  const basePort = 19000;

  const descriptor = {
    transports: {
      source: {
        client: `tcp://127.0.0.1:${basePort}`,
        server: `tcp://127.0.0.1:${basePort}`
      },
      rpc: {
        client: `tcp://127.0.0.1:${basePort + 2}`,
        server: `tcp://127.0.0.1:${basePort + 2}`
      }
    },
    endpoints: [{
      name: 'State',
      type: 'SharedObject',
      objectSchema: {
        type: 'object',
        properties: {
          target: { type: 'number' },
          data: {
            type: 'object',
            properties: {
              '*': { type: 'number' }
            }
          }
        }
      }
    }]
  };

  const initialState = {
    target: 0,
    data: generateFlatObject(stateSize)
  };

  const service = new OldService(descriptor, {}, { State: initialState });
  await delay(100);

  const results = {
    fullDiff: [] as number[],
    hintedDiff: [] as number[],
    dirtyBypass: [] as number[]
  };

  const timer = new Timer();

  // Warmup + measure full diff
  for (let i = 0; i < warmup + iterations; i++) {
    service.State.data.target++;
    timer.start();
    service.State.notify();
    timer.stop();
    if (i >= warmup) results.fullDiff.push(timer.ms);
  }

  // Warmup + measure hinted diff
  for (let i = 0; i < warmup + iterations; i++) {
    service.State.data.target++;
    timer.start();
    service.State.notify(['target']);
    timer.stop();
    if (i >= warmup) results.hintedDiff.push(timer.ms);
  }

  // Warmup + measure dirty bypass
  for (let i = 0; i < warmup + iterations; i++) {
    service.State.data.target++;
    timer.start();
    service.State.notify(['target'], true);
    timer.stop();
    if (i >= warmup) results.dirtyBypass.push(timer.ms);
  }

  service.close();
  await delay(100);

  return {
    fullDiff: calculateStats(results.fullDiff),
    hintedDiff: calculateStats(results.hintedDiff),
    dirtyBypass: calculateStats(results.dirtyBypass)
  };
}

interface ClientResults {
  initLatency: Stats;
  endToEndLatency: Stats;
  updateProcessing: Stats;
}

async function benchmarkOldClient(iterations: number, warmup: number, stateSize: number): Promise<ClientResults> {
  const results = {
    initLatency: [] as number[],
    endToEndLatency: [] as number[],
    updateProcessing: [] as number[]
  };

  const timer = new Timer();

  // Measure init latency (multiple iterations with fresh clients)
  // Use unique ports for each iteration to avoid ZMQ port reuse issues
  // ZMQ needs wide spacing due to TIME_WAIT state (use 500 port gap, start at 40000)
  for (let i = 0; i < warmup + iterations; i++) {
    const basePort = 40000 + (i * 500);

    const descriptor = {
      transports: {
        source: {
          client: `tcp://127.0.0.1:${basePort}`,
          server: `tcp://127.0.0.1:${basePort}`
        },
        rpc: {
          client: `tcp://127.0.0.1:${basePort + 2}`,
          server: `tcp://127.0.0.1:${basePort + 2}`
        }
      },
      endpoints: [{
        name: 'State',
        type: 'SharedObject',
        objectSchema: {
          type: 'object',
          properties: {
            target: { type: 'number' },
            data: {
              type: 'object',
              properties: {
                '*': { type: 'number' }
              }
            }
          }
        }
      }]
    };

    const initialState = {
      target: 0,
      data: generateFlatObject(stateSize)
    };

    const service = new OldService(descriptor, {}, { State: { ...initialState } });
    await delay(200);

    const client = new OldClient(descriptor);
    await delay(100);

    timer.start();
    client.State.subscribe();
    await new Promise<void>(resolve => client.State.once('init', () => resolve()));
    timer.stop();

    if (i >= warmup) results.initLatency.push(timer.ms);

    client.State.unsubscribe();
    await delay(200);
    client.close();
    service.close();
    await delay(500);
  }

  // Wait for ZMQ sockets to fully release
  await delay(2000);

  // Measure end-to-end latency with a single service/client
  // Use port far from init test range (40000-45000)
  const basePortE2E = 50000;
  const descriptorE2E = {
    transports: {
      source: {
        client: `tcp://127.0.0.1:${basePortE2E}`,
        server: `tcp://127.0.0.1:${basePortE2E}`
      },
      rpc: {
        client: `tcp://127.0.0.1:${basePortE2E + 2}`,
        server: `tcp://127.0.0.1:${basePortE2E + 2}`
      }
    },
    endpoints: [{
      name: 'State',
      type: 'SharedObject',
      objectSchema: {
        type: 'object',
        properties: {
          target: { type: 'number' },
          data: {
            type: 'object',
            properties: {
              '*': { type: 'number' }
            }
          }
        }
      }
    }]
  };

  const initialStateE2E = {
    target: 0,
    data: generateFlatObject(stateSize)
  };

  const service = new OldService(descriptorE2E, {}, { State: { ...initialStateE2E } });
  await delay(200);

  const client = new OldClient(descriptorE2E);
  await delay(100);

  client.State.subscribe();
  await new Promise<void>(resolve => client.State.once('init', () => resolve()));

  // Track when update arrives
  let notifyTime = 0n;
  let updateReceivedTime = 0n;

  client.State.on('update', () => {
    updateReceivedTime = process.hrtime.bigint();
  });

  // Warmup + measure
  for (let i = 0; i < warmup + iterations; i++) {
    service.State.data.target++;

    notifyTime = process.hrtime.bigint();
    service.State.notify(['target']);

    await new Promise<void>(resolve => {
      const handler = () => {
        client.State.removeListener('update', handler);
        resolve();
      };
      client.State.on('update', handler);
    });

    const endToEnd = Number(updateReceivedTime - notifyTime) / 1_000_000;

    if (i >= warmup) {
      results.endToEndLatency.push(endToEnd);
    }
  }

  client.State.unsubscribe();
  await delay(100);
  client.close();
  service.close();
  await delay(200);

  return {
    initLatency: calculateStats(results.initLatency),
    endToEndLatency: calculateStats(results.endToEndLatency),
    updateProcessing: calculateStats(results.updateProcessing)
  };
}

async function benchmarkNewClient(iterations: number, warmup: number, stateSize: number): Promise<ClientResults> {
  const results = {
    initLatency: [] as number[],
    endToEndLatency: [] as number[],
    updateProcessing: [] as number[]
  };

  const timer = new Timer();

  // Measure init latency (multiple iterations with fresh clients)
  for (let i = 0; i < warmup + iterations; i++) {
    const descriptor = await createDescriptorAsync({
      endpoints: [{
        name: 'State',
        type: 'SharedObject',
        objectSchema: {
          type: 'object',
          properties: {
            target: { type: 'number' },
            data: {
              type: 'object',
              additionalProperties: { type: 'number' }
            }
          }
        }
      }]
    });

    const initialState = {
      target: 0,
      data: generateFlatObject(stateSize)
    };

    const service = new Service(descriptor, {}, { State: { ...initialState } });
    await service.ready();

    const client = new Client(descriptor);
    await delay(50);

    timer.start();
    client.SO('State').subscribe();
    await new Promise<void>(resolve => client.SO('State').once('init', () => resolve()));
    timer.stop();

    if (i >= warmup) results.initLatency.push(timer.ms);

    client.SO('State').unsubscribe();
    await delay(50);
    client.close();
    await service.close();
    await delay(50);
  }

  // Measure end-to-end latency
  const descriptor = await createDescriptorAsync({
    endpoints: [{
      name: 'State',
      type: 'SharedObject',
      objectSchema: {
        type: 'object',
        properties: {
          target: { type: 'number' },
          data: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        }
      }
    }]
  });

  const initialState = {
    target: 0,
    data: generateFlatObject(stateSize)
  };

  const service = new Service(descriptor, {}, { State: { ...initialState } });
  await service.ready();

  const client = new Client(descriptor);
  await delay(50);

  client.SO('State').subscribe();
  await new Promise<void>(resolve => client.SO('State').once('init', () => resolve()));

  // Track when update arrives
  let notifyTime = 0n;
  let updateReceivedTime = 0n;

  client.SO('State').on('update', () => {
    updateReceivedTime = process.hrtime.bigint();
  });

  // Warmup + measure
  for (let i = 0; i < warmup + iterations; i++) {
    service.SO('State').data.target++;

    notifyTime = process.hrtime.bigint();
    service.SO('State').notify(['target']);

    await new Promise<void>(resolve => {
      const handler = () => {
        client.SO('State').removeListener('update', handler);
        resolve();
      };
      client.SO('State').on('update', handler);
    });

    const endToEnd = Number(updateReceivedTime - notifyTime) / 1_000_000;

    if (i >= warmup) {
      results.endToEndLatency.push(endToEnd);
    }
  }

  client.SO('State').unsubscribe();
  await delay(50);
  client.close();
  await service.close();
  await delay(100);

  return {
    initLatency: calculateStats(results.initLatency),
    endToEndLatency: calculateStats(results.endToEndLatency),
    updateProcessing: calculateStats(results.updateProcessing)
  };
}

async function benchmarkNew(iterations: number, warmup: number, stateSize: number) {
  const descriptor = await createDescriptorAsync({
    endpoints: [{
      name: 'State',
      type: 'SharedObject',
      objectSchema: {
        type: 'object',
        properties: {
          target: { type: 'number' },
          data: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        }
      }
    }]
  });

  const initialState = {
    target: 0,
    data: generateFlatObject(stateSize)
  };

  const service = new Service(descriptor, {}, { State: initialState });
  await service.ready();

  const results = {
    fullDiff: [] as number[],
    hintedDiff: [] as number[],
    dirtyBypass: [] as number[]
  };

  const timer = new Timer();

  // Warmup + measure full diff
  for (let i = 0; i < warmup + iterations; i++) {
    service.SO('State').data.target++;
    timer.start();
    service.SO('State').notify();
    timer.stop();
    if (i >= warmup) results.fullDiff.push(timer.ms);
  }

  // Warmup + measure hinted diff
  for (let i = 0; i < warmup + iterations; i++) {
    service.SO('State').data.target++;
    timer.start();
    service.SO('State').notify(['target']);
    timer.stop();
    if (i >= warmup) results.hintedDiff.push(timer.ms);
  }

  // Warmup + measure dirty bypass
  for (let i = 0; i < warmup + iterations; i++) {
    service.SO('State').data.target++;
    timer.start();
    service.SO('State').notify(['target'], true);
    timer.stop();
    if (i >= warmup) results.dirtyBypass.push(timer.ms);
  }

  await service.close();
  await delay(100);

  return {
    fullDiff: calculateStats(results.fullDiff),
    hintedDiff: calculateStats(results.hintedDiff),
    dirtyBypass: calculateStats(results.dirtyBypass)
  };
}

function fmtOps(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toFixed(0);
}

function pad(s: string, w: number, align: 'left' | 'right' = 'left'): string {
  if (s.length >= w) return s;
  const p = ' '.repeat(w - s.length);
  return align === 'left' ? s + p : p + s;
}

async function main() {
  const iterations = 100;
  const warmup = 10;
  const stateSize = 1000;
  const clientIterations = 3;  // Reduced to avoid ZMQ port exhaustion
  const clientWarmup = 1;

  console.log('SharedObject Performance: OLD vs NEW Library');
  console.log('=============================================');
  console.log(`Server iterations: ${iterations} | Warmup: ${warmup} | State size: ${stateSize} keys`);
  console.log(`Client iterations: ${clientIterations} | Warmup: ${clientWarmup}\n`);

  console.log('Running OLD library server benchmark...');
  const oldResults = await benchmarkOld(iterations, warmup, stateSize);

  console.log('Running NEW library server benchmark...');
  const newResults = await benchmarkNew(iterations, warmup, stateSize);

  // Long delay to let ZMQ sockets fully release before client benchmarks
  console.log('Waiting for ZMQ socket cleanup...');
  await delay(3000);

  console.log('Running OLD library client benchmark...');
  const oldClientResults = await benchmarkOldClient(clientIterations, clientWarmup, stateSize);

  // More delay between old and new client benchmarks
  await delay(2000);

  console.log('Running NEW library client benchmark...');
  const newClientResults = await benchmarkNewClient(clientIterations, clientWarmup, stateSize);

  // ============ SERVER-SIDE RESULTS ============
  console.log('\n');
  console.log('=== SERVER-SIDE PERFORMANCE (notify) ===\n');

  // Header
  const header = [
    pad('Mode', 14),
    pad('OLD (ops/s)', 14, 'right'),
    pad('NEW (ops/s)', 14, 'right'),
    pad('Speedup', 10, 'right'),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  // Results
  const modes = [
    { name: 'Full diff', key: 'fullDiff' as const },
    { name: 'Hinted diff', key: 'hintedDiff' as const },
    { name: 'Dirty bypass', key: 'dirtyBypass' as const },
  ];

  for (const mode of modes) {
    const oldOps = oldResults[mode.key].opsPerSec;
    const newOps = newResults[mode.key].opsPerSec;
    const speedup = oldOps > 0 ? (newOps / oldOps).toFixed(1) + 'x' : 'N/A';

    const row = [
      pad(mode.name, 14),
      pad(fmtOps(oldOps) + ' ops/s', 14, 'right'),
      pad(fmtOps(newOps) + ' ops/s', 14, 'right'),
      pad(speedup, 10, 'right'),
    ].join(' | ');
    console.log(row);
  }

  console.log('\n--- Server Latency Details ---\n');

  const latHeader = [
    pad('Mode', 14),
    pad('OLD Mean', 10, 'right'),
    pad('NEW Mean', 10, 'right'),
    pad('OLD P99', 10, 'right'),
    pad('NEW P99', 10, 'right'),
  ].join(' | ');
  console.log(latHeader);
  console.log('-'.repeat(latHeader.length));

  for (const mode of modes) {
    const row = [
      pad(mode.name, 14),
      pad(oldResults[mode.key].mean.toFixed(2) + 'ms', 10, 'right'),
      pad(newResults[mode.key].mean.toFixed(2) + 'ms', 10, 'right'),
      pad(oldResults[mode.key].p99.toFixed(2) + 'ms', 10, 'right'),
      pad(newResults[mode.key].p99.toFixed(2) + 'ms', 10, 'right'),
    ].join(' | ');
    console.log(row);
  }

  // ============ CLIENT-SIDE RESULTS ============
  console.log('\n');
  console.log('=== CLIENT-SIDE PERFORMANCE ===\n');

  const clientHeader = [
    pad('Metric', 18),
    pad('OLD Mean', 12, 'right'),
    pad('NEW Mean', 12, 'right'),
    pad('Improvement', 12, 'right'),
  ].join(' | ');
  console.log(clientHeader);
  console.log('-'.repeat(clientHeader.length));

  // Init latency
  const oldInit = oldClientResults.initLatency.mean;
  const newInit = newClientResults.initLatency.mean;
  const initImprovement = oldInit > 0 ? ((oldInit - newInit) / oldInit * 100).toFixed(0) + '%' : 'N/A';
  console.log([
    pad('Init latency', 18),
    pad(oldInit.toFixed(2) + 'ms', 12, 'right'),
    pad(newInit.toFixed(2) + 'ms', 12, 'right'),
    pad(initImprovement, 12, 'right'),
  ].join(' | '));

  // End-to-end latency
  const oldE2E = oldClientResults.endToEndLatency.mean;
  const newE2E = newClientResults.endToEndLatency.mean;
  const e2eImprovement = oldE2E > 0 ? ((oldE2E - newE2E) / oldE2E * 100).toFixed(0) + '%' : 'N/A';
  console.log([
    pad('End-to-end update', 18),
    pad(oldE2E.toFixed(2) + 'ms', 12, 'right'),
    pad(newE2E.toFixed(2) + 'ms', 12, 'right'),
    pad(e2eImprovement, 12, 'right'),
  ].join(' | '));

  console.log('\n--- Client Latency Details (P99) ---\n');

  const clientP99Header = [
    pad('Metric', 18),
    pad('OLD P99', 12, 'right'),
    pad('NEW P99', 12, 'right'),
  ].join(' | ');
  console.log(clientP99Header);
  console.log('-'.repeat(clientP99Header.length));

  console.log([
    pad('Init latency', 18),
    pad(oldClientResults.initLatency.p99.toFixed(2) + 'ms', 12, 'right'),
    pad(newClientResults.initLatency.p99.toFixed(2) + 'ms', 12, 'right'),
  ].join(' | '));

  console.log([
    pad('End-to-end update', 18),
    pad(oldClientResults.endToEndLatency.p99.toFixed(2) + 'ms', 12, 'right'),
    pad(newClientResults.endToEndLatency.p99.toFixed(2) + 'ms', 12, 'right'),
  ].join(' | '));

  console.log('');
}

main().catch(console.error);
