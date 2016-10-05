"use strict";

var doValidation = require("../misc/Validation").SourceValidation;

class SourceService{
    constructor(endpoint, transports){
        this.endpoint = endpoint;
        this.transport = transports.source;
        if (!this.transport)
            throw "Trying to construct Source endpoint without Source transport";
        this.stats = {updates: 0};
    }

    send(message){
        doValidation(this.endpoint, message);
        var OTW = {
            endpoint: this.endpoint.name,
            message: message
        };
        this.transport.send([OTW.endpoint, JSON.stringify(OTW)]);
        this.stats.updates++;
    }

    stats(){
        var current_stats = JSON.parse(JSON.stringify(this.stats));
        this.stats.updates = 0;
        return current_stats;
    }
}

module.exports = SourceService;