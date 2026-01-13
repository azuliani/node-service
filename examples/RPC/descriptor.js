"use strict";

/**
 * RPC Example - Service Descriptor
 *
 * Defines an Echo RPC endpoint that accepts a string and returns
 * an object with the echoed message and a timestamp.
 */

const descriptor = {
    transports: {
        rpc: {
            client: "tcp://127.0.0.1:14000",
            server: "tcp://127.0.0.1:14000"
        }
    },
    endpoints: [
        {
            name: "Echo",
            type: "RPC",
            requestSchema: {
                type: 'string'
            },
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

module.exports = descriptor;
