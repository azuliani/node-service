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

var c = new service.Client(descriptor);

/**
 * SharedObject test
 */

c.SO.on('init',()=>{
    console.log("Client object was initialised:",c.SO.data);
});

c.SO.on('update',(oldVal, newVal, diffs) => {
    //console.log("Client object was updated:", c.SO.data);
    var a = 0;
    //for(var i = 0; i<50000000; i++){
    //    //a++;
    //}
});

c.SO.subscribe()

setInterval(() => {
    console.log("DATA",new Date(), c.SO.data);
}, 5000);

/*
setInterval(function(){
    console.log("Doing longthing");
    var a = 0;
    for(var i = 0; i<1000000000; i++){
        a++;
    }
    console.log("Done longthing " + a);
},5000);
*/
