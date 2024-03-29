"use strict";

var util = require("util");

var service = require("../index");

var RPCTestRequestSchema = {
    type: 'string'
};

var RPCTestReplySchema = {
    type: 'object',
    properties: {
        msg: {
            type: 'string',
            pattern: /You said .*/
        },
        date: {
            type: 'date'
        }
    }
};

var SourceSchema = {
    type: 'object',
    properties: {
        message: {
            type: 'string'
        },
        rand: {
            type: 'number'
        },
        arr: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    "*": {type: "date"}
                }
            }
        }
    }
};

var SharedObjectSchema = {
    type: 'object',
    properties: {
        message: {
            type: 'string',
            pattern: /Last thing you said was .*/
        },
        rand: {
            type: 'number'
        },
        now: {
            type: 'date'
        },
        subObjs: {
            type: "object",
            properties: {
                '*': {type: "object",
                    properties: {
                        notADate: {type: "number"},
                        isADate: {type: "date"}
                    }}
            }
        },
        subArr: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    thing: {type:"string"},
                    dates: {
                        type: "object",
                        properties: {
                            '*': {type: "date"}
                        }
                    }
                }
            }
        },
        oneObj:{
            type: "object",
            properties: {
                maybeADate: {type: "string"}
            }
        },
        twoObj:{
            type: "object",
            properties: {
                maybeADate: {type: "date"}
            }
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
            name: "RPCTest",
            type: "RPC",
            requestSchema: RPCTestRequestSchema,
            replySchema: RPCTestReplySchema
        },
        {
            name: "Sourcetest",
            type: "Source",
            messageSchema: SourceSchema
        },
        {
            name: "SO",
            type: "SharedObject",
            objectSchema: SharedObjectSchema
        }
    ]
};

var lastMSG = "*NOTHING*";

function RPCHandler(req, rep) {
    console.log("Handler called");
    lastMSG = req;
    rep(null, {
        msg: "You said " + req,
        date: new Date()
    });
}

var handlers = {
    RPCTest: RPCHandler
};

var initials = {
    SO: {
        message: "Last thing you said was *NOTHING*",
        rand: 0,
        now: new Date(),
        subObjs: {
            first: {
                notADate: 1234,
                isADate: new Date()
            }
        },

        oneObj: {
            maybeADate: "Nope, a string"
        },
        twoObj: {
            maybeADate: new Date()
        },

        subArr: [
            {
                thing: "initial",
                dates: {
                    id: new Date(),
                    blablie: new Date(0)
                }
            }
        ]
    }
};

var c = new service.Client(descriptor);
// Should error with timeout
console.log('Should error with timeout after 10 sec');
c.RPCTest.call("Hello", function (err, res) {
    if (err) {
        console.error('Error:', err);
    } else
        console.log("Server answered:", res);
    var s = new service.Service(descriptor, handlers, initials);

    c.Sourcetest.subscribe();
    /**
     * RPC Test
     */

    setTimeout(()=> {
        c.RPCTest.call("Hello", function (err, res) {
            console.log("Server answered:", res);
        });
    }, 5000);

    setTimeout(() => {
        s.SO.data.subObjs.second = {notADate: 87654, isADate: new Date()};
        s.SO.data.subArr.push({
            thing: "secondary",
            dates: {
                id: new Date(),
                blie: new Date(0)
            }
        });
        s.SO.data.subArr[0].dates.blablie = new Date();
        s.SO.notify();
        //s.SO.notify(["subObjs"], true);
    }, 3000);

    setTimeout(() => {
        s.SO.data.subArr = s.SO.data.subArr.slice(1);
        s.SO.data.subArr[0].dates.blablie = new Date();
        s.SO.notify();

        s.SO.data.oneObj.maybeADate = "No, this is a string";
        s.SO.notify(["oneObj"])
        //s.SO.notify(["subObjs"], true);
    }, 3000);

    /**
     * Source test
     */

    c.Sourcetest.on('message', function (msg) {
        //console.log("Got a message:", msg);
    });

    setInterval(function () {
        s.Sourcetest.send({
            message: "This is a message",
            rand: Math.random(),
            arr: [{dit:new Date(), ori: new Date(0)},{dat:new Date(123000), bloe: new Date(900000)}]
        });
    }, 2000);


    /**
     * SharedObject test
     */

    setTimeout(() => {
        console.log("Making the client now");

        c.SO.on('init', ()=> {
            console.log("Client object was initialised:", c.SO.data);
        });

        c.SO.on('update', (diffs) => {
            console.log("Client object was updated:", util.inspect(diffs, false, null, true));
            console.log(util.inspect(c.SO.data, false, null, true));
        });
        c.SO.subscribe()
    }, 1000);

    setInterval(function () {
        s.SO.data.rand = Math.random();
        s.SO.data.now = new Date();
        s.SO.data.message = "Last thing you said was " + lastMSG;
        //s.SO.notify(['rand'], true);
        //s.SO.notify(['somethingstupid']);
        //s.SO.notify();
    }, 1000);
});


