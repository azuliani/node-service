#!/usr/bin/env node
/**
 * Benchmark: Large Nested Subobjects
 *
 * Tests performance of replacing whole subobjects in a large parent object.
 * Parent object has N child subobjects, each ~200KB (configurable).
 *
 * Run with: node benchmark/nested-subobjects.js
 */

"use strict";

const { Service, Client } = require('../index');
const { delay, waitFor } = require('../test/helpers');

// Configuration
const CHILD_COUNT = 50;        // Number of child subobjects (50 = ~10MB state)
const ITERATIONS = 20;         // Measurement iterations
const WARMUP = 3;              // Warmup iterations

// Timer utility
class Timer {
  constructor() {
    this._start = 0n;
    this._end = 0n;
  }

  start() { this._start = process.hrtime.bigint(); }
  stop() { this._end = process.hrtime.bigint(); }
  get ms() { return Number(this._end - this._start) / 1_000_000; }
}

// Stats calculation
function calculateStats(values) {
  if (values.length === 0) return { mean: 0, p50: 0, p99: 0, opsPerSec: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { mean, p50, p99, opsPerSec: mean > 0 ? 1000 / mean : 0 };
}

/**
 * Generate a ~200KB nested object.
 */
function generate200KBObject(depth = 3) {
  if (depth <= 1) {
    const obj = {};
    for (let i = 0; i < 200; i++) {
      obj[`field${i}`] = 'x'.repeat(250); // 200 * 250 = 50KB per leaf
    }
    return obj;
  }
  return {
    level1: generate200KBObject(depth - 1),
    level2: generate200KBObject(depth - 1),
    level3: generate200KBObject(depth - 1),
    meta: { id: Math.random(), timestamp: Date.now() },
  };
}

/**
 * Generate initial state with N children.
 */
function generateInitialState(childCount) {
  const children = {};
  for (let i = 0; i < childCount; i++) {
    children[`child${i}`] = generate200KBObject(3);
  }
  return { children, counter: 0 };
}

// Port allocation (use high ports to avoid conflicts)
let portBase = 30000;
function getNextPort() {
  const port = portBase;
  portBase += 10;
  return port;
}

async function runBenchmark() {
  console.log('Large Nested Subobjects Benchmark (OLD library)');
  console.log('================================================');
  console.log(`Child count: ${CHILD_COUNT} (each ~200KB)`);
  console.log(`Iterations: ${ITERATIONS}, Warmup: ${WARMUP}`);
  console.log(`Approximate state size: ${(CHILD_COUNT * 200 / 1024).toFixed(1)}MB`);
  console.log('');

  const basePort = getNextPort();

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
    endpoints: [
      {
        name: 'State',
        type: 'SharedObject',
        objectSchema: {
          type: 'object',
          properties: {
            children: {
              type: 'object',
              properties: {
                '*': { type: 'object' }  // Allow any nested structure
              }
            },
            counter: { type: 'number' }
          }
        }
      }
    ]
  };

  console.log('Generating initial state...');
  const initialState = generateInitialState(CHILD_COUNT);

  console.log('Starting service...');
  const service = new Service(descriptor, {}, { State: initialState });
  await delay(200);

  console.log('Connecting client...');
  const client = new Client(descriptor, { initDelay: 50 });
  await delay(100);

  client.State.subscribe();
  await waitFor(client.State, 'init', 60000);
  console.log('Client initialized\n');

  const timer = new Timer();
  const results = {};

  // Test 1: Small modification inside a subobject (hinted diff)
  console.log('Running: Small nested change (hinted)...');
  {
    const latencies = [];

    // Warmup
    for (let i = 0; i < WARMUP; i++) {
      const childKey = `child${i % CHILD_COUNT}`;
      service.State.data.children[childKey].level1.level2.field0 = `warmup${i}`;
      service.State.notify(['children', childKey]);
      await delay(50);
    }

    // Measurement
    for (let i = 0; i < ITERATIONS; i++) {
      const childKey = `child${i % CHILD_COUNT}`;

      timer.start();
      service.State.data.children[childKey].level1.level2.field0 = `test${i}`;
      service.State.notify(['children', childKey]);
      timer.stop();

      latencies.push(timer.ms);
      await delay(20);
    }

    results['Small nested change (hinted)'] = calculateStats(latencies);
  }

  // Test 2: Replace whole subobject (dirty bypass)
  console.log('Running: Replace subobject (dirty bypass)...');
  {
    const latencies = [];

    // Warmup
    for (let i = 0; i < WARMUP; i++) {
      const childKey = `child${i % CHILD_COUNT}`;
      const newChild = generate200KBObject(3);
      newChild.meta.id = `warmup${i}`;
      service.State.data.children[childKey] = newChild;
      service.State.notify(['children', childKey], true);
      await delay(50);
    }

    // Measurement
    for (let i = 0; i < ITERATIONS; i++) {
      const childKey = `child${i % CHILD_COUNT}`;

      timer.start();
      const newChild = generate200KBObject(3);
      newChild.meta.id = `test${i}`;
      service.State.data.children[childKey] = newChild;
      service.State.notify(['children', childKey], true);
      timer.stop();

      latencies.push(timer.ms);
      await delay(20);
    }

    results['Replace subobject (dirty bypass)'] = calculateStats(latencies);
  }

  // Test 3: Replace whole subobject (with diff)
  console.log('Running: Replace subobject (with diff)...');
  {
    const latencies = [];

    // Warmup
    for (let i = 0; i < WARMUP; i++) {
      const childKey = `child${i % CHILD_COUNT}`;
      const newChild = generate200KBObject(3);
      newChild.meta.id = `warmup${i}`;
      service.State.data.children[childKey] = newChild;
      service.State.notify(['children', childKey]);
      await delay(50);
    }

    // Measurement
    for (let i = 0; i < ITERATIONS; i++) {
      const childKey = `child${i % CHILD_COUNT}`;

      timer.start();
      const newChild = generate200KBObject(3);
      newChild.meta.id = `test${i}`;
      service.State.data.children[childKey] = newChild;
      service.State.notify(['children', childKey]);
      timer.stop();

      latencies.push(timer.ms);
      await delay(20);
    }

    results['Replace subobject (with diff)'] = calculateStats(latencies);
  }

  // Cleanup
  console.log('\nCleaning up...');
  client.State.unsubscribe();
  await delay(100);
  client.close();
  service.close();
  await delay(200);

  // Print results
  console.log('\n');
  console.log('--- Results ---\n');

  const header = [
    'Name'.padEnd(35),
    'Ops/sec'.padStart(12),
    'Mean'.padStart(10),
    'P50'.padStart(10),
    'P99'.padStart(10)
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const [name, stats] of Object.entries(results)) {
    const row = [
      name.padEnd(35),
      (stats.opsPerSec.toFixed(0) + ' ops/s').padStart(12),
      (stats.mean.toFixed(2) + 'ms').padStart(10),
      (stats.p50.toFixed(2) + 'ms').padStart(10),
      (stats.p99.toFixed(2) + 'ms').padStart(10)
    ].join(' | ');
    console.log(row);
  }

  console.log('');
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
