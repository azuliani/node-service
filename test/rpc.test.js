"use strict";

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { delay } = require('./helpers');

const BASE_PORT = 15000;

const descriptor = {
    transports: {
        rpc: {
            client: `tcp://127.0.0.1:${BASE_PORT}`,
            server: `tcp://127.0.0.1:${BASE_PORT}`
        }
    },
    endpoints: [
        {
            name: "Echo",
            type: "RPC",
            requestSchema: { type: 'string' },
            replySchema: {
                type: 'object',
                properties: {
                    message: { type: 'string' },
                    timestamp: { type: 'date' }
                }
            }
        }
    ]
};

describe('RPC Endpoint', () => {
    let server;
    let client;

    before(async () => {
        const handlers = {
            Echo: (req, reply) => {
                reply(null, {
                    message: `Echo: ${req}`,
                    timestamp: new Date()
                });
            }
        };

        server = new Service(descriptor, handlers, {});
        client = new Client(descriptor);

        // Give ZMQ time to bind
        await delay(50);
    });

    after(async () => {
        client.close();
        server.close();
        await delay(50);
    });

    it('should call RPC and receive response', async () => {
        const result = await new Promise((resolve, reject) => {
            client.Echo.call("Hello", (err, res) => {
                if (err) reject(new Error(err));
                else resolve(res);
            });
        });

        assert.strictEqual(result.message, 'Echo: Hello');
        assert.ok(result.timestamp instanceof Date);
    });

    it('should handle multiple sequential calls', async () => {
        const messages = ['First', 'Second', 'Third'];

        for (const msg of messages) {
            const result = await new Promise((resolve, reject) => {
                client.Echo.call(msg, (err, res) => {
                    if (err) reject(new Error(err));
                    else resolve(res);
                });
            });
            assert.strictEqual(result.message, `Echo: ${msg}`);
        }
    });

    it('should timeout when server is unavailable', async () => {
        const noServerDescriptor = {
            transports: {
                rpc: {
                    client: `tcp://127.0.0.1:${BASE_PORT + 99}`,
                    server: `tcp://127.0.0.1:${BASE_PORT + 99}`
                }
            },
            endpoints: [
                {
                    name: "Unreachable",
                    type: "RPC",
                    requestSchema: { type: 'string' },
                    replySchema: { type: 'string' }
                }
            ]
        };

        const orphanClient = new Client(noServerDescriptor);

        const result = await new Promise((resolve) => {
            orphanClient.Unreachable.call("test", 500, (err, res) => {
                resolve({ err, res });
            });
        });

        assert.ok(
            result.err === 'timeout' || result.err.includes('ECONNREFUSED'),
            `Expected timeout or connection refused, got: ${result.err}`
        );

        orphanClient.close();
    });
});
