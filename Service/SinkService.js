"use strict";

const EventEmitter = require("events").EventEmitter;

class SinkService extends EventEmitter {
    constructor(endpoint, transports, hostname) {
        super();
        this.endpoint = endpoint;
        this.transport = transports.sink;
        this.hostname = hostname;
        if (!this.transport)
            throw new Error("Trying to construct Sink endpoint without Source transport");
        this.stats = {updates: 0};
    }

    subscribe() {
        this.transport.connect(this.hostname);
    };

    unsubscribe() {
        this.transport.disconnect(this.hostname);
    };

    _processMessage(data) {
        this.stats.updates++;
        this.emit("message", data);
    }

    getStats(){
        const current_stats = JSON.parse(JSON.stringify(this.stats));
        this.stats.updates = 0;
        return current_stats;
    }
}


module.exports = SinkService;