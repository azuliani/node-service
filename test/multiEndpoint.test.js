"use strict";

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay } = require('./helpers');

describe('Multi-endpoint Service (Two SharedObjects + RPC)', () => {
    const BASE_PORT = 18200;

    const descriptor = {
        transports: {
            source: {
                client: `tcp://127.0.0.1:${BASE_PORT}`,
                server: `tcp://127.0.0.1:${BASE_PORT}`
            },
            rpc: {
                client: `tcp://127.0.0.1:${BASE_PORT + 2}`,
                server: `tcp://127.0.0.1:${BASE_PORT + 2}`
            }
        },
        endpoints: [
            {
                name: "Alpha",
                type: "SharedObject",
                objectSchema: {
                    type: 'object',
                    properties: {
                        value: { type: 'number' }
                    }
                }
            },
            {
                name: "Beta",
                type: "SharedObject",
                objectSchema: {
                    type: 'object',
                    properties: {
                        label: { type: 'string' }
                    }
                }
            },
            {
                name: "Echo",
                type: "RPC",
                requestSchema: { type: 'string' },
                replySchema: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' }
                    }
                }
            }
        ]
    };

    let server, client;

    before(async () => {
        server = new Service(descriptor, {
            Echo: (req, reply) => {
                reply(null, { message: `Echo: ${req}` });
            }
        }, {
            Alpha: { value: 10 },
            Beta: { label: 'hello' }
        });

        client = new Client(descriptor, { initDelay: 50 });
        await delay(50);

        // Subscribe both SharedObjects up front and wait for init
        const alphaInit = waitFor(client.Alpha, 'init', 5000);
        const betaInit = waitFor(client.Beta, 'init', 5000);
        client.Alpha.subscribe();
        client.Beta.subscribe();
        await Promise.all([alphaInit, betaInit]);
        await delay(100);
    });

    after(async () => {
        client.Alpha.unsubscribe();
        client.Beta.unsubscribe();
        await delay(50);
        client.close();
        server.close();
        await delay(50);
    });

    it('should have both SharedObjects initialised', () => {
        assert.strictEqual(client.Alpha.data.value, 10);
        assert.strictEqual(client.Beta.data.label, 'hello');
    });

    it('should receive updates on Alpha', async () => {
        const update = waitFor(client.Alpha, 'update', 5000);
        server.Alpha.data.value = 42;
        server.Alpha.notify();
        await update;
        assert.strictEqual(client.Alpha.data.value, 42);
    });

    it('should receive updates on Beta', async () => {
        const update = waitFor(client.Beta, 'update', 5000);
        server.Beta.data.label = 'world';
        server.Beta.notify();
        await update;
        assert.strictEqual(client.Beta.data.label, 'world');
    });

    it('should handle RPC calls alongside SharedObjects', async () => {
        const rpcResult = await new Promise((resolve, reject) => {
            client.Echo.call("test", (err, res) => {
                if (err) reject(new Error(err));
                else resolve(res);
            });
        });

        assert.strictEqual(rpcResult.message, 'Echo: test');
    });
});

describe('Non-existing SharedObject endpoint', () => {
    const BASE_PORT = 18400;

    // Server descriptor: only Alpha and Echo
    const serverDescriptor = {
        transports: {
            source: {
                client: `tcp://127.0.0.1:${BASE_PORT}`,
                server: `tcp://127.0.0.1:${BASE_PORT}`
            },
            rpc: {
                client: `tcp://127.0.0.1:${BASE_PORT + 2}`,
                server: `tcp://127.0.0.1:${BASE_PORT + 2}`
            }
        },
        endpoints: [
            {
                name: "Alpha",
                type: "SharedObject",
                objectSchema: {
                    type: 'object',
                    properties: {
                        value: { type: 'number' }
                    }
                }
            },
            {
                name: "Echo",
                type: "RPC",
                requestSchema: { type: 'string' },
                replySchema: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' }
                    }
                }
            }
        ]
    };

    // Client descriptor: same transports, but adds Ghost (server doesn't have it)
    const clientDescriptor = {
        transports: serverDescriptor.transports,
        endpoints: [
            ...serverDescriptor.endpoints,
            {
                name: "Ghost",
                type: "SharedObject",
                objectSchema: {
                    type: 'object',
                    properties: {
                        phantom: { type: 'string' }
                    }
                }
            }
        ]
    };

    let server, client;

    before(async () => {
        server = new Service(serverDescriptor, {
            Echo: (req, reply) => {
                reply(null, { message: `Echo: ${req}` });
            }
        }, {
            Alpha: { value: 99 }
        });

        client = new Client(clientDescriptor, { initDelay: 50 });
        await delay(50);
    });

    after(async () => {
        client.Alpha.unsubscribe();
        client.Ghost.unsubscribe();
        await delay(50);
        client.close();
        server.close();
        await delay(50);
    });

    it('should not allow init fetch to hang for a non-existing SharedObject', async () => {
        // Subscribe to Ghost — server doesn't serve this endpoint
        client.Ghost.subscribe();

        // Wait long enough for init to fire, complete or time out
        await delay(500);

        // The init fetch must have completed (failed), not be hanging forever.
        // This requires the client to either receive an error from the server
        // or time out the fetch itself — either way, _initInFlight must be false.
        assert.strictEqual(client.Ghost._initInFlight, false, 'Init request should have completed, not hanging');
        assert.strictEqual(client.Ghost.ready, false, 'Ghost should not be ready');
    });

    it('should keep the server healthy after a non-existing SharedObject init', async () => {
        // Server must still serve RPC calls
        const rpcResult = await new Promise((resolve, reject) => {
            client.Echo.call("still alive?", 2000, (err, res) => {
                if (err) reject(new Error(err));
                else resolve(res);
            });
        });
        assert.strictEqual(rpcResult.message, 'Echo: still alive?');
    });

    it('should still serve existing SharedObjects after failed init for non-existing one', async () => {
        // Subscribe to Alpha — server has this endpoint
        const alphaInit = waitFor(client.Alpha, 'init', 5000);
        client.Alpha.subscribe();
        await alphaInit;

        assert.strictEqual(client.Alpha.data.value, 99);
    });
});
