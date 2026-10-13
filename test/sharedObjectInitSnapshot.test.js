"use strict";

// The init snapshot is the state as of the last notify, labelled with that notify's version. A change to data that
// no notify has covered yet reaches a new client with the notify that covers it, like every other client. Up to
// 0.0.3 the snapshot was data itself: a pending change reached the new client early, and if it was undone before
// the next notify, no diff ever corrected that client.
// Run: node --test test/sharedObjectInitSnapshot.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay, freePorts, sourceConnected } = require('./helpers');

function createDescriptor([sourcePort, rpcPort]) {
    return {
        transports: {
            source: {
                client: `tcp://127.0.0.1:${sourcePort}`,
                server: `tcp://127.0.0.1:${sourcePort}`
            },
            rpc: {
                client: `tcp://127.0.0.1:${rpcPort}`,
                server: `tcp://127.0.0.1:${rpcPort}`
            }
        },
        endpoints: [
            {
                name: "State",
                type: "SharedObject",
                objectSchema: {
                    type: 'object',
                    properties: {
                        a: { type: 'number' },
                        b: { type: 'number' }
                    }
                }
            }
        ]
    };
}

async function start() {
    const descriptor = createDescriptor(await freePorts(2));
    const server = new Service(descriptor, {}, { State: { a: 0, b: 0 } });
    const client = new Client(descriptor, { initDelay: 50 });
    await sourceConnected(client);
    return { server, client };
}

async function stop({ server, client }) {
    client.State.unsubscribe();
    client.close();
    server.close();
    await delay(50);
}

async function subscribe(client) {
    const init = waitFor(client.State, 'init', 5000);
    client.State.subscribe();
    return init;
}

describe('SharedObject init snapshot', () => {
    it('serves the state as of the last notify; a pending change arrives with the notify that covers it', async () => {
        const nodes = await start();
        const { server, client } = nodes;
        try {
            server.State.data.a = 1;
            server.State.notify();
            server.State.data.b = 1; // pending: no notify yet

            const init = await subscribe(client);

            assert.strictEqual(init.v, 1);
            assert.deepStrictEqual(client.State.data, { a: 1, b: 0 });

            const update = waitFor(client.State, 'update', 5000);
            server.State.notify(['b']);
            await update;

            assert.deepStrictEqual(client.State.data, { a: 1, b: 1 });
        } finally {
            await stop(nodes);
        }
    });

    it('keeps a client in sync when it initialises while a change is pending that is undone before the next notify', async () => {
        const nodes = await start();
        const { server, client } = nodes;
        try {
            server.State.data.a = 1;
            server.State.data.b = 1;
            server.State.notify(['a']); // narrower than the change: b is still pending

            await subscribe(client);

            server.State.data.b = 0; // undone: the transmitted state never saw b = 1
            server.State.data.a = 2;
            const update = waitFor(client.State, 'update', 5000);
            server.State.notify();
            await update;

            assert.deepStrictEqual(server.State.data, { a: 2, b: 0 });
            assert.deepStrictEqual(client.State.data, { a: 2, b: 0 });
        } finally {
            await stop(nodes);
        }
    });
});
