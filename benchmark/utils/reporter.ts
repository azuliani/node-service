/**
 * Benchmark result reporting utilities.
 */

import type { Stats } from './metrics.ts';

/**
 * Single benchmark result.
 */
export interface BenchmarkResult {
  name: string;
  iterations: number;
  warmup: number;
  stats: Stats;
  metadata?: Record<string, unknown>;
}

/**
 * Complete benchmark report.
 */
export interface BenchmarkReport {
  scenario: string;
  timestamp: string;
  platform: string;
  nodeVersion: string;
  results: BenchmarkResult[];
}

/**
 * Output format for the reporter.
 */
export type OutputFormat = 'human' | 'json';

/**
 * Format a number with fixed decimal places.
 */
function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

/**
 * Format throughput with appropriate units (K for thousands).
 */
function fmtOps(n: number): string {
  if (n >= 1000) {
    return (n / 1000).toFixed(1) + 'K';
  }
  return n.toFixed(0);
}

/**
 * Pad string to specified width.
 */
function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (s.length >= width) return s;
  const padding = ' '.repeat(width - s.length);
  return align === 'left' ? s + padding : padding + s;
}

/**
 * Create a report object with system info.
 */
export function createReport(scenario: string, results: BenchmarkResult[]): BenchmarkReport {
  return {
    scenario,
    timestamp: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    results,
  };
}

/**
 * Format report as human-readable output.
 */
export function formatHuman(report: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push('SharedObject Performance Benchmarks');
  lines.push('===================================');
  lines.push(`Node.js: ${report.nodeVersion} | Platform: ${report.platform}`);
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push('');
  lines.push(`--- ${report.scenario} ---`);
  lines.push('');

  // Calculate column widths
  const nameWidth = Math.max(12, ...report.results.map((r) => r.name.length));
  const opsWidth = 12;
  const latencyWidth = 10;

  // Header
  const header = [
    pad('Name', nameWidth),
    pad('Ops/sec', opsWidth, 'right'),
    pad('Mean', latencyWidth, 'right'),
    pad('P50', latencyWidth, 'right'),
    pad('P99', latencyWidth, 'right'),
    pad('Count', 8, 'right'),
  ].join(' | ');

  lines.push(header);
  lines.push('-'.repeat(header.length));

  // Results
  for (const result of report.results) {
    const { stats } = result;
    const row = [
      pad(result.name, nameWidth),
      pad(fmtOps(stats.opsPerSec) + ' ops/s', opsWidth, 'right'),
      pad(fmt(stats.mean) + 'ms', latencyWidth, 'right'),
      pad(fmt(stats.p50) + 'ms', latencyWidth, 'right'),
      pad(fmt(stats.p99) + 'ms', latencyWidth, 'right'),
      pad(String(stats.count), 8, 'right'),
    ].join(' | ');
    lines.push(row);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format report as JSON.
 */
export function formatJSON(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Format report in the specified format.
 */
export function format(report: BenchmarkReport, outputFormat: OutputFormat): string {
  if (outputFormat === 'json') {
    return formatJSON(report);
  }
  return formatHuman(report);
}

/**
 * Print a progress message during benchmark execution.
 */
export function progress(message: string): void {
  process.stderr.write(`[bench] ${message}\n`);
}
