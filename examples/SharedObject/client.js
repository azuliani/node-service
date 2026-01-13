"use strict";

/**
 * SharedObject Example - Client
 *
 * Run with: node examples/SharedObject/client.js
 * (Make sure server.js is running first)
 *
 * The client subscribes to the SharedObject and receives
 * automatic updates whenever the server calls notify().
 */

const { Client } = require("../../index");
const descriptor = require("./descriptor");

const client = new Client(descriptor);

// Called once when initial state is received
client.GameState.on('init', (data) => {
    console.log("Initial state received:");
    console.log(JSON.stringify(client.GameState.data, null, 2));
    console.log("---");
});

// Called whenever the server notifies of changes
client.GameState.on('update', (diffs) => {
    console.log("State updated. Diffs:", diffs.length);
    console.log("Current state:", JSON.stringify(client.GameState.data));
    console.log("---");
});

// Subscribe to start receiving updates
client.GameState.subscribe();

console.log("SharedObject Client running, waiting for updates...");
