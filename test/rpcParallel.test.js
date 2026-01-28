"use strict";

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { delay } = require('./helpers');

const BASE_PORT = 15900;

const descriptor = {
    transports: {
        rpc: {
            client: `tcp://127.0.0.1:${BASE_PORT}`,
            server: `tcp://127.0.0.1:${BASE_PORT}`
        }
    },
    endpoints: [
        {
            name: "DelayedEcho",
            type: "RPC",
            requestSchema: {
                type: 'object',
                properties: {
                    message: { type: 'string' },
                    delayMs: { type: 'number' }
                }
            },
            replySchema: {
                type: 'object',
                properties: {
                    message: { type: 'string' }
                }
            }
        }
    ]
};

describe('RPC Parallel Processing', () => {
    let server;
    let client;

    before(async () => {
        const handlers = {
            DelayedEcho: (req, reply) => {
                setTimeout(() => {
                    reply(null, { message: `Echo: ${req.message}` });
                }, req.delayMs);
            }
        };

        server = new Service(descriptor, handlers, {});
        client = new Client(descriptor);

        await delay(50);
    });

    after(async () => {
        client.close();
        server.close();
        await delay(50);
    });

    it('should process parallel RPC calls concurrently, returning in delay order', async () => {
        // Delays are intentionally out of order to prove that the server
        // doesn't just return them in submission order.
        const calls = [
            { message: 'slow',    delayMs: 250 },
            { message: 'fast',    delayMs: 50 },
            { message: 'medium2', delayMs: 200 },
            { message: 'medium1', delayMs: 100 },
            { message: 'medium3', delayMs: 150 }
        ];

        const expectedOrder = [...calls]
            .sort((a, b) => a.delayMs - b.delayMs)
            .map(c => c.message);

        const totalSequential = calls.reduce((s, c) => s + c.delayMs, 0);
        const maxDelay = Math.max(...calls.map(c => c.delayMs));
        const MAX_ALLOWED_MS = maxDelay * 2;

        const arrivalOrder = [];
        const start = Date.now();

        const promises = calls.map(({ message, delayMs }) => {
            return new Promise((resolve, reject) => {
                client.DelayedEcho.call({ message, delayMs }, (err, res) => {
                    if (err) reject(new Error(err));
                    else resolve(res);
                });
            }).then(res => {
                arrivalOrder.push(res.message.replace('Echo: ', ''));
                return res;
            });
        });

        const results = await Promise.all(promises);

        const elapsed = Date.now() - start;

        // Verify all responses came back correctly
        for (let i = 0; i < calls.length; i++) {
            assert.strictEqual(results[i].message, `Echo: ${calls[i].message}`);
        }

        // Verify responses arrived in shortest-delay-first order
        assert.deepStrictEqual(
            arrivalOrder,
            expectedOrder,
            `Expected arrival order ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(arrivalOrder)}`
        );

        // Verify parallel execution: total time should be close to the longest
        // single delay, not the sum of all delays
        assert.ok(
            elapsed < MAX_ALLOWED_MS,
            `Expected parallel completion under ${MAX_ALLOWED_MS}ms, but took ${elapsed}ms (sequential would be ~${totalSequential}ms)`
        );
    });
});
