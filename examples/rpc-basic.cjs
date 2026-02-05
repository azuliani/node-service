/**
 * Basic RPC Example (CommonJS)
 *
 * Demonstrates request/response communication between a Service and Client.
 * Uses dynamic import() to load the ESM package from CommonJS.
 *
 * Run with: node examples/rpc-basic.cjs
 * Note: Requires `npm run build` first to generate dist/
 */

async function main() {
  // Dynamic import for ESM package from CommonJS
  const { Service, Client } = await import('../dist/index.js');

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 1. Define the descriptor with an RPC endpoint
  //    Both Service and Client use the same descriptor
  const descriptor = {
    transport: {
      server: '127.0.0.1:3000',
      client: '127.0.0.1:3000',
    },
    endpoints: [
      {
        name: 'greet',
        type: 'RPC',
        requestSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        replySchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    ],
  };

  // 2. Create the Service with a handler for the 'greet' endpoint
  const service = new Service(
    descriptor,
    {
      // Handler receives validated input and returns the response
      greet: async (input) => {
        console.log(`[Service] Received request: ${JSON.stringify(input)}`);
        return {
          message: `Hello, ${input.name}!`,
          timestamp: new Date(),
        };
      },
    },
    {} // No initial state needed (no SharedObjects)
  );

  // Wait for the service to be ready
  await service.ready();
  console.log('[Service] Ready and listening on port 3000');

  // 3. Create the Client
  const client = new Client(descriptor);
  console.log('[Client] Created');

  // 4. Make RPC calls
  try {
    // Basic call
    const result = await client.RPC('greet').call({ name: 'World' });
    console.log(`[Client] Response: ${JSON.stringify(result)}`);
    console.log(`[Client] Timestamp is Date: ${result.timestamp instanceof Date}`);

    // Call with custom timeout (in milliseconds)
    const result2 = await client.RPC('greet').call({ name: 'CommonJS' }, 5000);
    console.log(`[Client] Response 2: ${result2.message}`);
  } catch (err) {
    console.error('[Client] Error:', err);
  }

  // 5. Cleanup: close client first, then service
  console.log('Cleaning up...');
  client.close();
  await service.close();
  await delay(50);
  console.log('Done!');
}

main().catch(console.error);
