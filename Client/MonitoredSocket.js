"use strict";
const zmq = require("zeromq/v5-compat");
const EventEmitter = require("events").EventEmitter;

class MonitoredSocket extends EventEmitter {
    constructor(type) {
        super();
        this.sock = new zmq.socket(type);
        this.sock.on('monitor_error', this._handleError.bind(this));
        this.sock.on('disconnect', this._handleDisconnect.bind(this));
        this.sock.on('connect_retry', this._handleRetry.bind(this));
        this.sock.on('connect', this._handleConnected.bind(this));
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
        try {
            // v5-compat ignores arguments - it reads all events automatically
            this.sock.monitor();
        } catch (err) {
            // In test environments, monitor failures are non-fatal - the socket still works,
            // we just won't get ZMQ-level disconnect events.
            // The heartbeat system will still detect disconnects.
            if (process.env.NODE_ENV === 'test' && err.code === 'EADDRINUSE') {
                return;
            }
            throw err;
        }
    }

    close() {
        try {
            this.sock.unmonitor();
        } catch (err) {
            // In test environments, unmonitor failures are non-fatal during cleanup
            if (!(process.env.NODE_ENV === 'test' && err.code === 'EADDRINUSE')) {
                throw err;
            }
        }
        this.sock.close();
    }
}

module.exports = MonitoredSocket;
