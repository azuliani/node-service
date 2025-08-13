var ns = require("../../../index");

let handlers = {}

let initials = {
    SO: {
        rand: 0,
        now: new Date(0),
        theArray: []
    }
}

let server = new ns.Service(require("./service"), handlers, initials);


setInterval( () => {

    server.SO.data.rand = Math.random();
    server.SO.data.now = new Date();
    server.SO.data.theArray.push(server.SO.data.rand);
    server.SO.data.theArray[0] = Math.random();

    console.log("Notifying now")
    server.SO.notify();

}, 1000);
