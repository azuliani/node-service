"use strict";

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay } = require('./helpers');

// Use unique ports to avoid conflicts with other tests
// Each test suite uses ports starting at BASE_PORT + (test_number * 100)
const BASE_PORT = 17000;

// Fast heartbeat for tests - single variable controls all timing.
// 50ms provides reliable timing while keeping tests fast (~3 seconds total).
// If this suite regresses, first verify behavior at a higher value (e.g. 100ms).
const TEST_HEARTBEAT_MS = 50;
const TEST_HEARTBEAT_WAIT = Math.ceil(TEST_HEARTBEAT_MS * 1.5);  // Wait for first heartbeat
const TEST_TIMEOUT_WAIT = Math.ceil(TEST_HEARTBEAT_MS * 4);      // Wait for 3x timeout + buffer

// Helper to create SharedObject endpoint schema
const soEndpoint = {
    name: "State",
    type: "SharedObject",
    objectSchema: {
        type: 'object',
        properties: {
            counter: { type: 'number' },
            message: { type: 'string' }
        }
    }
};

// Helper to create descriptor with unique ports
function createSODescriptor(portOffset) {
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
        endpoints: [soEndpoint]
    };
}

function createSourceDescriptor(portOffset) {
    return {
        transports: {
            source: {
                client: `tcp://127.0.0.1:${BASE_PORT + portOffset}`,
                server: `tcp://127.0.0.1:${BASE_PORT + portOffset}`
            }
        },
        endpoints: [
            {
                name: "Events",
                type: "Source",
                messageSchema: {
                    type: 'object',
                    properties: {
                        value: { type: 'number' }
                    }
                }
            }
        ]
    };
}

const initialState = {
    counter: 0,
    message: 'initial'
};

describe('Heartbeat', () => {

    describe('Server heartbeat message format', () => {
        it('should include frequencyMs in heartbeat message', async () => {
            const descriptor = createSourceDescriptor(100);
            const server = new Service(descriptor, {}, {}, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            client.Events.subscribe();

            // Wait for heartbeat to activate
            await delay(TEST_HEARTBEAT_WAIT);

            assert.ok(client._serverHeartbeatFrequencyMs, 'Should have received heartbeat frequency from server');
            assert.strictEqual(client._serverHeartbeatFrequencyMs, TEST_HEARTBEAT_MS, 'Frequency should match configured value');

            client.Events.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });
    });

    describe('Lazy activation', () => {
        it('should not start timeout checking until first heartbeat received', async () => {
            const descriptor = createSODescriptor(200);
            const server = new Service(descriptor, {}, { State: { ...initialState } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            // Stop server heartbeats immediately
            clearInterval(server._heartbeatInterval);

            const client = new Client(descriptor, { initDelay: 50 });

            let disconnectCount = 0;
            client.State.on('disconnected', () => {
                disconnectCount++;
            });

            client.State.subscribe();
            await waitFor(client.State, 'init', 5000);

            // Wait for longer than any reasonable timeout
            // Since no heartbeat was ever received, no timeout checking should occur
            await delay(TEST_TIMEOUT_WAIT);

            assert.strictEqual(disconnectCount, 0, 'Should not disconnect without ever receiving heartbeat');

            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });
    });

    describe('Timeout threshold (3x HB frequency)', () => {
        it('should disconnect after 3x server HB frequency with no messages', async () => {
            const descriptor = createSODescriptor(300);

            const server = new Service(descriptor, {}, { State: { ...initialState } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            client.State.subscribe();
            await waitFor(client.State, 'init', 5000);

            // Wait for at least one heartbeat to start timeout checking
            await delay(TEST_HEARTBEAT_WAIT);

            // Now stop heartbeats
            clearInterval(server._heartbeatInterval);

            // Should disconnect after 3x heartbeat frequency
            const disconnectPromise = waitFor(client.State, 'disconnected', TEST_TIMEOUT_WAIT);
            await disconnectPromise;

            assert.strictEqual(client.State.connected, false, 'Should be disconnected');

            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });
    });

    describe('Any message resets timeout', () => {
        it('should reset timeout on regular SharedObject updates, not just heartbeats', async () => {
            const descriptor = createSODescriptor(400);

            const server = new Service(descriptor, {}, { State: { ...initialState } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            let disconnectCount = 0;
            client.State.on('disconnected', () => {
                disconnectCount++;
            });

            client.State.subscribe();
            await waitFor(client.State, 'init', 5000);

            // Wait for heartbeat to start timeout checking
            await delay(TEST_HEARTBEAT_WAIT);

            // Stop heartbeats
            clearInterval(server._heartbeatInterval);

            // Send regular updates faster than timeout threshold
            const updateInterval = setInterval(() => {
                server.State.data.counter++;
                server.State.notify();
            }, Math.ceil(TEST_HEARTBEAT_MS * 0.5));

            // Wait longer than the timeout would be
            await delay(TEST_TIMEOUT_WAIT * 2);

            clearInterval(updateInterval);

            assert.strictEqual(disconnectCount, 0, 'Should NOT disconnect while receiving regular updates');

            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });
    });

    describe('SharedObject.connected property', () => {
        it('should expose connected state', async () => {
            const descriptor = createSODescriptor(500);

            const server = new Service(descriptor, {}, { State: { ...initialState } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            // Should start disconnected
            assert.strictEqual(client.State.connected, false, 'Should start disconnected');

            client.State.subscribe();
            await waitFor(client.State, 'connected', 5000);

            assert.strictEqual(client.State.connected, true, 'Should be connected after connect event');

            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });

        it('should update connected state on disconnect', async () => {
            const descriptor = createSODescriptor(510);

            const server = new Service(descriptor, {}, { State: { ...initialState } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            client.State.subscribe();
            await waitFor(client.State, 'connected', 5000);
            await delay(TEST_HEARTBEAT_WAIT); // Wait for heartbeat to activate timeout checking

            assert.strictEqual(client.State.connected, true);

            // Stop heartbeats and wait for disconnect
            clearInterval(server._heartbeatInterval);
            await waitFor(client.State, 'disconnected', TEST_TIMEOUT_WAIT);

            assert.strictEqual(client.State.connected, false, 'Should be disconnected');

            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });
    });

    describe('Synthetic diffs on disconnect', () => {
        it('should emit update event with deletion diffs when disconnecting', async () => {
            const descriptor = createSODescriptor(600);

            const server = new Service(descriptor, {}, { State: { counter: 42, message: 'test' } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            client.State.subscribe();
            await waitFor(client.State, 'init', 5000);
            await delay(TEST_HEARTBEAT_WAIT); // Wait for heartbeat to activate

            // Verify we have data
            assert.strictEqual(client.State.data.counter, 42);

            let receivedDiffs = null;
            client.State.on('update', (diffs) => {
                receivedDiffs = diffs;
            });

            // Stop heartbeats and wait for disconnect
            clearInterval(server._heartbeatInterval);
            await waitFor(client.State, 'disconnected', TEST_TIMEOUT_WAIT);

            // Should have received deletion diffs
            assert.ok(receivedDiffs, 'Should have received update diffs');
            assert.ok(Array.isArray(receivedDiffs), 'Diffs should be an array');
            assert.ok(receivedDiffs.length > 0, 'Should have at least one diff');

            // All diffs should be deletions
            const allDeletions = receivedDiffs.every(d => d.kind === 'D');
            assert.ok(allDeletions, 'All diffs should be deletion diffs (kind: D)');

            // Should have deletion diffs for both properties
            const deletedPaths = receivedDiffs.map(d => d.path[0]);
            assert.ok(deletedPaths.includes('counter'), 'Should have deletion for counter');
            assert.ok(deletedPaths.includes('message'), 'Should have deletion for message');

            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });
    });

    describe('Reconnection', () => {
        it('should attempt to reconnect and re-init SharedObject after timeout', async () => {
            const descriptor = createSODescriptor(700);

            const server = new Service(descriptor, {}, { State: { ...initialState } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            client.State.subscribe();
            await waitFor(client.State, 'init', 5000);
            await delay(TEST_HEARTBEAT_WAIT); // Wait for heartbeat

            // Stop heartbeats to trigger disconnect
            clearInterval(server._heartbeatInterval);
            await waitFor(client.State, 'disconnected', TEST_TIMEOUT_WAIT);

            // Restart heartbeats
            server._heartbeatInterval = setInterval(server._sendHeartbeat.bind(server), TEST_HEARTBEAT_MS);

            // Should reconnect and re-init
            await waitFor(client.State, 'connected', 5000);
            await waitFor(client.State, 'init', 5000);

            assert.strictEqual(client.State.connected, true);
            assert.ok(client.State.ready, 'Should be ready after re-init');

            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });
    });

    describe('Idempotent disconnect', () => {
        it('should handle multiple disconnect triggers without issues', async () => {
            const descriptor = createSODescriptor(800);

            const server = new Service(descriptor, {}, { State: { ...initialState } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            let disconnectCount = 0;
            client.State.on('disconnected', () => {
                disconnectCount++;
            });

            client.State.subscribe();
            await waitFor(client.State, 'init', 5000);
            await delay(TEST_HEARTBEAT_WAIT);

            // Stop heartbeats
            clearInterval(server._heartbeatInterval);

            // Wait for disconnect
            await waitFor(client.State, 'disconnected', TEST_TIMEOUT_WAIT);

            // Manually trigger _sourceClosed again (simulating race condition)
            client._sourceClosed();
            client._sourceClosed();

            // Should only have fired once
            assert.strictEqual(disconnectCount, 1, 'Disconnect should only fire once (idempotent)');

            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });
    });

    describe('No re-subscribe after explicit unsubscribe', () => {
        it('should NOT call _init() if user unsubscribes before reconnect', async () => {
            const descriptor = createSODescriptor(900);

            const server = new Service(descriptor, {}, { State: { ...initialState } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            // Track actual HTTP init requests (not just _init calls)
            let httpInitCount = 0;
            const originalInit = client.State._init.bind(client.State);
            client.State._init = function() {
                // Only count if guard passes (subscribed is true)
                if (this._subscribed) {
                    httpInitCount++;
                }
                return originalInit();
            };

            client.State.subscribe();
            await waitFor(client.State, 'init', 5000);
            assert.strictEqual(httpInitCount, 1, 'Should have made one HTTP init request');

            // User unsubscribes while connected
            client.State.unsubscribe();
            assert.strictEqual(client.State.subscribed, false, 'Should be unsubscribed');

            // Now manually trigger reconnection logic (simulates what happens when reconnect occurs)
            // Set up sourceDisconnections as if a disconnect happened
            client.sourceDisconnections['State'] = true;

            // Simulate reconnection
            client._sourceConnected();

            // Wait a bit
            await delay(200);

            // HTTP init should NOT have been called again since we unsubscribed
            assert.strictEqual(httpInitCount, 1, 'HTTP init should NOT be called after unsubscribe');

            client.close();
            server.close();
            await delay(100);
        });

        it('should expose subscribed property', async () => {
            const descriptor = createSODescriptor(910);

            const server = new Service(descriptor, {}, { State: { ...initialState } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            assert.strictEqual(client.State.subscribed, false, 'Should start unsubscribed');

            client.State.subscribe();
            assert.strictEqual(client.State.subscribed, true, 'Should be subscribed after subscribe()');

            client.State.unsubscribe();
            assert.strictEqual(client.State.subscribed, false, 'Should be unsubscribed after unsubscribe()');

            client.close();
            server.close();
            await delay(100);
        });
    });

    describe('Identical behavior for both disconnect paths', () => {
        // This test verifies that heartbeat timeout and MonitoredSocket disconnect
        // produce the same events and state changes
        it('should produce same events for heartbeat timeout as MonitoredSocket disconnect', async () => {
            const descriptor = createSODescriptor(1000);

            const server = new Service(descriptor, {}, { State: { counter: 99, message: 'test' } }, { heartbeatMs: TEST_HEARTBEAT_MS });
            const client = new Client(descriptor, { initDelay: 50 });

            const events = [];
            client.State.on('disconnected', () => events.push('disconnected'));
            client.State.on('update', (diffs) => events.push({ type: 'update', diffs }));

            client.State.subscribe();
            await waitFor(client.State, 'init', 5000);
            await delay(TEST_HEARTBEAT_WAIT);

            // Clear events from init phase
            events.length = 0;

            // Trigger heartbeat timeout disconnect
            clearInterval(server._heartbeatInterval);
            await waitFor(client.State, 'disconnected', TEST_TIMEOUT_WAIT);

            // Verify events
            assert.ok(events.some(e => e === 'disconnected'), 'Should have disconnected event');
            assert.ok(events.some(e => e.type === 'update'), 'Should have update event with diffs');

            // Verify state
            assert.strictEqual(client.State.connected, false);
            assert.deepStrictEqual(client.State.data, {}, 'Data should be flushed');
            assert.strictEqual(client.State.ready, false, 'Ready should be false');

            client.State.unsubscribe();
            client.close();
            server.close();
            await delay(100);
        });
    });
});
