var service = require("../../index");

var SharedObjectSchema = {
    type: 'object',
    properties:{
        message: {
            type: 'string',
            pattern: /Last thing you said was .*/
        },
        rand: {
            type: 'number'
        },
        now: {
            type: 'date'
        }
    }
};

var descriptor = {
    transports: {
        source: {
            client: "tcp://127.0.0.1:14001",
            server: "tcp://127.0.0.1:14001"
        },
        sink: {
            client: "tcp://127.0.0.1:14002",
            server: "tcp://127.0.0.1:14002"
        },
        rpc: {
            client: "tcp://127.0.0.1:14003",
            server: "tcp://127.0.0.1:14003"
        }
    },

    endpoints: [
        {
            name: "SO",
            type: "SharedObject",
            objectSchema: {skip: true}
        }
    ]
};

var lastMSG = "*NOTHING*";
var initials = {
    SO: {
        message: "Last thing you said was *NOTHING*",
        rand: 0,
        now: new Date()
    }
};

var c = new service.Client(descriptor);
c.SO.subscribe();


var updateCalls = 0;
var receivedDiffs = 0;

c.SO.on('update', (diffs)=> {
    updateCalls++;
    receivedDiffs += diffs.length;
});

setInterval(() => {
    console.log(receivedDiffs, "diffs in", updateCalls, "calls");
    updateCalls = 0;
    receivedDiffs = 0;
},1000)

setTimeout(() => {
    console.log("Locking up for a bit");
    let x = 10;
    for(let i=0; i < 1000000000; i++) {
        x++
    }
},10000)
