"use strict";

const zmq = require("zeromq/v5-compat");
const MonitoredSocket = require("./MonitoredSocket");

const RPCClient = require("./RPCClient");
const SourceClient = require("./SourceClient");
const SharedObjectClient = require("./SharedObjectClient");
const PullClient = require("./PullClient");
const SinkClient = require("./SinkClient");

class Client {
    constructor(descriptor, options = {}){
        // options.initDelay - Delay in ms before SharedObjectClient calls _init() after subscribe().
        //                     Allows time to receive queued diffs before fetching full state.
        //                     Default: 100ms
        this.descriptor = descriptor;
        this.transports = {};
        this._options = options;

        // Timestamp-based heartbeat tracking
        this._lastSourceMessageTime = null;      // Updated on EVERY source message (O(1))
        this._serverHeartbeatFrequencyMs = null; // Learned from first heartbeat
        this._heartbeatCheckInterval = null;     // Periodic check interval
        this._isSourceConnected = false;         // Track connection state

        this.sourceDisconnections = {};

        this._setupTransports();
        this._setupEndpoints();
    }

    _setupTransports(){
        for(let transport in this.descriptor.transports){
            switch (transport){
                case 'source':
                    this._setupSource(this.descriptor.transports.source.client);
                    break;
                case 'sink':
                    this._setupSink(this.descriptor.transports.sink.client);
                    break;
                case 'rpc':
                    this._setupRpc(this.descriptor.transports.rpc.client);
                    break;
                case 'pushpull':
                    this._setupPull();
                    break;
                default:
                    break;
            }
        }
    }

    _setupSource(hostname){
        this._monitoredSource = new MonitoredSocket('sub');
        this.transports.source = this._monitoredSource.sock;

        this.transports.source.connect(hostname);
        this._sourceHostname = hostname;
        this.transports.source.on('message', this._sourceCallback.bind(this));
        this._monitoredSource.on('disconnected', this._sourceClosed.bind(this));
        this._monitoredSource.on('connected', this._sourceConnected.bind(this));

        // Subscribe to heartbeat channel
        this.transports.source.subscribe('_heartbeat');
    }

    _setupSink(hostname){
        const sock = new zmq.socket('push');
        this.transports.sink = sock;
        sock.connect(hostname);
    }

    _sourceCallback(endpoint, message){
        // O(1) timestamp update - MUST be first, before any parsing
        this._lastSourceMessageTime = Date.now();

        // Mark as connected when we receive messages (more reliable than ZMQ monitor)
        if (!this._isSourceConnected) {
            this._isSourceConnected = true;
            // Emit connected events for endpoints
            for (let ep of this.descriptor.endpoints) {
                if (ep.type === 'Source' || ep.type === 'SharedObject') {
                    console.error(ep.name, 'connected');
                    this[ep.name].emit('connected');
                    // Re-init SharedObjects that were disconnected
                    if (ep.type === 'SharedObject' && this.sourceDisconnections[ep.name]) {
                        this[ep.name]._init();
                        delete this.sourceDisconnections[ep.name];
                    }
                }
            }
        }

        // Handle heartbeat specially
        if (endpoint.toString() === '_heartbeat') {
            this._processHeartbeat(JSON.parse(message));
            return;
        }

        const data = JSON.parse(message);
        this[endpoint]._processMessage(data);
    }

    _processHeartbeat(data) {
        // Lazy activation: learn frequency from first heartbeat
        if (this._serverHeartbeatFrequencyMs === null && data.frequencyMs) {
            this._serverHeartbeatFrequencyMs = data.frequencyMs;
            this._startHeartbeatChecking();
        }
    }

    _startHeartbeatChecking() {
        // Check once per heartbeat period
        this._heartbeatCheckInterval = setInterval(() => {
            this._checkHeartbeatTimeout();
        }, this._serverHeartbeatFrequencyMs);
    }

    _checkHeartbeatTimeout() {
        if (this._lastSourceMessageTime === null || !this._isSourceConnected) {
            return;
        }

        const timeSinceLastMessage = Date.now() - this._lastSourceMessageTime;
        const timeoutThreshold = this._serverHeartbeatFrequencyMs * 3;

        if (timeSinceLastMessage > timeoutThreshold) {
            this._heartbeatFailed();
        }
    }

    _sourceConnected(){
        // Idempotent - may already be marked connected by _sourceCallback
        if (this._isSourceConnected) return;
        this._isSourceConnected = true;
        this._lastSourceMessageTime = Date.now();  // Reset on reconnect

        for(let endpoint of this.descriptor.endpoints) {
            if (endpoint.type === 'Source' || endpoint.type === 'SharedObject') {
                console.error(endpoint.name, 'connected');
                this[endpoint.name].emit('connected');
                if (endpoint.type === 'SharedObject' && this.sourceDisconnections[endpoint.name]) {
                    // _init() now guards against being called when not subscribed
                    this[endpoint.name]._init();
                    delete this.sourceDisconnections[endpoint.name];
                }
            }
        }
    }

    _sourceClosed(){
        // Idempotent - prevent double-firing
        if (!this._isSourceConnected) return;
        this._isSourceConnected = false;

        for(let endpoint of this.descriptor.endpoints) {
            if (endpoint.type === 'Source' || endpoint.type === 'SharedObject') {
                console.error(endpoint.name, 'disconnected');
                this[endpoint.name].emit('disconnected');
                if (endpoint.type === 'SharedObject') {
                    this[endpoint.name]._emitDisconnectDiffs();  // BEFORE flush
                    this[endpoint.name]._flushData();
                    this.sourceDisconnections[endpoint.name] = true;
                }
            }
        }
    }

    _heartbeatFailed(){
        console.error('Heartbeat failed source transport -> Closing connection', this._sourceHostname, this.descriptor.endpoints.map((item)=>{return item.name}).join(','));
        this.transports.source.disconnect(this._sourceHostname)
        this._sourceClosed();
        this.transports.source.connect(this._sourceHostname)
    }

    _setupRpc(origHostname) {
        const hostnameAndPort = origHostname.split(":");
        const hostname = hostnameAndPort[1].substr(2);
        const port = hostnameAndPort[2];
        this.transports.rpc = {hostname, port};
    }

    _setupPull(hostname){
        const sock = new zmq.socket("pull");
        // DON'T CONNECT! Client must explicitly ask!
        sock.on('message', this._pullCallback.bind(this));
        this.transports.pushpull = sock;
    }

    _pullCallback(message){
        if (!this.PullEndpoint){
            throw new Error("Got a pull message, but ot Pull enpoint is connected!");
        }

        this.PullEndpoint._processMessage(JSON.parse(message));
    }

    _setupEndpoints(){
        for(let endpoint of this.descriptor.endpoints){
            switch(endpoint.type){
                case 'RPC':
                    this[endpoint.name] = new RPCClient(endpoint, this.transports);
                    break;
                case 'Source':
                    this[endpoint.name] = new SourceClient(endpoint, this.transports);
                    break;
                case 'SharedObject':
                    this[endpoint.name] = new SharedObjectClient(endpoint, this.transports, this._options);
                    this['_SO_'+endpoint.name] = this[endpoint.name];
                    break;
                case 'PushPull':
                    if (this.PullEndpoint){
                        throw new Error("Only a singly Pushpull endpoint can be constructed per service!");
                    }
                    this[endpoint.name] = new PullClient(endpoint, this.transports, this.descriptor.transports.pushpull.client);
                    this.PullEndpoint = this[endpoint.name];
                    break;
                case 'Sink':
                    this[endpoint.name] = new SinkClient(endpoint, this.transports, this.descriptor.transports.sink.client);
                    this.SinkEndpoint = this[endpoint.name];
                    break;
                default:
                    throw "Unknown endpoint type.";
            }
        }
    }

    close() {
        if (this._heartbeatCheckInterval) {
            clearInterval(this._heartbeatCheckInterval);
            this._heartbeatCheckInterval = null;
        }
        if (this._monitoredSource) {
            this._monitoredSource.close();
        }
        if (this.transports.sink) {
            this.transports.sink.close();
        }
        if (this.transports.pushpull) {
            this.transports.pushpull.close();
        }
    }
}

module.exports = Client;
