"use strict";

/**
 * RPC Example - Client
 *
 * Run with: node examples/RPC/client.js
 * (Make sure server.js is running first)
 */

const { Client } = require("../../index");
const descriptor = require("./descriptor");

const client = new Client(descriptor);

// Make an RPC call every 2 seconds
setInterval(() => {
    const message = "Hello at " + new Date().toISOString();

    client.Echo.call(message, (err, response) => {
        if (err) {
            console.error("Error:", err);
        } else {
            console.log("Response:", response);
        }
    });
}, 2000);

console.log("RPC Client running...");
