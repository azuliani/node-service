"use strict";
const NS_PER_SEC = 1e9;

var http = require("http");
var EventEmitter = require("events").EventEmitter;
var differ = require("deep-diff");

const REPORTEVERY = 200;

class SharedObjectClient extends EventEmitter {
    constructor(endpoint, transports) {
        super();
        if (!transports.rpc || !transports.source)
            throw new Error("Shared object " + endpoint.name + " needs both Source and RPC transports to be configured");

        this.endpoint = endpoint;
        this.initTransport = transports.rpc;
        this.updateTransport = transports.source;
        this.subscribed = false;

        this._flushData();
    }

    subscribe() {
        this.updateTransport.subscribe("_SO_" + this.endpoint.name);
        this.subscribed = true;
        this._init();
    }

    unsubscribe() {
        this.updateTransport.unsubscribe("_SO_" + this.endpoint.name);
        this.subscribed = false;
    }

    _processMessage(data) {
        if (data.endpoint == "_SO_" + this.endpoint.name) {

            this.emit('raw', {
                v: data.message.v,
                diffs: data.message.diffs
            });

            var idx = data.message.v - (this._v + 1);
            if (this.ready && idx < 0) {
                console.error("(" + this.endpoint.name + ") Bad version! Reinit!");
                return this._init();
            }
            this.procBuffer[idx] = data.message.diffs;
            this.timeBuffer[idx] = data.message.now;
            this.outstandingDiffs++;
            process.nextTick(this._tryApply.bind(this));
        }
    }

    _tryApply() {
        var totalDiffs = [];

        while (!!this.procBuffer[0]) {
            // Diffs are already reversed by Server!
            var diffs = this.procBuffer.shift();
            this.outstandingDiffs--;
            totalDiffs = diffs.concat(totalDiffs);

            for (let diff of diffs) {
                differ.applyChange(this.data, true, diff);
            }

            this.timeSum += new Date() - this.timeBuffer.shift();
            this.timeCount++;

            this._v++;
        }

        if (totalDiffs.length > 0) {
            this.emit('update', totalDiffs);

            if (this.timeCount > REPORTEVERY) {
                console.error("(" + this.endpoint.name + ") Average time: " + (this.timeSum / this.timeCount) + " ms");
                this.emit('timing', this.timeSum / this.timeCount);
                this.timeSum = 0;
                this.timeCount = 0;
            }

        } else if (this.ready && this.outstandingDiffs > 10) {
            console.error("(" + this.endpoint.name + ") Too many outstanding diffs, missed a version. Reinit.");
            this._init();
        }
    }

    _flushData() {
        this.data = {};
        this._v = 0;
        this.procBuffer = [];
        this.timeBuffer = [];

        this.timeSum = 0;
        this.timeCount = 0;

        this.outstandingDiffs = 0;

        this.ready = false;
    }

    _init() {

        this.data = {};
        this._v = 0;
        this.procBuffer = [];
        this.timeBuffer = [];

        this.timeSum = 0;
        this.timeCount = 0;

        this.outstandingDiffs = 0;

        this.ready = false;

        var postData = JSON.stringify({
            endpoint: "_SO_" + this.endpoint.name,
            input: "init"
        });
        var options = {
            hostname: this.initTransport.hostname,
            port: this.initTransport.port,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        var self = this;
        var req = http.request(options, (reply) => {
            var body = "";
            reply.on('data', function (data) {
                body += data;
            });
            reply.on('end', function () {
                var answer = JSON.parse(body);
                self.data = answer.res.data;
                self._v = answer.res.v;
                console.log("(" + self.endpoint.name + ") Init installed version", self._v);
                self.procBuffer.splice(0, self._v);
                self.timeBuffer.splice(0, self._v);
                self.outstandingDiffs = 0;
                for (let i of self.procBuffer) {
                    if (!!i)
                        self.outstandingDiffs++;
                }
                self.ready = true;
                self._tryApply();
                self.emit('init', {v: answer.res.v, data: answer.res.data});
            });
        });

        var self = this;
        req.on('error', (e) => {
            console.error(`problem with request: ${e.message}`);
            setTimeout(self._init.bind(self), 1000); // Retry after a second
        });
        req.write(postData);
        req.end();
    }
}

module.exports = SharedObjectClient;