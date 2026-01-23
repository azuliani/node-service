"use strict";

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay } = require('./helpers');

const BASE_PORT = 15400;

const descriptor = {
    transports: {
        source: {
            client: `tcp://127.0.0.1:${BASE_PORT}`,
            server: `tcp://127.0.0.1:${BASE_PORT}`
        },
        rpc: {
            client: `tcp://127.0.0.1:${BASE_PORT + 1}`,
            server: `tcp://127.0.0.1:${BASE_PORT + 1}`
        }
    },
    endpoints: [
        {
            name: "State",
            type: "SharedObject",
            objectSchema: {
                type: 'object',
                properties: {
                    counter: { type: 'number' },
                    message: { type: 'string' },
                    timestamp: { type: 'date' },
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'integer' },
                                name: { type: 'string' }
                            }
                        }
                    },
                    nested: {
                        type: 'object',
                        properties: {
                            '*': {
                                type: 'object',
                                properties: {
                                    value: { type: 'number' },
                                    updated: { type: 'date' }
                                }
                            }
                        }
                    }
                }
            }
        }
    ]
};

const initialState = {
    counter: 0,
    message: 'initial',
    timestamp: new Date(),
    items: [],
    nested: {}
};

describe('SharedObject Endpoint', () => {
    let server;
    let client;

    before(async () => {
        server = new Service(descriptor, {}, { State: { ...initialState } });
        client = new Client(descriptor, { initDelay: 50 });

        await delay(50);
    });

    after(async () => {
        client.State.unsubscribe();
        client.close();
        server.close();
        await delay(50);
    });

    it('should receive initial state on subscribe', async () => {
        const initPromise = waitFor(client.State, 'init', 5000);

        client.State.subscribe();

        const initData = await initPromise;

        assert.strictEqual(client.State.data.counter, 0);
        assert.strictEqual(client.State.data.message, 'initial');
        assert.ok(client.State.data.timestamp instanceof Date);
    });

    it('should receive updates when server modifies state', async () => {
        const updatePromise = waitFor(client.State, 'update', 5000);

        server.State.data.counter = 42;
        server.State.data.message = 'updated';
        server.State.notify();

        await updatePromise;

        assert.strictEqual(client.State.data.counter, 42);
        assert.strictEqual(client.State.data.message, 'updated');
    });

    it('should sync array push operations', async () => {
        const updatePromise = waitFor(client.State, 'update', 5000);

        server.State.data.items.push({ id: 1, name: 'first' });
        server.State.notify();

        await updatePromise;

        assert.strictEqual(client.State.data.items.length, 1);
        assert.strictEqual(client.State.data.items[0].id, 1);
        assert.strictEqual(client.State.data.items[0].name, 'first');
    });

    it('should sync nested object additions', async () => {
        const updatePromise = waitFor(client.State, 'update', 5000);

        server.State.data.nested.foo = {
            value: 123,
            updated: new Date()
        };
        server.State.notify();

        await updatePromise;

        assert.ok(client.State.data.nested.foo);
        assert.strictEqual(client.State.data.nested.foo.value, 123);
        assert.ok(client.State.data.nested.foo.updated instanceof Date);
    });

    it('should sync nested object modifications', async () => {
        const updatePromise = waitFor(client.State, 'update', 5000);

        server.State.data.nested.foo.value = 456;
        server.State.notify();

        await updatePromise;

        assert.strictEqual(client.State.data.nested.foo.value, 456);
    });

    it('should sync array element modifications', async () => {
        // Add another item first
        server.State.data.items.push({ id: 2, name: 'second' });
        server.State.notify();
        await waitFor(client.State, 'update', 5000);

        const updatePromise = waitFor(client.State, 'update', 5000);

        server.State.data.items[0].name = 'modified-first';
        server.State.notify();

        await updatePromise;

        assert.strictEqual(client.State.data.items[0].name, 'modified-first');
    });

    it('should handle multiple updates', async () => {
        // Send first update
        const update1 = waitFor(client.State, 'update', 5000);
        server.State.data.counter = 100;
        server.State.notify();
        await update1;
        assert.strictEqual(client.State.data.counter, 100);

        // Send second update
        const update2 = waitFor(client.State, 'update', 5000);
        server.State.data.counter = 200;
        server.State.notify();
        await update2;
        assert.strictEqual(client.State.data.counter, 200);
    });

    it('should correctly sync array shortening (multiple deletions)', async () => {
        // Set up array with 4 elements
        const setup = waitFor(client.State, 'update', 5000);
        server.State.data.items = [
            { id: 1, name: 'one' },
            { id: 2, name: 'two' },
            { id: 3, name: 'three' },
            { id: 4, name: 'four' }
        ];
        server.State.notify();
        await setup;

        assert.strictEqual(client.State.data.items.length, 4);

        // Now shorten to 2 elements - this triggers multiple deletions
        // Bug: if deletions aren't processed highest-index-first, indices shift incorrectly
        const updatePromise = waitFor(client.State, 'update', 5000);
        server.State.data.items = [
            { id: 1, name: 'one' },
            { id: 2, name: 'two' }
        ];
        server.State.notify();

        await updatePromise;

        // Client should have exact copy of server array
        assert.strictEqual(client.State.data.items.length, 2);
        assert.deepStrictEqual(client.State.data.items, server.State.data.items);
        assert.strictEqual(client.State.data.items[0].id, 1);
        assert.strictEqual(client.State.data.items[1].id, 2);
    });
});

// Separate test suite for message queueing behavior during init
// Uses unique ports to avoid interference with other tests
describe('SharedObject Message Queueing During Init', { concurrency: 1 }, () => {
    // These tests verify that messages queue regardless of version during init,
    // and that when the init snapshot arrives, messages with versions <= snapshot
    // are discarded while messages with versions > snapshot are applied.
    //
    // BUG: The current implementation has a sequential version check in _processMessage
    // that rejects messages not matching expected version, causing re-init instead of
    // queueing. The correct behavior is: queue all messages during init regardless of
    // version, then filter when snapshot arrives.

    // Shared test infrastructure - sequential execution to avoid port conflicts
    const QUEUE_TEST_PORT = 15600;
    const queueTestDescriptor = {
        transports: {
            source: {
                client: `tcp://127.0.0.1:${QUEUE_TEST_PORT}`,
                server: `tcp://127.0.0.1:${QUEUE_TEST_PORT}`
            },
            rpc: {
                client: `tcp://127.0.0.1:${QUEUE_TEST_PORT + 1}`,
                server: `tcp://127.0.0.1:${QUEUE_TEST_PORT + 1}`
            }
        },
        endpoints: [
            {
                name: "State",
                type: "SharedObject",
                objectSchema: {
                    type: 'object',
                    properties: {
                        counter: { type: 'number' },
                        message: { type: 'string' }
                    }
                }
            }
        ]
    };

    let testServer;
    let testClient;

    before(async () => {
        testServer = new Service(queueTestDescriptor, {}, { State: { counter: 0, message: 'init' } });
        await delay(50);
    });

    after(async () => {
        if (testServer) testServer.close();
        await delay(50);
    });

    beforeEach(async () => {
        // Create fresh client for each test with long initDelay
        testClient = new Client(queueTestDescriptor, { initDelay: 10000 });
        await delay(20);
    });

    afterEach(async () => {
        if (testClient) {
            testClient.State.unsubscribe();
            await delay(20);
            testClient.close();
        }
        await delay(20);
    });

    it('should queue messages regardless of version before init completes', async () => {
        // Subscribe but init won't complete for 10s (we'll clean up before that)
        testClient.State.subscribe();
        await delay(10);

        // Directly inject messages that would arrive before init completes
        // Simulate messages with version 3, 4, 5 arriving (not starting at 1)
        // These should queue regardless of version during init phase
        testClient.State._processMessage({
            endpoint: '_SO_State',
            message: { v: 3, diffs: [{ kind: 'E', path: ['counter'], lhs: 2, rhs: 3 }], now: new Date() }
        });
        testClient.State._processMessage({
            endpoint: '_SO_State',
            message: { v: 4, diffs: [{ kind: 'E', path: ['counter'], lhs: 3, rhs: 4 }], now: new Date() }
        });
        testClient.State._processMessage({
            endpoint: '_SO_State',
            message: { v: 5, diffs: [{ kind: 'E', path: ['counter'], lhs: 4, rhs: 5 }], now: new Date() }
        });

        // Messages should be queued (linked list should exist)
        assert.ok(testClient.State.firstChange, 'firstChange should exist - messages must queue during init');
        assert.ok(testClient.State.lastChange, 'lastChange should exist');
        assert.strictEqual(testClient.State.firstChange.v, 3, 'firstChange should be v=3');
        assert.strictEqual(testClient.State.lastChange.v, 5, 'lastChange should be v=5');

        // Verify the linked list structure
        assert.strictEqual(testClient.State.firstChange.next.v, 4);
        assert.strictEqual(testClient.State.firstChange.next.next.v, 5);
    });

    it('should discard messages with version <= init snapshot version', async () => {
        testClient.State.subscribe();
        await delay(10);

        // Inject messages v=3, 4, 5, 6, 7 before init completes
        for (let v = 3; v <= 7; v++) {
            testClient.State._processMessage({
                endpoint: '_SO_State',
                message: { v, diffs: [{ kind: 'E', path: ['counter'], lhs: v - 1, rhs: v }], now: new Date() }
            });
        }

        // Verify all messages are queued (depends on queueing working)
        assert.strictEqual(testClient.State.firstChange?.v, 3, 'firstChange should be v=3');
        assert.strictEqual(testClient.State.lastChange?.v, 7, 'lastChange should be v=7');
        assert.strictEqual(testClient.State.outstandingDiffs, 5, 'should have 5 queued messages');

        // Now simulate init completing with snapshot at v=5
        // This mimics what _init does after receiving the RPC response
        testClient.State.data = { counter: 5, message: 'snapshot' };
        testClient.State._v = 5;

        // Skip messages with v <= 5 (this is the filtering logic from _init)
        let ptr = testClient.State.firstChange;
        while (ptr && ptr.v <= 5) {
            ptr = ptr.next;
        }
        testClient.State.firstChange = ptr || null;
        testClient.State.lastChange = null;
        testClient.State.outstandingDiffs = 0;

        while (ptr) {
            testClient.State.outstandingDiffs++;
            testClient.State.lastChange = ptr;
            ptr = ptr.next;
        }

        // After filtering, only v=6, 7 should remain
        assert.strictEqual(testClient.State.firstChange.v, 6, 'firstChange should be v=6 after filtering');
        assert.strictEqual(testClient.State.lastChange.v, 7, 'lastChange should be v=7 after filtering');
        assert.strictEqual(testClient.State.outstandingDiffs, 2, 'should have 2 outstanding diffs');
    });

    it('should apply queued messages after init snapshot is installed', async () => {
        testClient.State.subscribe();
        await delay(10);

        // Inject messages v=6, 7 before init completes
        testClient.State._processMessage({
            endpoint: '_SO_State',
            message: { v: 6, diffs: [{ kind: 'E', path: ['counter'], lhs: 5, rhs: 60 }], now: new Date() }
        });
        testClient.State._processMessage({
            endpoint: '_SO_State',
            message: { v: 7, diffs: [{ kind: 'E', path: ['counter'], lhs: 60, rhs: 70 }], now: new Date() }
        });

        // Simulate init completing with snapshot at v=5
        testClient.State.data = { counter: 5, message: 'snapshot' };
        testClient.State._v = 5;

        // Assuming messages queued correctly (firstChange is at v=6, which is > 5)
        // Set ready=true to allow _tryApply to process
        testClient.State.ready = true;

        // If messages were queued, they should be applied
        if (testClient.State.firstChange) {
            const updatePromise = waitFor(testClient.State, 'update', 1000);
            testClient.State._tryApply();
            await updatePromise;

            assert.strictEqual(testClient.State._v, 7, 'version should be 7 after applying updates');
            assert.strictEqual(testClient.State.data.counter, 70, 'counter should be 70 after applying v=6 and v=7');
        } else {
            // This branch runs if the queueing bug exists
            assert.fail('Messages should have been queued but were not - queueing bug present');
        }
    });

    it('should correctly handle init snapshot arriving with no queued messages to skip', async () => {
        testClient.State.subscribe();
        await delay(10);

        // No messages injected before init completes

        // Simulate init completing with snapshot at v=10
        testClient.State.data = { counter: 10, message: 'snapshot' };
        testClient.State._v = 10;
        testClient.State.ready = true;

        // No queued messages to apply
        assert.strictEqual(testClient.State.firstChange, null);
        assert.strictEqual(testClient.State.lastChange, null);
        assert.strictEqual(testClient.State._v, 10);
        assert.strictEqual(testClient.State.data.counter, 10);
    });

    it('should correctly handle init snapshot arriving with all queued messages to skip', async () => {
        testClient.State.subscribe();
        await delay(10);

        // Inject old messages v=2, 3, 4
        for (let v = 2; v <= 4; v++) {
            testClient.State._processMessage({
                endpoint: '_SO_State',
                message: { v, diffs: [{ kind: 'E', path: ['counter'], lhs: v - 1, rhs: v }], now: new Date() }
            });
        }

        // Check if messages were queued (may fail if queueing bug exists)
        const messagesQueued = testClient.State.outstandingDiffs === 3;

        // Simulate init completing with snapshot at v=10 (all queued messages are stale)
        testClient.State.data = { counter: 10, message: 'snapshot' };
        testClient.State._v = 10;

        // Skip all messages with v <= 10
        let ptr = testClient.State.firstChange;
        while (ptr && ptr.v <= 10) {
            ptr = ptr.next;
        }
        testClient.State.firstChange = ptr || null;
        testClient.State.lastChange = null;
        testClient.State.outstandingDiffs = 0;

        while (ptr) {
            testClient.State.outstandingDiffs++;
            testClient.State.lastChange = ptr;
            ptr = ptr.next;
        }

        testClient.State.ready = true;

        // All messages should have been skipped
        assert.strictEqual(testClient.State.firstChange, null, 'no messages should remain');
        assert.strictEqual(testClient.State.lastChange, null, 'no messages should remain');
        assert.strictEqual(testClient.State.outstandingDiffs, 0, 'no outstanding diffs');
        assert.strictEqual(testClient.State._v, 10, 'version should be from snapshot');
        assert.strictEqual(testClient.State.data.counter, 10, 'counter should be from snapshot');

        // Also verify the initial queueing happened (if not, there's a bug)
        assert.ok(messagesQueued, 'Messages should have been queued initially (3 messages) - queueing bug present if this fails');
    });
});
