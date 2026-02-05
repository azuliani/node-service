/**
 * Built-in health plugin.
 */

import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { ServicePlugin } from '../plugins.ts';

/**
 * Health endpoint response format.
 */
export interface HealthInfo {
  uptimeSec: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  eventLoopDelayMs: number;
  loadAvg: [number, number, number];
  pid: number;
  node: string;
  platform: string;
  arch: string;
}

export function healthPlugin(): ServicePlugin {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  let lastEventLoopDelayMs = 0;
  const timer = setInterval(() => {
    lastEventLoopDelayMs = histogram.mean / 1e6;
    histogram.reset();
  }, 1000);
  timer.unref?.();

  return {
    name: 'health',
    endpoints: [
      {
        name: '_health',
        type: 'RPC',
        requestSchema: { type: 'null' },
        replySchema: {
          type: 'object',
          additionalProperties: false,
          required: [
            'uptimeSec',
            'rssBytes',
            'heapUsedBytes',
            'heapTotalBytes',
            'externalBytes',
            'arrayBuffersBytes',
            'eventLoopDelayMs',
            'loadAvg',
            'pid',
            'node',
            'platform',
            'arch',
          ],
          properties: {
            uptimeSec: { type: 'number' },
            rssBytes: { type: 'number' },
            heapUsedBytes: { type: 'number' },
            heapTotalBytes: { type: 'number' },
            externalBytes: { type: 'number' },
            arrayBuffersBytes: { type: 'number' },
            eventLoopDelayMs: { type: 'number' },
            loadAvg: {
              type: 'array',
              items: { type: 'number' },
              minItems: 3,
              maxItems: 3,
            },
            pid: { type: 'number' },
            node: { type: 'string' },
            platform: { type: 'string' },
            arch: { type: 'string' },
          },
        },
      },
    ],
    handlers: {
      _health: async () => {
        const mem = process.memoryUsage();
        return {
          uptimeSec: process.uptime(),
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
          heapTotalBytes: mem.heapTotal,
          externalBytes: mem.external,
          arrayBuffersBytes: mem.arrayBuffers,
          eventLoopDelayMs: lastEventLoopDelayMs,
          loadAvg: os.loadavg() as [number, number, number],
          pid: process.pid,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
        };
      },
    },
  };
}
