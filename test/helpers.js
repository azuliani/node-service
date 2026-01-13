"use strict";

// Set test environment for MonitoredSocket EADDRINUSE handling
process.env.NODE_ENV = 'test';

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

/**
 * Create a descriptor for testing with specified transports
 * @param {number} basePort - Base port number
 * @param {Object} options - Which transports to include
 * @returns {Object} Descriptor object
 */
function createDescriptor(basePort, options = {}) {
    const transports = {};

    if (options.source) {
        transports.source = {
            client: `tcp://127.0.0.1:${basePort}`,
            server: `tcp://127.0.0.1:${basePort}`
        };
    }

    if (options.sink) {
        transports.sink = {
            client: `tcp://127.0.0.1:${basePort + 1}`,
            server: `tcp://127.0.0.1:${basePort + 1}`
        };
    }

    if (options.rpc) {
        transports.rpc = {
            client: `tcp://127.0.0.1:${basePort + 2}`,
            server: `tcp://127.0.0.1:${basePort + 2}`
        };
    }

    if (options.pushpull) {
        transports.pushpull = {
            client: `tcp://127.0.0.1:${basePort + 3}`,
            server: `tcp://127.0.0.1:${basePort + 3}`
        };
    }

    return {
        transports,
        endpoints: options.endpoints || []
    };
}

module.exports = {
    waitFor,
    delay,
    createDescriptor
};
