"use strict";
var ENABLE_HEARTBEAT = true;
var HEARTBEAT_SECONDS = 500;

var zmq = require("zeromq");
var axon = require("axon");
var MonitoredSocket = require("./MonitoredSocket");

var RPCClient = require("./RPCClient");
var SourceClient = require("./SourceClient");
var SharedObjectClient = require("./SharedObjectClient");
var PullClient = require("./PullClient");
var SinkClient = require("./SinkClient");

class Client {
    constructor(descriptor, workers) {
        if (!workers) {
            workers = {}
        }

        this.workers = workers;
        this.descriptor = descriptor;
        this.transports = {};

        this._setupTransports();
        this._setupEndpoints();
    }

    _setupTransports() {
        for (let transport in this.descriptor.transports) {
            switch (transport) {
                case "source":
                    this._setupSource(this.descriptor.transports.source.client);
                    break;
                case "sink":
                    this._setupSink(this.descriptor.transports.sink.client);
                    break;
                case "rpc":
                    this._setupRpc(this.descriptor.transports.rpc.client);
                    break;
                case "pushpull":
                    this._setupPull();
                    break;
                default:
                    break;
            }
        }
    }

    _setupSource(hostname) {
        var msock = new MonitoredSocket("sub");
        this.transports.source = msock.sock;
        this.transports.source.connect(hostname);
        this._sourceHostname = hostname;
        if (ENABLE_HEARTBEAT) {
            this._setupHeartbeat();
        }
        this.transports.source.on("message", this._sourceCallback.bind(this));
        msock.on("disconnected", this._sourceClosed.bind(this));
        msock.on("connected", this._sourceConnected.bind(this));
    }

    _setupHeartbeat() {
        this["_heartbeat"] = {
            _processMessage: this._resetHeartbeatTimeout.bind(this)
        }
        this.transports.source.subscribe("_heartbeat");
    }

    _setupSink(hostname) {
        var sock = new zmq.socket("push");
        this.transports.sink = sock;
        sock.connect(hostname);
    }

    _sourceCallback(endpoint, message) {
        var data = JSON.parse(message);
        this[endpoint]._processMessage(data);
    }

    _sourceConnected() {
        if (ENABLE_HEARTBEAT) {
            this._heartbeatTimeout = setTimeout(this._heartbeatFailed.bind(this), HEARTBEAT_SECONDS * 1000);
        }
        // Loop endpoints
        for (let endpoint of this.descriptor.endpoints) {
            if (endpoint.type == "Source" || endpoint.type == "SharedObject") {
                console.log(endpoint.name, "connected");
                this[endpoint.name].emit("connected")
                if (endpoint.type == "SharedObject") {
                    if (this[endpoint.name].ready == false && this[endpoint.name].subscribed) this[endpoint.name]._init();
                }
            }
        }
    }

    _sourceClosed() {
        clearTimeout(this._heartbeatTimeout);
        // Loop endpoints
        for (let endpoint of this.descriptor.endpoints) {
            if (endpoint.type == "Source" || endpoint.type == "SharedObject") {
                console.log(endpoint.name, "disconnected");
                this[endpoint.name].emit("disconnected");
                if (endpoint.type == "SharedObject") {
                    this[endpoint.name]._flushData();
                }
            }
        }
    }

    _resetHeartbeatTimeout() {
        clearTimeout(this._heartbeatTimeout);
        this._heartbeatTimeout = setTimeout(this._heartbeatFailed.bind(this), HEARTBEAT_SECONDS * 1000);
    }

    _heartbeatFailed() {
        var endpointList = this.descriptor.endpoints.map((item) => {
            return item.name;
        }).join(",");
        console.error("Heartbeat failed source transport -> Closing connection", this._sourceHostname, endpointList);
        /*
        this.transports.source.disconnect(this._sourceHostname);
        this._sourceClosed();
        this.transports.source.connect(this._sourceHostname);
        */
        if (global.alerts) {
            global.alerts.emit("heartbeat_failed", "Heartbeat failed source transport: " + endpointList + " (this._sourceHostname)");
        }
    }

    _setupRpc(hostname) {
        var sock = new axon.socket("req");
        sock.connect(hostname);
        this.transports.rpc = sock;
    }

    _setupPull(hostname) {
        var sock = new zmq.socket("pull");
        // DON"T CONNECT! Client must explicitly ask!
        sock.on("message", this._pullCallback.bind(this));
        this.transports.pushpull = sock;
    }

    _pullCallback(message) {
        if (!this.PullEndpoint) {
            throw new Error("Got a pull message, but ot Pull enpoint is connected!");
        }

        this.PullEndpoint._processMessage(JSON.parse(message));
    }

    _setupEndpoints() {
        for (let endpoint of this.descriptor.endpoints) {
            switch (endpoint.type) {
                case "RPC":
                    this[endpoint.name] = new RPCClient(endpoint, this.transports);
                    break;
                case "Source":
                    this[endpoint.name] = new SourceClient(endpoint, this.transports);
                    break;
                case "SharedObject":
                    this[endpoint.name] = new SharedObjectClient(endpoint, this.transports);
                    this["_SO_" + endpoint.name] = this[endpoint.name];
                    break;
                case "PushPull":
                    if (this.PullEndpoint) {
                        throw new Error("Only a singly Pushpull endpoint can be constructed per service!");
                    }
                    this[endpoint.name] = new PullClient(endpoint, this.transports, this.descriptor.transports.pushpull.client);
                    this.PullEndpoint = this[endpoint.name];
                    break;
                case "Sink":
                    this[endpoint.name] = new SinkClient(endpoint, this.transports, this.descriptor.transports.sink.client);
                    this.SinkEndpoint = this[endpoint.name];
                    break;
                default:
                    throw "Unknown endpoint type.";
            }
        }
    }
}

module.exports = Client;
