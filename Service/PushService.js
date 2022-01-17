"use strict";

var doValidation = require("../misc/Validation").SinkValidation;

class SourceService{
    constructor(endpoint, transports){
        this.endpoint = endpoint;
        this.transport = transports.pushpull;
        if (!this.transport)
            throw "Trying to construct PushPull endpoint without pushpull transport";
        this.stats = {updates: 0};
    }

    push(message){
        doValidation(this.endpoint, message);

        var OTW = message;
        this.transport.send(JSON.stringify(OTW));
        this.stats.updates++;
    }

    getStats(){
        var current_stats = JSON.parse(JSON.stringify(this.stats));
        this.stats.updates = 0;
        return current_stats;
    }
}

module.exports = SourceService;