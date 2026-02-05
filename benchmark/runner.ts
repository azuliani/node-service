/**
 * Benchmark orchestration and execution.
 */

import * as diffModes from './scenarios/diff-modes.ts';
import * as stateSizes from './scenarios/state-sizes.ts';
import * as clientScaling from './scenarios/client-scaling.ts';
import * as updateFrequency from './scenarios/update-frequency.ts';
import * as initLatency from './scenarios/init-latency.ts';
import * as nestedSubobjects from './scenarios/nested-subobjects.ts';
import * as proxyFastcopy from './scenarios/proxy-fastcopy.ts';
import { createReport, format, progress } from './utils/reporter.ts';
import type { BenchmarkResult, BenchmarkReport, OutputFormat } from './utils/reporter.ts';

/**
 * Available benchmark scenarios.
 */
export const SCENARIOS = {
  'diff-modes': {
    name: 'Diff Mode Comparison',
    run: diffModes.run,
  },
  'state-sizes': {
    name: 'State Size Scaling',
    run: stateSizes.run,
  },
  'client-scaling': {
    name: 'Client Scaling',
    run: clientScaling.run,
  },
  'update-frequency': {
    name: 'Update Frequency / Throughput',
    run: updateFrequency.run,
  },
  'init-latency': {
    name: 'Init Latency',
    run: initLatency.run,
  },
  'nested-subobjects': {
    name: 'Large Nested Subobjects',
    run: nestedSubobjects.run,
  },
  'proxy-fastcopy': {
    name: 'Proxy Fast-Copy Performance',
    run: proxyFastcopy.run,
  },
} as const;

export type ScenarioName = keyof typeof SCENARIOS;

/**
 * Runner options.
 */
export interface RunnerOptions {
  scenarios: ScenarioName[];
  output: OutputFormat;
}

/**
 * Run specified benchmark scenarios.
 */
export async function runBenchmarks(options: RunnerOptions): Promise<BenchmarkReport[]> {
  const reports: BenchmarkReport[] = [];

  for (const scenarioName of options.scenarios) {
    const scenario = SCENARIOS[scenarioName];
    if (!scenario) {
      progress(`Unknown scenario: ${scenarioName}`);
      continue;
    }

    progress(`\n=== ${scenario.name} ===\n`);

    try {
      const results: BenchmarkResult[] = await scenario.run();
      const report = createReport(scenario.name, results);
      reports.push(report);

      // Print results immediately if human format
      if (options.output === 'human') {
        console.log(format(report, 'human'));
      }
    } catch (err) {
      progress(`Error running ${scenarioName}: ${err}`);
    }
  }

  return reports;
}

/**
 * Run all scenarios.
 */
export async function runAll(output: OutputFormat = 'human'): Promise<BenchmarkReport[]> {
  const scenarios = Object.keys(SCENARIOS) as ScenarioName[];
  return runBenchmarks({ scenarios, output });
}
