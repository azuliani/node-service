"use strict";

/**
 * SharedObject Example - Service Descriptor
 *
 * Defines a SharedObject that maintains synchronized state between
 * server and clients. Changes on the server are automatically
 * propagated to all subscribed clients via diffs.
 */

const descriptor = {
    transports: {
        source: {
            client: "tcp://127.0.0.1:14001",
            server: "tcp://127.0.0.1:14001"
        },
        rpc: {
            client: "tcp://127.0.0.1:14002",
            server: "tcp://127.0.0.1:14002"
        }
    },
    endpoints: [
        {
            name: "GameState",
            type: "SharedObject",
            objectSchema: {
                type: 'object',
                properties: {
                    counter: { type: 'number' },
                    lastUpdate: { type: 'date' },
                    players: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                score: { type: 'number' }
                            }
                        }
                    }
                }
            }
        }
    ]
};

module.exports = descriptor;
