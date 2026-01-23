"use strict";

const assert = require("assert");
const http = require("http");
const EventEmitter = require("events").EventEmitter;
const deepDiff = require("deep-diff");
const parseDiffDates = require("../misc/Validation").parseDiffDates;
const parseFullDates = require("../misc/Validation").parseFullDates;

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
        this._initDelay = options.initDelay ?? 100;

        // Connection and subscription state
        this._connected = false;
        this._subscribed = false;
        this._initTimeout = null;  // Tracks pending init/retry timeouts

        // Listen to events emitted by parent Client
        this.on('connected', () => { this._connected = true; });
        this.on('disconnected', () => { this._connected = false; });

        this._flushData();
    }

    get connected() {
        return this._connected;
    }

    get subscribed() {
        return this._subscribed;
    }

    subscribe() {
        this._subscribed = true;
        this.updateTransport.subscribe("_SO_" + this.endpoint.name);
        this._initTimeout = setTimeout(() => { this._init() }, this._initDelay);
    }

    unsubscribe() {
        this._subscribed = false;
        if (this._initTimeout) {
            clearTimeout(this._initTimeout);
            this._initTimeout = null;
        }
        this.updateTransport.unsubscribe("_SO_" + this.endpoint.name);
        if (this.endpoint.slicedCache) {
            this.endpoint.slicedCache.clear();
        }
    }

    _processMessage(data) {
        if (data.endpoint === "_SO_" + this.endpoint.name) {
            // During init (!ready): queue ALL messages regardless of version.
            // When init snapshot arrives, messages with v <= snapshot are discarded,
            // and remaining messages are applied in order.
            //
            // After init (ready): require sequential versioning. Gaps trigger reinit.

            if (this.ready) {
                // Post-init: enforce sequential versioning
                const expectedVersion = this.lastChange ? this.lastChange.v + 1 : this._v + 1;

                // Skip stale messages (already processed, can arrive after re-init)
                if (!this.lastChange && data.message.v <= this._v) {
                    return;
                }

                // Version gap detected - reinit to recover
                if (data.message.v !== expectedVersion) {
                    console.error(new Date(), "(" + this.endpoint.name + ") Out of order message! Expected v=" + expectedVersion + ", got v=" + data.message.v + ". Reinit.");
                    return this._init();
                }
            }

            // Link message into queue (always, during init; sequentially verified, after init)
            if (!this.lastChange) {
                this.firstChange = data.message;
            } else {
                this.lastChange.next = data.message;
            }
            this.lastChange = data.message;

            this.outstandingDiffs++;

            setImmediate(() => { this._tryApply() });
        }
    }

    _tryApply() {
        const totalDiffs = [];
        const now = +(new Date());

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

            if (ptr.v !== this._v + 1) {
                console.error(JSON.stringify(diffs,))
            }

            assert(ptr.v === this._v + 1, `(${this.endpoint.name}) SO Version mismatch: expected ptr.v=${this._v + 1}, got ptr.v=${ptr.v} (current this._v=${this._v})`);
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

    _emitDisconnectDiffs() {
        // Generate synthetic diffs showing all properties deleted
        const diffs = [];
        for (const key of Object.keys(this.data)) {
            diffs.push({
                kind: 'D',           // Deletion
                path: [key],
                lhs: this.data[key]  // The value being deleted
            });
        }
        if (diffs.length > 0) {
            this.emit('update', diffs);
        }
    }

    _init() {
        // Don't re-init if user has unsubscribed
        if (!this._subscribed) {
            return;
        }

        this._flushData();

        const postData = JSON.stringify({
            endpoint: "_SO_" + this.endpoint.name,
            input: "init"
        });
        const options = {
            hostname: this.initTransport.hostname,
            port: this.initTransport.port,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const self = this;
        const req = http.request(options, (reply) => {
            let body = "";
            reply.on('data', (data) => {
                body += data;
            });
            reply.on('end', () => {
                    const answer = JSON.parse(body);

                    parseFullDates(this.endpoint, answer.res.data);
                    this.data = answer.res.data;
                    this._v = answer.res.v;

                    let ptr = this.firstChange;
                    let skipped = 0;
                    while (ptr && ptr.v <= answer.res.v) {
                        ptr = ptr.next;
                        skipped++;
                    }

                    this.firstChange = ptr || null;
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

        req.on('error', (e) => {
            console.error(`problem with request: ${e.message}`);
            self._initTimeout = setTimeout(self._init.bind(self), 1000); // Retry after a second
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
