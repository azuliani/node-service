"use strict";
var zmq = require("zeromq/v5-compat");
var EventEmitter = require("events").EventEmitter;

class MonitoredSocket extends EventEmitter {
    constructor(type) {
        super();
        this.sock = new zmq.socket(type);
        // Handle monitor error
        this.sock.on('monitor_error', this._handleError.bind(this));
        this.sock.on('disconnect', this._handleDisconnect.bind(this));
        this.sock.on('connect_retry', this._handleRetry.bind(this));
        this.sock.on('connect', this._handleConnected.bind(this));
        // Start monitoring
        this._monitorSocket();
    }

    _handleError(err) {
        console.error('Error in monitoring: %s, will restart monitoring in 5 seconds', err);
        setTimeout(this._monitorSocket.bind(this), 5000);
    }

    _handleDisconnect(fd, endpoint){
        this.emit('disconnected');
    }

    _handleRetry(fd, endpoint){
        this.emit('connect_retry');
    }

    _handleConnected(fd, endpoint){
        this.emit('connected');
    }

    _monitorSocket(){
        this.sock.monitor();
    }
}

module.exports = MonitoredSocket;
