"use strict";

/**
 * RPC Example - Server
 *
 * Run with: node examples/RPC/server.js
 */

const { Service } = require("../../index");
const descriptor = require("./descriptor");

const handlers = {
    Echo: function(request, reply) {
        console.log("Received:", request);
        reply(null, {
            message: "You said: " + request,
            timestamp: new Date()
        });
    }
};

const server = new Service(descriptor, handlers, {});
console.log("RPC Server running...");
