var ns = require("../../../index");

let handlers = {
    RPCTest: function (req, rep) {
        console.log("Received call:", req);
        rep(null, {msg: "You said " + req, date: new Date()});
    }
}

let server = new ns.Service(require("./service"), handlers, {});
