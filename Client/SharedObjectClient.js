"use strict";

var assert = require("assert");
var http = require("http");
var EventEmitter = require("events").EventEmitter;
var differ = require("deep-diff");
var parseDiffDates = require("../misc/Validation").parseDiffDates;
var parseFullDates = require("../misc/Validation").parseFullDates;

const REPORTEVERY = 2000;
const OUTSTANDINGDIFFSTIMEOUT = 2000;

class SharedObjectClient extends EventEmitter {
    constructor(endpoint, transports) {
        super();
        if (!transports.rpc || !transports.source)
            throw new Error("Shared object " + endpoint.name + " needs both Source and RPC transports to be configured");

        this.endpoint = endpoint;
        this.initTransport = transports.rpc;
        this.updateTransport = transports.source;

        this._flushData();
    }

    subscribe() {
        this.updateTransport.subscribe("_SO_" + this.endpoint.name);
        setTimeout(() => { this._init() }, 1000);
    }

    unsubscribe() {
        this.updateTransport.unsubscribe("_SO_" + this.endpoint.name);
    }

    _processMessage(data) {
        if (data.endpoint === "_SO_" + this.endpoint.name) {

            var idx = data.message.v - (this._v + 1);

            if (Math.random() < 0.001) {
                //console.log("idx",idx)
            }

            if (idx < 0) {
                if (this.ready) {
                    console.error(new Date(), "(" + this.endpoint.name + ") Old version! Reinit!");
                    return this._init();
                }

                return // console.error("Received older version but only recently inited.");
            }

            this.procBuffer[idx] = data.message.diffs;
            this.timeBuffer[idx] = new Date(data.message.now);

            this.outstandingDiffs++;

            setImmediate(() => { this._tryApply() });
        }
    }

    _tryApply() {
        var totalDiffs = [];
        let now = new Date();

        let i = 0;
        while (!!this.procBuffer[i]) {

            if (!this.ready) {
                console.error(new Date(), "(" + this.endpoint.name + ") Now ready!");
                this.ready = true;
            }

            // Diffs are already reversed by Server!
            let diffs = this.procBuffer[i];
            this.outstandingDiffs--;
            safePush(totalDiffs, diffs)

            for(let diff of diffs) {
                parseDiffDates(this.endpoint, diff);
                differ.applyChange(this.data, true, diff);
            }

            this.timeSum += now - this.timeBuffer[i];
            this.timeCount++;

            this._v++;
            i++;
        }

        this.procBuffer.splice(0, i);
        this.timeBuffer.splice(0, i);

        if (totalDiffs.length > 0) {

            //setImmediate(() => { this.emit('update', totalDiffs); });
            this.emit('update', totalDiffs);

            if (this.timeCount > REPORTEVERY) {
                console.error("(" + this.endpoint.name + ") Average time: " + (this.timeSum / this.timeCount) + " ms");
                this.emit('timing', this.timeSum / this.timeCount);
                this.timeSum = 0;
                this.timeCount = 0;
            }

            if (this.outstandingDiffsTimeout) {
                console.error(new Date(), "(" + this.endpoint.name + ") Managed to process messages. Clearing the outstanding diffs timer.");
                clearTimeout(this.outstandingDiffsTimeout);
                delete this.outstandingDiffsTimeout;
            }

        } else if (this.ready && this.outstandingDiffs > 10) {
            if (!this.outstandingDiffsTimeout) {
                console.error(new Date(), "(" + this.endpoint.name + ") Too many outstanding diffs. Starting the re-init timer.");
                this.outstandingDiffsTimeout = setTimeout( () => {
                    console.error(new Date(), "(" + this.endpoint.name + ") Actually calling init now after outstanding diffs.");
                    delete this.outstandingDiffsTimeout;
                    this._init();
                }, OUTSTANDINGDIFFSTIMEOUT);
            }
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

        this._flushData();

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

                parseFullDates(self.endpoint, answer.res.data);
                self.data = answer.res.data;
                self._v = answer.res.v;

                console.error(new Date(), "(" + self.endpoint.name + ") Init installed version", self._v);

                self.procBuffer.splice(0, self._v);
                self.timeBuffer.splice(0, self._v);
                self.outstandingDiffs = 0;
                for (let i of self.procBuffer) {
                    if (!!i)
                        self.outstandingDiffs++;
                }

                //setTimeout(() => { self.ready = true; }, 30000);

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

function safePush(to, push) {
    let startIndex = to.length;
    for(let i = 0; i<push.length; i++) {
        to[startIndex+i] = push[i];
    }
}

module.exports = SharedObjectClient;
