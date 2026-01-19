"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay } = require('./helpers');

const BASE_PORT = 15700;

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

describe('SharedObject Message Buffering', () => {

    it('should buffer messages that arrive while init is delayed', async () => {
        // This test verifies that messages arriving while init is pending are buffered.
        // Note: Since we delay calling _init (not the HTTP response), when init finally
        // executes it returns the current server state, so buffered messages get skipped.
        // The key assertion here is that messages ARE buffered while init is delayed.

        const descriptor = createDescriptor(0);
        const server = new Service(descriptor, {}, { State: { counter: 0 } });
        const client = new Client(descriptor, { initDelay: 50 });
        await delay(50);

        try {
            // Store original _init
            const originalInit = client.State._init.bind(client.State);

            let resolveInitDelay;
            let snapshotCaptured = false;
            let capturedV = null;

            // Replace _init to capture state early but delay the actual init
            client.State._init = function() {
                // Capture what the server state is NOW (before updates)
                capturedV = server.State._v;
                snapshotCaptured = true;

                // Wait for our signal before actually doing the init
                new Promise(r => { resolveInitDelay = r; }).then(() => {
                    originalInit();
                });
            };

            // Subscribe - triggers our wrapped _init after initDelay (50ms)
            client.State.subscribe();

            // Wait for our wrapped _init to be called
            await delay(100);
            assert.ok(snapshotCaptured, '_init should have been called');
            assert.strictEqual(capturedV, 0, 'Server should have been at v=0 when init started');

            // At this point:
            // - Client's _init was called but is waiting on our promise
            // - Client is NOT ready yet
            // - ZMQ messages can arrive and will be buffered

            // Send updates while init is "in flight"
            server.State.data.counter = 10;
            server.State.notify(); // v=1

            server.State.data.counter = 20;
            server.State.notify(); // v=2

            server.State.data.counter = 30;
            server.State.notify(); // v=3

            // Small delay to ensure ZMQ messages arrive
            await delay(50);

            // Verify state: not ready, messages should be buffered
            assert.strictEqual(client.State.ready, false, 'Client should not be ready yet');
            assert.ok(client.State.firstChange !== null, 'Should have buffered changes');
            assert.strictEqual(client.State.firstChange.v, 1, 'First buffered message should be v=1');

            // Now let init proceed
            const initPromise = waitFor(client.State, 'init', 5000);
            resolveInitDelay();

            // Wait for init to complete
            await initPromise;

            // Small delay for _tryApply to process buffered messages
            await delay(50);

            // Init response has {counter: 30, v: 3} (current server state)
            // OR if the test works as intended with buffering:
            // Init response has {counter: 0, v: 0} and buffered messages v=1,2,3 are applied
            // Actually since we're not delaying the HTTP response itself, init will get current state
            // Let me verify what we actually get
            assert.strictEqual(
                client.State.data.counter, 30,
                `Client counter should be 30, got ${client.State.data.counter}`
            );

        } finally {
            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(50);
        }
    });

    it('should skip buffered messages when init returns newer version', async () => {
        // When init returns a version >= all buffered messages, those messages
        // should be skipped (they're already included in the init snapshot)

        const descriptor = createDescriptor(10);
        const server = new Service(descriptor, {}, { State: { counter: 0 } });
        const client = new Client(descriptor, { initDelay: 9999 }); // Very long delay, we'll call _init manually
        await delay(50);

        try {
            // Manually set up the client's internal state to simulate:
            // 1. Init request sent, snapshot {counter: 0, v: 0} prepared
            // 2. While response is in flight, messages v=1, v=2, v=3 arrive and are buffered
            // 3. Init response arrives with the old snapshot

            // First, subscribe to ZMQ but don't init yet
            client.State._subscribed = true;
            client.State.updateTransport.subscribe("_SO_State");

            // Ensure client is in fresh state
            client.State._flushData();
            assert.strictEqual(client.State._v, 0);
            assert.strictEqual(client.State.ready, false);

            // Send updates from server - these will be received and buffered
            server.State.data.counter = 10;
            server.State.notify(); // v=1

            server.State.data.counter = 20;
            server.State.notify(); // v=2

            server.State.data.counter = 30;
            server.State.notify(); // v=3

            // Wait for ZMQ messages to arrive
            await delay(100);

            // Verify messages are buffered
            assert.ok(client.State.firstChange !== null, 'Should have buffered changes');
            assert.strictEqual(client.State.firstChange.v, 1, 'First buffered should be v=1');

            // Now trigger init - server will return current state {counter: 30, v: 3}
            // The buffered messages (v=1,2,3) should be skipped since init returns v=3
            const initPromise = waitFor(client.State, 'init', 5000);
            client.State._init();

            await initPromise;
            await delay(50);

            // Verify: init should have set v=3 and skipped all buffered messages
            assert.strictEqual(client.State._v, 3, `Version should be 3, got ${client.State._v}`);
            assert.strictEqual(client.State.data.counter, 30, `Counter should be 30, got ${client.State.data.counter}`);

        } finally {
            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(50);
        }
    });

    it('should apply buffered messages newer than init snapshot', async () => {
        // Simulate: init returns v=0, but messages v=1,2,3 arrived and are buffered
        // After init completes, buffered messages should be applied

        const descriptor = createDescriptor(20);
        const server = new Service(descriptor, {}, { State: { counter: 0 } });
        const client = new Client(descriptor, { initDelay: 9999 });
        await delay(50);

        try {
            // Subscribe to ZMQ without triggering init
            client.State._subscribed = true;
            client.State.updateTransport.subscribe("_SO_State");
            client.State._flushData();

            // Intercept _init to capture a snapshot BEFORE sending updates
            const originalInit = client.State._init.bind(client.State);
            let initStarted = false;
            let resolveInit;

            client.State._init = function() {
                if (!this._subscribed) return;

                initStarted = true;
                this._flushData();

                // Simulate: we're going to get back {counter: 0, v: 0}
                // but in the meantime, updates will arrive

                // Wait for signal to complete init
                new Promise(r => { resolveInit = r; }).then(() => {
                    // Manually simulate init response with OLD state
                    this.data = { counter: 0 };
                    this._v = 0;
                    this.ready = true;
                    this._tryApply();
                    this.emit('init', { v: 0, data: { counter: 0 } });
                });
            };

            // Trigger init
            client.State._init();
            await delay(50);
            assert.ok(initStarted, 'Init should have started');

            // Now send updates - they'll be buffered since ready=false
            server.State.data.counter = 10;
            server.State.notify(); // v=1

            server.State.data.counter = 20;
            server.State.notify(); // v=2

            server.State.data.counter = 30;
            server.State.notify(); // v=3

            await delay(100);

            // Verify buffered
            assert.ok(client.State.firstChange !== null, 'Should have buffered changes');
            assert.strictEqual(client.State.ready, false, 'Should not be ready yet');

            // Complete init with OLD snapshot (v=0)
            const initPromise = waitFor(client.State, 'init', 5000);
            resolveInit();
            await initPromise;

            await delay(50);

            // Buffered messages v=1,2,3 should have been applied
            assert.strictEqual(client.State._v, 3, `Version should be 3 after applying buffered, got ${client.State._v}`);
            assert.strictEqual(client.State.data.counter, 30, `Counter should be 30, got ${client.State.data.counter}`);

        } finally {
            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(50);
        }
    });

    it('should silently skip messages older than current version after init', async () => {
        // This tests the stale message check: if a message arrives with v <= this._v,
        // it should be silently ignored (not trigger a re-init)

        const descriptor = createDescriptor(30);
        const server = new Service(descriptor, {}, { State: { counter: 0 } });
        const client = new Client(descriptor, { initDelay: 9999 });
        await delay(50);

        try {
            // Subscribe to ZMQ without auto-init
            client.State._subscribed = true;
            client.State.updateTransport.subscribe("_SO_State");
            client.State._flushData();

            // Send some updates first so server version advances
            server.State.data.counter = 10;
            server.State.notify(); // v=1

            server.State.data.counter = 20;
            server.State.notify(); // v=2

            server.State.data.counter = 30;
            server.State.notify(); // v=3

            // Wait for ZMQ messages to be buffered
            await delay(100);

            // Now do init - it will return {counter: 30, v: 3}
            const initPromise = waitFor(client.State, 'init', 5000);
            client.State._init();
            await initPromise;

            assert.strictEqual(client.State._v, 3, 'Should be at v=3 after init');
            assert.strictEqual(client.State.data.counter, 30);

            // Now simulate receiving a stale message (could happen due to network reordering)
            // This message has v=2, but we're already at v=3
            const staleMessage = {
                endpoint: "_SO_State",
                message: {
                    v: 2,
                    diffs: [{ kind: 'E', path: ['counter'], lhs: 10, rhs: 999 }],
                    now: new Date()
                }
            };

            // Track if init was called (it shouldn't be for stale messages)
            let initCalled = false;
            const originalInit = client.State._init.bind(client.State);
            client.State._init = function() {
                initCalled = true;
                return originalInit();
            };

            // Process the stale message
            client.State._processMessage(staleMessage);
            await delay(50);

            // Stale message should be silently ignored
            assert.strictEqual(initCalled, false, 'Should NOT trigger re-init for stale message');
            assert.strictEqual(client.State._v, 3, 'Version should still be 3');
            assert.strictEqual(client.State.data.counter, 30, 'Counter should still be 30 (stale diff not applied)');

            // Also test with v equal to current (v=3)
            const equalVersionMessage = {
                endpoint: "_SO_State",
                message: {
                    v: 3,
                    diffs: [{ kind: 'E', path: ['counter'], lhs: 30, rhs: 888 }],
                    now: new Date()
                }
            };

            client.State._processMessage(equalVersionMessage);
            await delay(50);

            assert.strictEqual(initCalled, false, 'Should NOT trigger re-init for equal version message');
            assert.strictEqual(client.State._v, 3, 'Version should still be 3');
            assert.strictEqual(client.State.data.counter, 30, 'Counter should still be 30');

        } finally {
            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(50);
        }
    });
});
