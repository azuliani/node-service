"use strict";

var assert = require("assert");

var doValidation = require("../misc/Validation").RPCValidation;

class RPCService{
    constructor(endpoint, handler){
        this.endpoint = endpoint;
        this.handler = handler;
        this.stats = {updates: 0};
    }

    call(data, callback){
        assert(this.endpoint.name === data.endpoint);

        doValidation(this.endpoint, 'input', data.input, true);

        this.stats.updates++;

        this.handler(data.input, (err, res) => {

            if (!err){
                doValidation(this.endpoint, 'output', res, false);
            }

            var reply = JSON.stringify({err,res});
            callback(reply);
        });
    }

    getStats(){
        var current_stats = JSON.parse(JSON.stringify(this.stats));
        this.stats.updates = 0;
        return current_stats;
    }
}

module.exports = RPCService;