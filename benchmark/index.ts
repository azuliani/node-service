#!/usr/bin/env node
/**
 * SharedObject Performance Benchmark CLI
 *
 * Usage:
 *   node --experimental-strip-types benchmark/index.ts [options]
 *
 * Options:
 *   --scenario=<name>   Run specific scenario (diff-modes, state-sizes,
 *                       client-scaling, update-frequency, init-latency)
 *   --output=json       Output results as JSON (default: human-readable)
 *   --help              Show this help message
 *
 * Examples:
 *   npm run bench                          # Run all scenarios
 *   npm run bench -- --scenario=diff-modes # Run specific scenario
 *   npm run bench -- --output=json         # Output as JSON
 */

import { runBenchmarks, runAll, SCENARIOS } from './runner.ts';
import type { ScenarioName } from './runner.ts';
import type { OutputFormat } from './utils/reporter.ts';
import { format } from './utils/reporter.ts';

function printHelp(): void {
  console.log(`
SharedObject Performance Benchmark CLI

Usage:
  node --experimental-strip-types benchmark/index.ts [options]

Options:
  --scenario=<name>   Run specific scenario
  --output=json       Output results as JSON (default: human-readable)
  --help              Show this help message

Available scenarios:
${Object.entries(SCENARIOS)
  .map(([key, val]) => `  ${key.padEnd(18)} ${val.name}`)
  .join('\n')}

Examples:
  npm run bench                              # Run all scenarios
  npm run bench -- --scenario=diff-modes     # Run specific scenario
  npm run bench -- --output=json             # Output as JSON
`);
}

function parseArgs(args: string[]): { scenarios: ScenarioName[]; output: OutputFormat; help: boolean } {
  let scenarios: ScenarioName[] = [];
  let output: OutputFormat = 'human';
  let help = false;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg.startsWith('--scenario=')) {
      const name = arg.slice('--scenario='.length) as ScenarioName;
      if (name in SCENARIOS) {
        scenarios.push(name);
      } else {
        console.error(`Unknown scenario: ${name}`);
        console.error(`Available: ${Object.keys(SCENARIOS).join(', ')}`);
        process.exit(1);
      }
    } else if (arg === '--output=json') {
      output = 'json';
    } else if (arg.startsWith('--output=')) {
      const val = arg.slice('--output='.length);
      if (val !== 'human' && val !== 'json') {
        console.error(`Unknown output format: ${val}`);
        process.exit(1);
      }
      output = val as OutputFormat;
    }
  }

  // Default to all scenarios if none specified
  if (scenarios.length === 0) {
    scenarios = Object.keys(SCENARIOS) as ScenarioName[];
  }

  return { scenarios, output, help };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { scenarios, output, help } = parseArgs(args);

  if (help) {
    printHelp();
    process.exit(0);
  }

  try {
    const reports = await runBenchmarks({ scenarios, output });

    // For JSON output, print all reports at the end
    if (output === 'json') {
      console.log(JSON.stringify(reports, null, 2));
    }

    process.exit(0);
  } catch (err) {
    console.error('Benchmark failed:', err);
    process.exit(1);
  }
}

main();
