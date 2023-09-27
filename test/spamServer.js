var service = require("../index");

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
            objectSchema: SharedObjectSchema
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
/*
initials.SO.largething = {};
for(let i = 0; i < 10000; i++) {
    initials.SO.largething[Math.floor(Math.random()*100000000).toString()] = Math.floor(Math.random()*100000000).toString();
}
*/
var s = new service.Service(descriptor, {}, initials);

/**
 * SharedObject test
 */

function thing() {

    s.SO.data.now = new Date();
    s.SO.notify(['now']);
    s.SO.data.rand = s.SO._v;//Math.random();
    s.SO.notify(['rand']);
    //s.SO.data.message = "Last thing you said was " + lastMSG;
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

setInterval(longthing, 5000);
setInterval(longthing, 3000);
setInterval(longthing, 2000);


