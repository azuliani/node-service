"use strict";

var RPCTestRequestSchema = {
    type: 'string'
};

var RPCTestReplySchema = {
    type: 'object',
    properties: {
        msg: {
            type: 'string',
            //pattern: /You said .*/
        },
        date: {
            type: 'date'
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
            name: "RPCTest",
            type: "RPC",
            requestSchema: RPCTestRequestSchema,
            replySchema: RPCTestReplySchema
        },
        /*
        {
            name: "SO",
            type: "SharedObject",
            objectSchema: SharedObjectSchema
        }
         */
    ]
};


module.exports = descriptor;
