"use strict";

var EventEmitter = require("events").EventEmitter;
var doValidate = require("../misc/Validation").SourceValidation;

class SourceClient extends EventEmitter{
    constructor(endpoint, transports){
        super();
        this.endpoint = endpoint;
        this.transport = transports.source;
        if (!this.transport)
            throw "Trying to construct Source endpoint without Source transport";
    }

    subscribe(){
        this.transport.subscribe(this.endpoint.name);
    };

    unsubscribe(){
        this.transport.unsubscribe(this.endpoint.name);
    };
    _processMessage(data){
        if (this.endpoint.name === data.endpoint){
            doValidate(this.endpoint, data.message, true);
            this.emit('message', data.message);
        }
    }
}

module.exports = SourceClient;