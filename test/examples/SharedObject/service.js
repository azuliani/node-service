"use strict";

var SharedObjectSchema = {
    type: 'object',
    properties:{
        rand: {
            type: 'number'
        },
        now: {
            type: 'date'
        },
        theArray: {
            type: 'array',
            items: {
                type: 'number'
            }
        }
    }
};

var descriptor = {
    transports: {
        source: {
            client: "tcp://127.0.0.1:14001",
            server: "tcp://127.0.0.1:14001"
        },
        sink: {
            client: "tcp://127.0.0.1:14002",
            server: "tcp://127.0.0.1:14002"
        },
        rpc: {
            client: "tcp://127.0.0.1:14003",
            server: "tcp://127.0.0.1:14003"
        }
    },
    endpoints: [
        {
            name: "SO",
            type: "SharedObject",
            objectSchema: SharedObjectSchema
        }
    ]
};

module.exports = descriptor;
