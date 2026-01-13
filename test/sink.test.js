"use strict";

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay } = require('./helpers');

const BASE_PORT = 15200;

const descriptor = {
    transports: {
        sink: {
            client: `tcp://127.0.0.1:${BASE_PORT}`,
            server: `tcp://127.0.0.1:${BASE_PORT}`
        }
    },
    endpoints: [
        {
            name: "Inbox",
            type: "Sink",
            messageSchema: {
                type: 'object',
                properties: {
                    clientId: { type: 'integer' },
                    data: { type: 'string' },
                    timestamp: { type: 'date' }
                }
            }
        }
    ]
};

describe('Sink Endpoint', () => {
    let server;
    let client1;
    let client2;

    before(async () => {
        server = new Service(descriptor, {}, {});
        client1 = new Client(descriptor);
        client2 = new Client(descriptor);

        await delay(50);
    });

    after(async () => {
        client1.close();
        client2.close();
        server.close();
        await delay(50);
    });

    it('should receive message from client', async () => {
        const messagePromise = waitFor(server.Inbox, 'message', 2000);

        const sentDate = new Date();
        client1.Inbox.push({
            clientId: 1,
            data: 'Hello from client 1',
            timestamp: sentDate
        });

        const msg = await messagePromise;

        assert.strictEqual(msg.clientId, 1);
        assert.strictEqual(msg.data, 'Hello from client 1');
        // Sink receives raw JSON, dates are strings
        assert.ok(typeof msg.timestamp === 'string' || msg.timestamp instanceof Date);
    });

    it('should receive messages from multiple clients', async () => {
        const received = [];

        const collectMessages = new Promise((resolve) => {
            let count = 0;
            const handler = (msg) => {
                received.push(msg.clientId);
                count++;
                if (count === 4) {
                    server.Inbox.removeListener('message', handler);
                    resolve();
                }
            };
            server.Inbox.on('message', handler);
        });

        client1.Inbox.push({ clientId: 1, data: 'msg1', timestamp: new Date() });
        client2.Inbox.push({ clientId: 2, data: 'msg2', timestamp: new Date() });
        client1.Inbox.push({ clientId: 1, data: 'msg3', timestamp: new Date() });
        client2.Inbox.push({ clientId: 2, data: 'msg4', timestamp: new Date() });

        await collectMessages;

        assert.strictEqual(received.filter(id => id === 1).length, 2);
        assert.strictEqual(received.filter(id => id === 2).length, 2);
    });
});
