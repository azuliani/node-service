"use strict";

// notify(hint, true) ("dirtyBypass") sends the hinted subtree whole without diffing it, and keeps a copy of it as
// transmitted. Up to 0.0.3 it kept the live subtree itself: the last transmitted state then followed every later
// change to data, so a later notify(hint) into that subtree diffed as no change and sent nothing (connected clients
// waited for the next bypass), and a client initialising got changes no notify had sent yet.
// Run: node --test test/sharedObjectBypass.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay } = require('./helpers');

const BASE_PORT = 16200;

const providersSchema = {
    type: 'object',
    properties: {
        providers: {
            type: 'object',
            properties: { '*': { type: 'boolean' } }
        }
    }
};

function createDescriptor(portOffset, objectSchema) {
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
                objectSchema
            }
        ]
    };
}

async function start(portOffset, objectSchema = providersSchema, initial = { providers: { mollybet: true, betfair: true } }) {
    const descriptor = createDescriptor(portOffset, objectSchema);
    const server = new Service(descriptor, {}, { State: initial });
    const client = new Client(descriptor, { initDelay: 50 });
    await delay(50);
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

describe('SharedObject dirtyBypass', () => {
    it('a notify after a bypass notify of the same subtree reaches connected clients', async () => {
        const nodes = await start(0);
        const { server, client } = nodes;
        try {
            await subscribe(client);

            let update = waitFor(client.State, 'update', 5000);
            server.State.notify(['providers'], true);
            await update;

            update = waitFor(client.State, 'update', 1000).catch(() => null);
            server.State.data.providers.mollybet = false;
            server.State.notify(['providers']);
            await update;

            assert.deepStrictEqual(client.State.data.providers, { mollybet: false, betfair: true });
        } finally {
            await stop(nodes);
        }
    });

    it('a client initialising after a bypass notify gets the state as of the last notify', async () => {
        const nodes = await start(2);
        const { server, client } = nodes;
        try {
            server.State.notify(['providers'], true);
            server.State.data.providers.mollybet = false; // pending: no notify yet

            await subscribe(client);
            assert.deepStrictEqual(client.State.data.providers, { mollybet: true, betfair: true });

            const update = waitFor(client.State, 'update', 5000);
            server.State.notify(['providers']);
            await update;
            assert.deepStrictEqual(client.State.data.providers, { mollybet: false, betfair: true });
        } finally {
            await stop(nodes);
        }
    });

    it('a notify after a bypass of one offer deep in the tree reaches connected clients', async () => {
        // TxPrices' shape: notify([glob, "ir", offer], true), then the offer object changes in place
        const nodes = await start(4, { skip: true }, { games: { g1: { ir: { o1: { price: 2, provider: 'betfair' } } } } });
        const { server, client } = nodes;
        try {
            await subscribe(client);

            let update = waitFor(client.State, 'update', 5000);
            server.State.notify(['games', 'g1', 'ir', 'o1'], true);
            await update;

            update = waitFor(client.State, 'update', 1000).catch(() => null);
            server.State.data.games.g1.ir.o1.price = 3;
            server.State.notify(['games', 'g1']);
            await update;

            assert.deepStrictEqual(client.State.data.games.g1.ir.o1, { price: 3, provider: 'betfair' });
        } finally {
            await stop(nodes);
        }
    });

    it('a bypass of a single value keeps that value as transmitted', async () => {
        const nodes = await start(6);
        const { server, client } = nodes;
        try {
            await subscribe(client);

            let update = waitFor(client.State, 'update', 5000);
            server.State.notify(['providers', 'mollybet'], true);
            await update;
            assert.strictEqual(client.State.data.providers.mollybet, true);

            update = waitFor(client.State, 'update', 5000);
            server.State.data.providers.mollybet = false;
            server.State.notify(['providers']);
            await update;
            assert.deepStrictEqual(client.State.data.providers, { mollybet: false, betfair: true });
        } finally {
            await stop(nodes);
        }
    });
});
