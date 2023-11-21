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

var s = new service.Service(descriptor, {}, initials);

var serviceNotifies = 0;
setInterval(() => {
    console.log(serviceNotifies, "service notifies");
    serviceNotifies=0;
},1000)

function thing() {
    for(let i = 0; i < 10000; i++) {
        s.SO.data.now = new Date();
        s.SO.data.rand = Math.random();
        s.SO.notify();
        serviceNotifies++;
    }
    setImmediate(thing);
}

setTimeout(() => {
    console.log("Starting the thing now.");
    thing();
},1000);

function longthing(){
    console.log("Doing longthing");
    var a = 0;
    let limit = 100000000+Math.random()*1000000000
    for(var i = 0; i<limit; i++){
        a++;
    }
    console.log("Done longthing " + a);
}


