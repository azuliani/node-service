"use strict";

var zmq = require("zeromq/v5-compat");
var http = require("http");
var EventEmitter = require("events").EventEmitter;

var RPCService = require("./RPCService");
var SourceService = require("./SourceService");
var SharedObjectService = require("./SharedObjectService");
var PushService = require("./PushService");
var SinkService = require("./SinkService");

class Service {
    constructor(descriptor, handlers, initials) {
        this.descriptor = descriptor;
        this.transports = {};
        this.handlers = handlers || {};
        this.initials = initials || {};

        this._setupTransports();
        this._setupEndpoints();
    }

    _setupTransports() {
        for (let transport in this.descriptor.transports) {
            switch (transport) {
                case 'source':
                    this._setupSource(this.descriptor.transports.source.server);
                    break;
                case 'sink':
                    this._setupSink(this.descriptor.transports.sink.server);
                    break;
                case 'rpc':
                    this._setupRpc(this.descriptor.transports.rpc.server);
                    break;
                case 'pushpull':
                    this._setupPushPull(this.descriptor.transports.pushpull.server);
                    break;
                default:
                    break;
            }
        }
    }

    _setupSource(hostname) {
        var sock = new zmq.socket('pub');

        sock.setsockopt(zmq.ZMQ_SNDHWM, 10000);
        sock.setsockopt(zmq.ZMQ_LINGER, 0);
        sock.setsockopt(39, 1); // ZMQ_IMMEDIATE

        this.transports.source = sock;
        sock.bind(hostname);
        this._setupHeartbeat();
    }

    _setupHeartbeat() {
        this._heartbeatInterval = setInterval(this._sendHeartbeat.bind(this), 5 * 1000);
    }

    _sendHeartbeat() {
        var OTW = {
            endpoint: '_heartbeat'
        };
        this.transports.source.send([OTW.endpoint, JSON.stringify(OTW)]);
    }

    _setupSink(hostname) {
        var sock = new zmq.socket('pull');
        this.transports.sink = sock;

        sock.bind(hostname);
        sock.on('message', this._sinkCallback.bind(this));
    }

    _sinkCallback(message) {
        if (!this.SinkEndpoint) {
            throw new Error("Got a pull message, but ot Pull enpoint is connected!");
        }
        this.SinkEndpoint._processMessage(JSON.parse(message));
    }

    _setupRpc(hostname) {
        this.transports.rpc = new EventEmitter();

        var hostnameAndPort = hostname.split(":");
        var url = hostnameAndPort[1].substr(2);
        var port = hostnameAndPort[2];
        this._httpServer = http.createServer(this._rpcCallback.bind(this));
        this._httpServer.listen(port, url);
    }

    _rpcCallback(req, res) {
        if (req.method == 'POST') {
            var body = "";
            req.on('data', function (data) {
                body += data;
            });
            var self = this;
            req.on('end', function () {
                res.writeHead(200, {'Content-Type': 'application/json'});
                var req = JSON.parse(body);
                var handler = self.RPCServices[req.endpoint];
                if (handler) { // Could be SharedObject, has a different callback
                    handler.call(req, (result) => {
                        res.end(result);
                    });
                }else{
                    self.transports.rpc.emit("message", req, (result)=>{
                        res.end(JSON.stringify(result));
                    })
                }
            });
        }
        else {
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end("-");
        }

    }

    _setupPushPull(hostname) {
        var sock = new zmq.socket('push');
        sock.bind(hostname);
        this.transports.pushpull = sock;
    }

    _setupEndpoints() {
        this.RPCServices = {};

        for (let endpoint of this.descriptor.endpoints) {
            switch (endpoint.type) {
                case 'RPC':
                    var handler = this.handlers[endpoint.name];
                    if (!handler)
                        throw "Missing handler: " + endpoint.name;
                    this.RPCServices[endpoint.name] = new RPCService(endpoint, handler);
                    break;
                case 'Source':
                    this[endpoint.name] = new SourceService(endpoint, this.transports);
                    break;
                case 'SharedObject':
                    this[endpoint.name] = new SharedObjectService(endpoint, this.transports, this.initials[endpoint.name]);
                    break;
                case 'PushPull':
                    this[endpoint.name] = new PushService(endpoint, this.transports);
                    break;
                case 'Sink':
                    this[endpoint.name] = new SinkService(endpoint, this.transports);
                    this.SinkEndpoint = this[endpoint.name];
                    break;
                default:
                    throw "Unknown endpoint type";
            }
        }
    }

    close() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
        }
        if (this._httpServer) {
            this._httpServer.close();
        }
        if (this.transports.source) {
            this.transports.source.close();
        }
        if (this.transports.sink) {
            this.transports.sink.close();
        }
        if (this.transports.pushpull) {
            this.transports.pushpull.close();
        }
    }
}

module.exports = Service;
