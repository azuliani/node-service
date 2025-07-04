var ns = require("../../../index");

let client = new ns.Client(require("./service"));

setInterval(() => {
    client.RPCTest.call("A random number is " + Math.random(), (err, res) => {
        console.log("Received reply:", err, res);
    });
},5000)

