"use strict";

const { describe, it, before, after } = require('node:test');
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
        client = new Client(descriptor, {}, { initDelay: 50 });

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
