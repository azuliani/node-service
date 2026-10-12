"use strict";

// SharedObject diffs reach the client exactly as the server applied them: one notify that shrinks several arrays
// and edits surviving elements (0.0.1-0.0.3 reordered the array deletions across arrays and kept wrong elements),
// and a Date the schema doesn't declare arrives as a string after an update, as it does in the init snapshot.
// Run: node --test test/sharedObjectDiffApply.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay } = require('./helpers');

const BASE_PORT = 15800;

const elements = { type: 'array', items: { type: 'object', properties: { x: { type: 'integer' } } } };

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
                    a0: elements,
                    a1: elements,
                    a2: elements,
                    meta: { type: 'object' }
                }
            }
        }
    ]
};

const run = (n) => Array.from({ length: n }, (_, x) => ({ x }));

describe('SharedObject diff application', () => {
    let server;
    let client;

    before(async () => {
        server = new Service(descriptor, {}, {
            State: { a0: run(7), a1: run(7), a2: run(3), meta: { when: new Date('2026-10-10T14:00:00Z') } }
        });
        client = new Client(descriptor, { initDelay: 50 });
        await delay(50);

        const init = waitFor(client.State, 'init', 5000);
        client.State.subscribe();
        await init;
    });

    after(async () => {
        client.State.unsubscribe();
        client.close();
        server.close();
        await delay(50);
    });

    it('applies one notify that shrinks several arrays like the server did', async () => {
        const update = waitFor(client.State, 'update', 5000);

        const data = server.State.data;
        data.a0 = [{ x: 0 }];
        data.a1 = [{ x: 100 }, { x: 1 }, { x: 102 }, { x: 3 }];
        data.a2 = [{ x: 0 }];
        server.State.notify();

        await update;

        assert.deepStrictEqual(client.State.data.a0, [{ x: 0 }]);
        assert.deepStrictEqual(client.State.data.a1, [{ x: 100 }, { x: 1 }, { x: 102 }, { x: 3 }]);
        assert.deepStrictEqual(client.State.data.a2, [{ x: 0 }]);
    });

    it('keeps a Date the schema does not declare a string after an update, as after init', async () => {
        assert.strictEqual(client.State.data.meta.when, '2026-10-10T14:00:00.000Z');

        const update = waitFor(client.State, 'update', 5000);
        server.State.data.meta.when = new Date('2026-10-10T15:00:00Z');
        server.State.notify();
        await update;

        assert.strictEqual(client.State.data.meta.when, '2026-10-10T15:00:00.000Z');
    });
});
