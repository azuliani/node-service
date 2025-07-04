var ns = require("../../../index");

let handlers = {}

let initials = {
    SO: {
        rand: 0,
        now: new Date(0)
    }
}

let server = new ns.Service(require("./service"), handlers, initials);


setInterval( () => {

    server.SO.data.rand = Math.random();
    server.SO.data.now = new Date();

    console.log("Notifying now")
    server.SO.notify();

}, 1000);
