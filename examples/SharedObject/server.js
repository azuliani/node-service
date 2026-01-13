"use strict";

/**
 * SharedObject Example - Server
 *
 * Run with: node examples/SharedObject/server.js
 *
 * The server maintains the authoritative state and notifies
 * clients of changes via the notify() method.
 */

const { Service } = require("../../index");
const descriptor = require("./descriptor");

const initialState = {
    GameState: {
        counter: 0,
        lastUpdate: new Date(),
        players: [
            { name: "Alice", score: 0 },
            { name: "Bob", score: 0 }
        ]
    }
};

const server = new Service(descriptor, {}, initialState);

// Simulate game updates every second
setInterval(() => {
    server.GameState.data.counter++;
    server.GameState.data.lastUpdate = new Date();

    // Randomly update a player's score
    const playerIndex = Math.floor(Math.random() * server.GameState.data.players.length);
    server.GameState.data.players[playerIndex].score += Math.floor(Math.random() * 10);

    // Notify all subscribed clients of the changes
    server.GameState.notify();

    console.log("State updated:", JSON.stringify(server.GameState.data));
}, 1000);

console.log("SharedObject Server running...");
