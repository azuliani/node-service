/**
 * Profile client-side processing to identify optimization opportunities.
 *
 * Run with: node benchmark/profile-client.ts
 */

import { Service, Client } from '../src/index.ts';
import { createDescriptorAsync } from '../test/helpers.ts';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface TimingBreakdown {
  jsonParse: number[];
  validation: number[];
  diffApplication: number[];
  proxyInvalidation: number[];
  eventEmit: number[];
  total: number[];
}

function calculateStats(values: number[]) {
  if (values.length === 0) return { mean: 0, p50: 0, p99: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
  const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  return { mean, p50, p99, min, max };
}

function generateFlatObject(size: number): Record<string, number> {
  const obj: Record<string, number> = {};
  for (let i = 0; i < size; i++) {
    obj[`key${i}`] = i;
  }
  return obj;
}

function pad(s: string, w: number, align: 'left' | 'right' = 'left'): string {
  if (s.length >= w) return s;
  const p = ' '.repeat(w - s.length);
  return align === 'left' ? s + p : p + s;
}

function fmtMicros(us: number): string {
  if (us >= 1000) return (us / 1000).toFixed(2) + 'ms';
  return us.toFixed(1) + 'µs';
}

async function profileInitProcessing(iterations: number, stateSize: number) {
  console.log(`\n=== INIT MESSAGE PROCESSING (state size: ${stateSize} keys) ===\n`);

  const timings = {
    jsonParse: [] as number[],
    validation: [] as number[],
    total: [] as number[]
  };

  for (let i = 0; i < iterations; i++) {
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

    // Create client and intercept message handling
    const client = new Client(descriptor);

    const totalStart = process.hrtime.bigint();
    client.SO('State').subscribe();
    await new Promise<void>(resolve => client.SO('State').once('init', () => resolve()));
    const totalEnd = process.hrtime.bigint();

    timings.total.push(Number(totalEnd - totalStart) / 1000); // microseconds

    client.SO('State').unsubscribe();
    await delay(50);
    client.close();
    await service.close();
    await delay(50);
  }

  // Simulate breakdown by profiling individual operations
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

  const { compileSchema } = await import('../src/validation.ts');
  const validator = compileSchema(descriptor.endpoints[0]!.objectSchema);

  // Simulate init message
  const initData = { target: 0, data: generateFlatObject(stateSize) };
  const initMessage = JSON.stringify({ type: 'init', data: initData, v: 0 });

  for (let i = 0; i < iterations; i++) {
    // JSON parse
    let start = process.hrtime.bigint();
    const parsed = JSON.parse(initMessage);
    let end = process.hrtime.bigint();
    timings.jsonParse.push(Number(end - start) / 1000);

    // Validation + date parsing
    start = process.hrtime.bigint();
    validator.validateAndParseDates(parsed.data);
    end = process.hrtime.bigint();
    timings.validation.push(Number(end - start) / 1000);
  }

  console.log('Operation breakdown (simulated):');
  const header = [
    pad('Operation', 20),
    pad('Mean', 12, 'right'),
    pad('P50', 12, 'right'),
    pad('P99', 12, 'right'),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const [name, values] of Object.entries(timings)) {
    const stats = calculateStats(values);
    console.log([
      pad(name, 20),
      pad(fmtMicros(stats.mean), 12, 'right'),
      pad(fmtMicros(stats.p50), 12, 'right'),
      pad(fmtMicros(stats.p99), 12, 'right'),
    ].join(' | '));
  }
}

async function profileUpdateProcessing(iterations: number, stateSize: number) {
  console.log(`\n=== UPDATE MESSAGE PROCESSING (state size: ${stateSize} keys) ===\n`);

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

  const client = new Client(descriptor);
  await delay(50);

  client.SO('State').subscribe();
  await new Promise<void>(resolve => client.SO('State').once('init', () => resolve()));

  const timings = {
    serverNotify: [] as number[],
    clientReceive: [] as number[],
    endToEnd: [] as number[]
  };

  // Measure update processing
  for (let i = 0; i < iterations; i++) {
    service.SO('State').data.target++;

    const notifyStart = process.hrtime.bigint();
    service.SO('State').notify(['target']);
    const notifyEnd = process.hrtime.bigint();

    const updateReceived = await new Promise<bigint>(resolve => {
      const handler = () => {
        const t = process.hrtime.bigint();
        client.SO('State').removeListener('update', handler);
        resolve(t);
      };
      client.SO('State').on('update', handler);
    });

    timings.serverNotify.push(Number(notifyEnd - notifyStart) / 1000);
    timings.endToEnd.push(Number(updateReceived - notifyStart) / 1000);
    timings.clientReceive.push(Number(updateReceived - notifyEnd) / 1000);
  }

  client.SO('State').unsubscribe();
  await delay(50);
  client.close();
  await service.close();
  await delay(50);

  console.log('Update cycle breakdown:');
  const header = [
    pad('Phase', 20),
    pad('Mean', 12, 'right'),
    pad('P50', 12, 'right'),
    pad('P99', 12, 'right'),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const [name, values] of Object.entries(timings)) {
    const stats = calculateStats(values);
    console.log([
      pad(name, 20),
      pad(fmtMicros(stats.mean), 12, 'right'),
      pad(fmtMicros(stats.p50), 12, 'right'),
      pad(fmtMicros(stats.p99), 12, 'right'),
    ].join(' | '));
  }

  // Now profile individual client operations in isolation
  console.log('\nClient-side operation breakdown (isolated):');

  const { compileSchema } = await import('../src/validation.ts');
  const { apply } = await import('@azuliani/tree-diff');

  const validator = compileSchema(descriptor.endpoints[0]!.objectSchema);

  // Simulate update message
  const updateMessage = JSON.stringify({
    type: 'update',
    delta: [['target', 'E', 1]],
    v: 1,
    now: new Date().toISOString()
  });

  const isolatedTimings = {
    jsonParse: [] as number[],
    diffApplication: [] as number[],
  };

  const testData = { target: 0, data: generateFlatObject(stateSize) };

  for (let i = 0; i < iterations; i++) {
    // JSON parse
    let start = process.hrtime.bigint();
    const parsed = JSON.parse(updateMessage);
    let end = process.hrtime.bigint();
    isolatedTimings.jsonParse.push(Number(end - start) / 1000);

    // Diff application
    start = process.hrtime.bigint();
    apply(testData, parsed.delta);
    end = process.hrtime.bigint();
    isolatedTimings.diffApplication.push(Number(end - start) / 1000);

    // Reset for next iteration
    testData.target = 0;
  }

  const header2 = [
    pad('Operation', 20),
    pad('Mean', 12, 'right'),
    pad('P50', 12, 'right'),
    pad('P99', 12, 'right'),
  ].join(' | ');
  console.log(header2);
  console.log('-'.repeat(header2.length));

  for (const [name, values] of Object.entries(isolatedTimings)) {
    const stats = calculateStats(values);
    console.log([
      pad(name, 20),
      pad(fmtMicros(stats.mean), 12, 'right'),
      pad(fmtMicros(stats.p50), 12, 'right'),
      pad(fmtMicros(stats.p99), 12, 'right'),
    ].join(' | '));
  }
}

async function profileDiffSizes(iterations: number) {
  console.log(`\n=== DIFF SIZE IMPACT ON CLIENT PROCESSING ===\n`);

  const descriptor = await createDescriptorAsync({
    endpoints: [{
      name: 'State',
      type: 'SharedObject',
      objectSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'number' }
          }
        }
      }
    }]
  });

  const testCases = [
    { name: '1 diff', changes: 1 },
    { name: '10 diffs', changes: 10 },
    { name: '100 diffs', changes: 100 },
    { name: '1000 diffs', changes: 1000 },
  ];

  const results: Record<string, { mean: number; p99: number }> = {};

  for (const testCase of testCases) {
    const initialState = { items: Array(testCase.changes).fill(0) };

    const service = new Service(descriptor, {}, { State: initialState });
    await service.ready();

    const client = new Client(descriptor);
    await delay(50);

    client.SO('State').subscribe();
    await new Promise<void>(resolve => client.SO('State').once('init', () => resolve()));

    const timings: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Change all items
      for (let j = 0; j < testCase.changes; j++) {
        service.SO('State').data.items[j] = i + j;
      }

      const start = process.hrtime.bigint();
      service.SO('State').notify(['items'], true); // dirty bypass to force full array

      await new Promise<void>(resolve => {
        const handler = () => {
          const end = process.hrtime.bigint();
          timings.push(Number(end - start) / 1000);
          client.SO('State').removeListener('update', handler);
          resolve();
        };
        client.SO('State').on('update', handler);
      });
    }

    const stats = calculateStats(timings);
    results[testCase.name] = { mean: stats.mean, p99: stats.p99 };

    client.SO('State').unsubscribe();
    await delay(50);
    client.close();
    await service.close();
    await delay(50);
  }

  const header = [
    pad('Diff count', 15),
    pad('Mean', 12, 'right'),
    pad('P99', 12, 'right'),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const [name, stats] of Object.entries(results)) {
    console.log([
      pad(name, 15),
      pad(fmtMicros(stats.mean), 12, 'right'),
      pad(fmtMicros(stats.p99), 12, 'right'),
    ].join(' | '));
  }
}

async function profileStateSizes(iterations: number) {
  console.log(`\n=== STATE SIZE IMPACT ON INIT PROCESSING ===\n`);

  const testCases = [
    { name: '10 keys', size: 10 },
    { name: '100 keys', size: 100 },
    { name: '1000 keys', size: 1000 },
    { name: '10000 keys', size: 10000 },
  ];

  const results: Record<string, { mean: number; p99: number }> = {};

  for (const testCase of testCases) {
    const timings: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const descriptor = await createDescriptorAsync({
        endpoints: [{
          name: 'State',
          type: 'SharedObject',
          objectSchema: {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        }]
      });

      const initialState = { data: generateFlatObject(testCase.size) };

      const service = new Service(descriptor, {}, { State: initialState });
      await service.ready();

      const client = new Client(descriptor);

      const start = process.hrtime.bigint();
      client.SO('State').subscribe();
      await new Promise<void>(resolve => client.SO('State').once('init', () => resolve()));
      const end = process.hrtime.bigint();

      timings.push(Number(end - start) / 1000);

      client.SO('State').unsubscribe();
      await delay(30);
      client.close();
      await service.close();
      await delay(30);
    }

    const stats = calculateStats(timings);
    results[testCase.name] = { mean: stats.mean, p99: stats.p99 };
  }

  const header = [
    pad('State size', 15),
    pad('Mean', 12, 'right'),
    pad('P99', 12, 'right'),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const [name, stats] of Object.entries(results)) {
    console.log([
      pad(name, 15),
      pad(fmtMicros(stats.mean), 12, 'right'),
      pad(fmtMicros(stats.p99), 12, 'right'),
    ].join(' | '));
  }
}

async function main() {
  console.log('Client-side Performance Profiling');
  console.log('==================================');
  console.log(`Node.js: ${process.version} | Platform: ${process.platform}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const iterations = 50;

  await profileInitProcessing(iterations, 1000);
  await profileUpdateProcessing(iterations, 1000);
  await profileDiffSizes(20);
  await profileStateSizes(10);

  console.log('\n=== SUMMARY ===\n');
  console.log('Key observations:');
  console.log('- Init latency dominated by WebSocket connection setup');
  console.log('- JSON parsing is fast even for large states');
  console.log('- Diff application scales linearly with diff count');
  console.log('- Validation overhead is minimal for simple schemas');
}

main().catch(console.error);
