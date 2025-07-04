var nodeservice = require("../../../index");

var c = new nodeservice.Client(require("./service"));

c.SO.on('init',()=>{
    console.log("Client object was initialised:",c.SO.data);
});

c.SO.on('update',(diffs) => {
    console.log("Client object was updated:", c.SO.data);
});

c.SO.subscribe();
