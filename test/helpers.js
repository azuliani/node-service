"use strict";

const net = require('net');

// Set test environment for MonitoredSocket EADDRINUSE handling
process.env.NODE_ENV = 'test';

/**
 * Get free TCP ports on 127.0.0.1 from the OS. Fixed ports collide when test files run in parallel, or when a
 * leftover test process or another service on the box still holds them. The ports are held open together while
 * they are collected, so they are distinct.
 * @param {number} count - Number of ports
 * @returns {Promise<number[]>}
 */
async function freePorts(count) {
    const servers = [];
    for (let i = 0; i < count; i++) {
        const server = net.createServer();
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        servers.push(server);
    }
    const ports = servers.map(server => server.address().port);
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    return ports;
}

/**
 * Wait until a client's source connection is up. The service binds asynchronously: a client that connects first is
 * refused and ZeroMQ retries after its reconnect interval (connections came up 130-190 ms late on Linux), so whatever
 * the service publishes before then never reaches the client.
 * @param {Client} client - The client
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise}
 */
function sourceConnected(client, timeout = 5000) {
    if (client._isSourceConnected) {
        return Promise.resolve();
    }
    return waitFor(client._monitoredSource, 'connected', timeout);
}

/**
 * Wait for an event to be emitted on an EventEmitter
 * @param {EventEmitter} emitter - The event emitter to listen on
 * @param {string} event - The event name to wait for
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise} Resolves with the event data or rejects on timeout
 */
function waitFor(emitter, event, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for event '${event}'`));
        }, timeout);

        emitter.once(event, (...args) => {
            clearTimeout(timer);
            resolve(args.length === 1 ? args[0] : args);
        });
    });
}

/**
 * Wait for a specified duration
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    waitFor,
    delay,
    freePorts,
    sourceConnected
};
