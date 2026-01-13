"use strict";

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay } = require('./helpers');

const BASE_PORT = 15100;

const descriptor = {
    transports: {
        source: {
            client: `tcp://127.0.0.1:${BASE_PORT}`,
            server: `tcp://127.0.0.1:${BASE_PORT}`
        }
    },
    endpoints: [
        {
            name: "Events",
            type: "Source",
            messageSchema: {
                type: 'object',
                properties: {
                    type: { type: 'string' },
                    value: { type: 'number' },
                    timestamp: { type: 'date' }
                }
            }
        }
    ]
};

describe('Source Endpoint (Pub/Sub)', () => {
    let server;
    let client;

    before(async () => {
        server = new Service(descriptor, {}, {});
        client = new Client(descriptor);

        client.Events.subscribe();

        // Give ZMQ time to establish subscription
        await delay(100);
    });

    after(async () => {
        client.Events.unsubscribe();
        client.close();
        server.close();
        await delay(50);
    });

    it('should receive published message', async () => {
        const messagePromise = waitFor(client.Events, 'message', 2000);

        const sentDate = new Date();
        server.Events.send({
            type: 'test',
            value: 42,
            timestamp: sentDate
        });

        const msg = await messagePromise;

        assert.strictEqual(msg.type, 'test');
        assert.strictEqual(msg.value, 42);
        assert.ok(msg.timestamp instanceof Date);
    });

    it('should receive multiple messages in order', async () => {
        const received = [];

        const collectMessages = new Promise((resolve) => {
            let count = 0;
            const handler = (msg) => {
                received.push(msg.value);
                count++;
                if (count === 3) {
                    client.Events.removeListener('message', handler);
                    resolve();
                }
            };
            client.Events.on('message', handler);
        });

        server.Events.send({ type: 'seq', value: 1, timestamp: new Date() });
        server.Events.send({ type: 'seq', value: 2, timestamp: new Date() });
        server.Events.send({ type: 'seq', value: 3, timestamp: new Date() });

        await collectMessages;

        assert.deepStrictEqual(received, [1, 2, 3]);
    });

    it('should support multiple subscribers', async () => {
        const client2 = new Client(descriptor);
        client2.Events.subscribe();

        await delay(100);

        const msg1Promise = waitFor(client.Events, 'message', 2000);
        const msg2Promise = waitFor(client2.Events, 'message', 2000);

        server.Events.send({
            type: 'broadcast',
            value: 99,
            timestamp: new Date()
        });

        const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);

        assert.strictEqual(msg1.value, 99);
        assert.strictEqual(msg2.value, 99);

        client2.Events.unsubscribe();
        client2.close();
    });
});
