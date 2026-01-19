"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay } = require('./helpers');

const BASE_PORT = 15500;

function createDescriptor(portOffset = 0) {
    return {
        transports: {
            source: {
                client: `tcp://127.0.0.1:${BASE_PORT + portOffset}`,
                server: `tcp://127.0.0.1:${BASE_PORT + portOffset}`
            },
            rpc: {
                client: `tcp://127.0.0.1:${BASE_PORT + portOffset + 1}`,
                server: `tcp://127.0.0.1:${BASE_PORT + portOffset + 1}`
            }
        },
        endpoints: [
            {
                name: "State",
                type: "SharedObject",
                objectSchema: {
                    type: 'object',
                    properties: {
                        counter: { type: 'number' }
                    }
                }
            }
        ]
    };
}

describe('SharedObject Version Gap Bug', () => {

    it('should handle version gap in first message after init by re-initializing', async () => {
        const descriptor = createDescriptor(0);
        const server = new Service(descriptor, {}, { State: { counter: 0 } });
        const client = new Client(descriptor, { initDelay: 50 });
        await delay(50);

        // Wrap _tryApply to catch assertion errors from buggy code
        // (The bug causes an assertion to throw in _tryApply called via setImmediate)
        let caughtError = null;
        const originalTryApply = client.State._tryApply.bind(client.State);
        client.State._tryApply = function() {
            try {
                return originalTryApply();
            } catch (err) {
                caughtError = err;
            }
        };

        try {
            // Subscribe and wait for init
            const initPromise = waitFor(client.State, 'init', 5000);
            client.State.subscribe();
            await initPromise;

            assert.strictEqual(client.State._v, 0, 'Initial version should be 0');

            // Store original _processMessage
            const originalProcessMessage = client.State._processMessage.bind(client.State);

            // Flag to drop exactly one message
            let shouldDropNext = true;
            let droppedVersion = null;

            // Replace _processMessage to drop one message (simulating ZMQ packet loss)
            client.State._processMessage = function(data) {
                if (shouldDropNext && data.endpoint === "_SO_State") {
                    droppedVersion = data.message.v;
                    shouldDropNext = false;
                    return; // Drop this message - simulates ZMQ pub/sub packet loss
                }
                return originalProcessMessage(data);
            };

            // Send first update - this one will be dropped
            server.State.data.counter = 1;
            server.State.notify();

            // Small delay to ensure first message was processed (dropped)
            await delay(50);

            assert.strictEqual(droppedVersion, 1, 'Should have dropped version 1');

            // Send second update - this arrives as the "first" message after init
            // but has v=2 while client._v=0, so client expects v=1
            // BUG: Current code only checks v > _v (not stale), not v === _v + 1 (sequential)
            // FIX: Should detect gap and trigger re-init
            server.State.data.counter = 2;
            server.State.notify();

            // Wait for processing to complete
            // With the fix: re-init is triggered, client syncs to v=2
            // With the bug: assertion throws in _tryApply (caught by our wrapper)
            await delay(200);

            // Restore original methods
            client.State._processMessage = originalProcessMessage;
            client.State._tryApply = originalTryApply;

            // Check if buggy code threw an assertion error
            if (caughtError) {
                assert.fail(
                    `Buggy code threw assertion in _tryApply: ${caughtError.message}. ` +
                    `This indicates the version gap was not detected in _processMessage.`
                );
            }

            // Correct behavior after fix: should have re-initialized and synced
            // Client should have counter=2 and _v=2
            assert.strictEqual(
                client.State._v, 2,
                `Client version should be 2 after handling gap, got ${client.State._v}. ` +
                `This indicates the version gap in first message was not detected.`
            );
            assert.strictEqual(
                client.State.data.counter, 2,
                `Client counter should be 2, got ${client.State.data.counter}`
            );

        } finally {
            client.State._tryApply = originalTryApply;
            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(50);
        }
    });
});
