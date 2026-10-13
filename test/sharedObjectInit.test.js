"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const SharedObjectClient = require('../Client/SharedObjectClient');
const SharedObjectService = require('../Service/SharedObjectService');
const { waitFor, delay } = require('./helpers');

function createEndpoint(name) {
    return {
        name,
        type: 'SharedObject',
        objectSchema: {
            type: 'object',
            properties: {
                value: { type: 'number' }
            }
        }
    };
}

function createTransports(port) {
    return {
        rpc: { hostname: '127.0.0.1', port },
        source: { subscribe: () => {}, unsubscribe: () => {} }
    };
}

// Listens on a free port from the OS: server.address().port
function startHttpServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function jsonPost(handler) {
    return (req, res) => {
        if (req.method === 'POST') {
            let body = '';
            req.on('data', d => body += d);
            req.on('end', () => handler(JSON.parse(body), res));
        }
    };
}

describe('SharedObjectClient init resilience', () => {

    it('should not make concurrent init requests when _initInFlight is true', async (t) => {
        let requestCount = 0;
        const pendingResponses = [];
        let gotRequest;
        const firstRequest = new Promise(resolve => { gotRequest = resolve; });

        const server = await startHttpServer(jsonPost((parsed, res) => {
            requestCount++;
            pendingResponses.push(res);
            gotRequest();
            // Hold the response — don't reply yet
        }));

        const client = new SharedObjectClient(createEndpoint('Test'), createTransports(server.address().port), { initDelay: 10 });
        t.after(async () => {
            client.unsubscribe();
            for (const res of pendingResponses) res.end();
            server.close();
            await delay(50);
        });
        client.subscribe();
        await firstRequest;

        assert.strictEqual(requestCount, 1, 'First _init() should have made exactly 1 request');
        assert.strictEqual(client._initInFlight, true, 'Init should be in flight');

        // Second call while first is in flight — should be a no-op
        client._init();
        await delay(50);

        assert.strictEqual(requestCount, 1, 'Second _init() should not have made another request');

        // Now let the pending request complete
        pendingResponses[0].writeHead(200, {'Content-Type': 'application/json'});
        pendingResponses[0].end(JSON.stringify({err: null, res: {data: {value: 42}, v: 0}}));
        await delay(50);

        assert.strictEqual(client._initInFlight, false, 'Init should have completed');
        assert.strictEqual(client.data.value, 42);
    });

    it('should not retry init after unsubscribe', async (t) => {
        let requestCount = 0;
        let gotRequest;
        const firstRequest = new Promise(resolve => { gotRequest = resolve; });

        const server = await startHttpServer(jsonPost((parsed, res) => {
            requestCount++;
            res.writeHead(404, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({err: 'Not found'}));
            gotRequest();
        }));

        const client = new SharedObjectClient(createEndpoint('Test'), createTransports(server.address().port), { initDelay: 10 });
        t.after(async () => {
            client.unsubscribe();
            server.close();
            await delay(50);
        });
        client.subscribe();
        await firstRequest;
        await delay(50); // Wait for the client to take the 404

        assert.strictEqual(requestCount, 1, 'Should have made 1 init request');
        assert.strictEqual(client._initInFlight, false, 'Init should have completed (failed)');

        // Unsubscribe cancels the pending retry timer
        client.unsubscribe();
        await delay(1500); // Wait past the 1s retry window

        assert.strictEqual(requestCount, 1, 'No retry should occur after unsubscribe');
    });

    it('should retry and succeed after init failure', async (t) => {
        let requestCount = 0;

        const server = await startHttpServer(jsonPost((parsed, res) => {
            requestCount++;
            if (requestCount === 1) {
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({err: 'Server error'}));
            } else {
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({err: null, res: {data: {value: 99}, v: 0}}));
            }
        }));

        const client = new SharedObjectClient(createEndpoint('Test'), createTransports(server.address().port), { initDelay: 10 });
        t.after(async () => {
            client.unsubscribe();
            server.close();
            await delay(50);
        });
        const initPromise = waitFor(client, 'init', 5000);
        client.subscribe();

        await initPromise;

        assert.strictEqual(requestCount, 2, 'Should have made 2 requests (1 failed + 1 successful retry)');
        assert.strictEqual(client.data.value, 99);
        assert.strictEqual(client.ready, true);
    });

    it('should return error for unknown commands via SharedObjectService.call()', () => {
        const service = new SharedObjectService(createEndpoint('Test'), { rpc: {}, source: {} }, { value: 1 });

        let result;
        service.call({ input: 'badcommand' }, (r) => { result = r; });

        const parsed = JSON.parse(result);
        assert.ok(parsed.err, 'Should have an error');
        assert.match(parsed.err, /Unknown command/);
        assert.match(parsed.err, /badcommand/);
    });

    it('should abort init fetch after configurable timeout', async (t) => {
        let requestCount = 0;
        const connections = new Set();
        let gotRequest;
        const firstRequest = new Promise(resolve => { gotRequest = resolve; });

        const server = await startHttpServer(jsonPost((parsed, res) => {
            requestCount++;
            gotRequest();
            // Never respond — let AbortSignal.timeout fire
        }));
        server.on('connection', (conn) => {
            connections.add(conn);
            conn.on('close', () => connections.delete(conn));
        });

        const client = new SharedObjectClient(createEndpoint('Test'), createTransports(server.address().port), {
            initDelay: 10,
            initTimeout: 500
        });
        t.after(async () => {
            client.unsubscribe();
            for (const conn of connections) conn.destroy();
            server.close();
            await delay(50);
        });
        client.subscribe();
        await firstRequest;

        assert.strictEqual(requestCount, 1, 'Should have made 1 request');
        assert.strictEqual(client._initInFlight, true, 'Init should be in flight (waiting for timeout)');

        await delay(600); // Wait for the 500ms timeout to fire

        assert.strictEqual(client._initInFlight, false, 'Init should have completed after timeout');
        assert.strictEqual(client.ready, false, 'Should not be ready after timeout');
    });

});
