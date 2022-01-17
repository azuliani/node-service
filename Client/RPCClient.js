"use strict";

var http = require('http');
var doValidation = require("../misc/Validation").RPCValidation;

class RPCClient {
    constructor(endpoint, transports) {
        this.transport = transports.rpc;
        this.endpoint = endpoint;
        if (!this.transport)
            throw "Trying to initialise an RPC service without RPC config!";
    }

    call(input, timeout, callback) {
        var self = this;
        if (!callback) { // Make compatible with old code
            callback = timeout;
            timeout = 10e3;
        }

        doValidation(this.endpoint, 'input', input, false);

        var answer_received = false;
        var answer_timeout = setTimeout(() => {
            if (!answer_received)
                callback('timeout');
            callback = null;
            answer_received = null;
        }, timeout);
        var postData = JSON.stringify({
            endpoint: this.endpoint.name,
            input: input
        });
        var options = {
            hostname: this.transport.hostname,
            port: this.transport.port,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        var req = http.request(options, (answer) => {
            answer_received = true;
            clearTimeout(answer_timeout);
            answer_timeout = null;

            var body = "";
            answer.on('data', function (data) {
                body += data;
            });
            answer.on('end', function () {
                var answer = JSON.parse(body);

                if (!answer.err) {
                    doValidation(self.endpoint, 'output', answer.res, true);
                }

                if (callback) {
                    callback(answer.err, answer.res);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`problem with request: ${e.message}`);
            answer_received = true;
            clearTimeout(answer_timeout);
            answer_timeout = null;

            if(callback) {
                callback(e.message);
                callback = null;
            }
        });
        req.write(postData);
        req.end();
    }
}

module.exports = RPCClient;

