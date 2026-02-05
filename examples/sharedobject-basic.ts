/**
 * Basic SharedObject Example
 *
 * Demonstrates state synchronization between a Service and Client.
 * The server owns the state and broadcasts diffs to subscribed clients.
 *
 * Run with: node examples/sharedobject-basic.ts
 */

import { Service, Client } from '../src/index.ts';
import type { Descriptor, SharedObjectEndpoint, Diff } from '../src/index.ts';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main() {
  // 1. Define the descriptor with a SharedObject endpoint
  //    SharedObject uses WebSocket for state synchronization.
  //    Server sends init message immediately when client connects.
  const descriptor: Descriptor = {
    transport: {
      server: '127.0.0.1:3001',
      client: '127.0.0.1:3001',
    },
    endpoints: [
      {
        name: 'Counter',
        type: 'SharedObject',
        objectSchema: {
          type: 'object',
          properties: {
            value: { type: 'number' },
            lastUpdated: { type: 'string', format: 'date-time' },
          },
        },
      } as SharedObjectEndpoint,
    ],
  };

  // 2. Create the Service with initial state for the SharedObject
  const service = new Service(
    descriptor,
    {}, // No RPC handlers needed
    {
      // Initial state for the 'Counter' SharedObject
      Counter: {
        value: 0,
        lastUpdated: new Date(),
      },
    }
  );

  await service.ready();
  console.log('[Service] Ready on port 3001');

  // 3. Create the Client
  const client = new Client(descriptor);
  console.log('[Client] Created');

  // Listen for updates
  client.SO('Counter').on('update', (diffs: Diff[]) => {
    console.log('[Client] Received update:', JSON.stringify(diffs, null, 2));
    console.log('[Client] Current state:', JSON.stringify(client.SO('Counter').data, null, 2));
  });

  // 4. Subscribe to the SharedObject and await initial state (init)
  //    The server sends the init message immediately on WebSocket connect.
  const initPromise = client.SO('Counter').subscribe();
  console.log('[Client] Subscribed to Counter');
  const initEvent = await initPromise;
  console.log('[Client] Initialized with:', JSON.stringify(initEvent.data, null, 2));
  console.log('[Client] ready:', client.SO('Counter').ready);

  // 5. Modify server state and broadcast updates
  console.log('\n--- Server updates the counter ---');

  // First update
  service.SO('Counter').data.value = 1;
  service.SO('Counter').data.lastUpdated = new Date();
  service.SO('Counter').notify();
  await delay(100);

  // Second update
  service.SO('Counter').data.value = 2;
  service.SO('Counter').data.lastUpdated = new Date();
  service.SO('Counter').notify();
  await delay(100);

  // Update with hint (optimizes diff computation)
  console.log('\n--- Server updates with hint ---');
  service.SO('Counter').data.value = 10;
  service.SO('Counter').notify(['value']); // Only check 'value' path for changes
  await delay(100);

  // 6. Read the synchronized state on the client
  console.log('\n--- Final client state ---');
  console.log('value:', client.SO('Counter').data?.value);
  console.log('lastUpdated:', client.SO('Counter').data?.lastUpdated);
  console.log('lastUpdated is Date:', client.SO('Counter').data?.lastUpdated instanceof Date);

  // 7. Cleanup: unsubscribe, then close client, then service
  console.log('\nCleaning up...');
  client.SO('Counter').unsubscribe();
  await delay(50);
  client.close();
  await service.close();
  await delay(50);
  console.log('Done!');
}

main().catch(console.error);
