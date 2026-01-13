"use strict";

var assert = require("assert");
var http = require("http");
var EventEmitter = require("events").EventEmitter;
const deepDiff = require("deep-diff");
var parseDiffDates = require("../misc/Validation").parseDiffDates;
var parseFullDates = require("../misc/Validation").parseFullDates;

const REPORTEVERY = 2000;
const OUTSTANDINGDIFFSTIMEOUT = 2000;

class SharedObjectClient extends EventEmitter {
    constructor(endpoint, transports, options = {}) {
        super();
        if (!transports.rpc || !transports.source)
            throw new Error("Shared object " + endpoint.name + " needs both Source and RPC transports to be configured");

        this.endpoint = endpoint;
        this.initTransport = transports.rpc;
        this.updateTransport = transports.source;
        this._initDelay = options.initDelay !== undefined ? options.initDelay : 1000;

        this._flushData();
    }

    subscribe() {
        this.updateTransport.subscribe("_SO_" + this.endpoint.name);
        setTimeout(() => { this._init() }, this._initDelay);
    }

    unsubscribe() {
        this.updateTransport.unsubscribe("_SO_" + this.endpoint.name);
        if (this.endpoint.slicedCache) {
            this.endpoint.slicedCache.clear();
        }
    }

    _processMessage(data) {
        if (data.endpoint === "_SO_" + this.endpoint.name) {

            if (!this.lastChange) {
                if (data.message.v <= this._v) {
                    return;
                }
                this.lastChange = data.message;
                this.firstChange = this.lastChange;

            } else {
                if (this.lastChange.v + 1 !== data.message.v) {
                    console.error(new Date(), "(" + this.endpoint.name + ") Have an out of order arrival! Reinit.");
                    return this._init();
                }
                this.lastChange.next = data.message;
                this.lastChange = this.lastChange.next;
            }

            this.outstandingDiffs++;

            setImmediate(() => { this._tryApply() });
        }
    }

    _tryApply() {
        var totalDiffs = [];
        let now = +(new Date());

        if (!this.firstChange || !this.ready) {
            return;
        }


        let ptr = this.firstChange;

        while (ptr) {

            // Diffs are already reversed by Server!
            let diffs = ptr.diffs;
            safePush(totalDiffs, diffs)

            for(let diff of diffs) {
                parseDiffDates(this.endpoint, diff);
            }
            deepDiff.applyDiff(this.data, diffs);

            this.timeSum += now - new Date(ptr.now);
            this.timeCount++;

            if (ptr.v !== this._v + 1){
                console.log("lele")
            }
            assert(ptr.v === this._v + 1);
            this._v++;

            ptr = ptr.next;
        }

        this.firstChange = null;
        this.lastChange = null;
        this.outstandingDiffs = 0;

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

        this.firstChange = null;
        this.lastChange = null;
        this.outstandingDiffs = 0;

        this.timeSum = 0;
        this.timeCount = 0;

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
            reply.on('data', (data) => {
                body += data;
            });
            reply.on('end', () => {
                    var answer = JSON.parse(body);

                    parseFullDates(this.endpoint, answer.res.data);
                    this.data = answer.res.data;
                    this._v = answer.res.v;

                    let ptr = this.firstChange;
                    let skipped = 0;
                    while (ptr && ptr.v <= answer.res.v) {
                        ptr = ptr.next;
                        skipped++;
                    }

                    this.firstChange = ptr;
                    this.lastChange = null;
                    this.outstandingDiffs = 0;

                    while (ptr) {
                        this.outstandingDiffs++;
                        this.lastChange = ptr;
                        ptr = ptr.next;
                    }

                    console.error(`${new Date()} (${this.endpoint.name}) Init installed version ${answer.res.v}. Skipped ${skipped} past changes. Have ${this.outstandingDiffs} outstanding changes.`);

                    this.ready = true;
                    this._tryApply();
                    this.emit('init', {v: answer.res.v, data: answer.res.data});
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
