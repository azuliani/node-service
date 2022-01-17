"use strict";

var assert = require("assert");
var inspector = require("schema-inspector");

function RPCValidation(endpoint, inout, obj, parseDates){
    assert(parseDates === true || parseDates === false);
    let schema;
    let datePaths;

    if (inout === "input") {
        schema = endpoint.requestSchema;
        if (!endpoint.inDatePaths) {
            endpoint.inDatePaths = extractDatepaths(schema);
        }
        datePaths = endpoint.inDatePaths;

    } else if (inout === "output") {
        schema = endpoint.replySchema;
        if (!endpoint.outDatePaths) {
            endpoint.outDatePaths = extractDatepaths(schema);
        }
        datePaths = endpoint.outDatePaths;
    } else {
        throw new Error("doValidation called with wrong argument");
    }

    if (parseDates && datePaths.length) {
        for(let path of datePaths) {
            applyDatepath(path, obj);
        }
    }

    if (!schema){
        console.error("There's no schema for RPC Call " + endpoint.name + ". Fix this!");
    } else {
        var validation = inspector.validate(schema, obj);
        if (!validation.valid){
            throw new Error("Validation failed! " + validation.format());
        }
    }
}

function SourceSinkValidation(endpoint, obj, parseDates){
    assert(parseDates === true || parseDates === false);

    var schema = endpoint.messageSchema;

    if(schema.skip){
        return
    }

    if (schema && !endpoint.datePaths) {
        endpoint.datePaths = extractDatepaths(schema);
    }

    if (!schema){
        console.error("There's no schema for Source/Sink " + endpoint.name + ". Fix this!");
    }

    if (parseDates && endpoint.datePaths && endpoint.datePaths.length) {
        for(let path of endpoint.datePaths) {
            applyDatepath(path, obj);
        }
    }

    var validation = inspector.validate(schema, obj);

    if (!validation.valid){
        throw new Error("Validation failed! " + validation.format());
    }
}

function SharedObjectValidation(endpoint, obj, hint){

    if (!endpoint.objectSchema){
        console.error("There's no schema for SharedObject " + endpoint.name + ". Fix this!");
    }

    if (!hint) {
        hint = [];
    }

    // Check if we need to run validation
    if(endpoint.objectSchema.skip){
        return
    }

    var subs = _getSubsForHint(endpoint.objectSchema, obj, hint);

    var schema = subs.schema;
    obj = subs.obj;

    var validation = inspector.validate(schema, obj);

    if (!validation.valid) {
        throw new Error("Validation failed! " + validation.format());
    }
}

function parseDiffDates(endpoint, diff) {
    var schema = endpoint.objectSchema;

    if (schema.skip) {
        return;
    }

    if (schema && !schema.skip && !endpoint.datePaths) {
        endpoint.datePaths = extractDatepaths(schema);

    }

    if (!endpoint.datePaths || endpoint.datePaths.length === 0) {
        return;
    }

    if (!endpoint.slicedPaths) {
        endpoint.slicedPaths = {};
    }

    if ((diff.path.length || diff.path.length === 0) && !endpoint.slicedPaths[diff.path.length]) {
        endpoint.slicedPaths[diff.path.length] = endpoint.datePaths.map(x => x.slice(diff.path.length-1)).filter(x => x.length)
    }

    if (diff.rhs) {
        for (let datePath of endpoint.slicedPaths[diff.path.length]) {
            if (datePath[0] === diff.path[diff.path.length-1] || datePath[0] === "*") {
                // Kinda yuk
                let memo = datePath[0];

                datePath[0] = "rhs";
                applyDatepath(datePath, diff);
                datePath[0] = "lhs";
                applyDatepath(datePath, diff);

                datePath[0] = memo;
            }
        }
    }


    if (diff.kind === "A" && diff.item) {
        for (let datePath of endpoint.slicedPaths[diff.path.length]) {
            if (datePath[0] === diff.path[diff.path.length - 1] || datePath[0] === "*") {
                // Kinda yuk

                let slicedPath = datePath.slice(1);
                slicedPath[0] = "rhs";
                applyDatepath(slicedPath, diff.item);
            }
        }
    }


}

function parseFullDates(endpoint, obj) {
    assert(endpoint.objectSchema);

    var schema = endpoint.objectSchema;

    if(schema.skip){
        return
    }

    if (schema && !endpoint.datePaths) {
        endpoint.datePaths = extractDatepaths(schema);
    }

    if (endpoint.datePaths && endpoint.datePaths.length) {
        for(let path of endpoint.datePaths) {
            applyDatepath(path, obj);
        }
    }

    var validation = inspector.validate(schema, obj);

    if (!validation.valid){
        throw new Error("Validation failed! " + validation.format());
    }
}

function _getSubsForHint(schema, obj, hint){
    var i = 0;
    while(i < hint.length){
        if (!(hint[i] in obj)) {
            break; // On delete, validate entire parent. Otherwise possible missing items may not be caught.
        }

        obj = obj[hint[i]];

        if (schema.type === 'object') {
            if (hint[i] in schema.properties) {
                schema = schema.properties[hint[i]];
            } else if ('*' in schema.properties) {
                schema = schema.properties['*'];
            } else{
                throw new Error("Unknown property, and no catch all!")
            }
        } else if (schema.type === 'array') {
            schema = schema.items;
        } else {
            // Hinting on anything else is not currently supported, crash on possible weirdness.
            throw new Error("Please only do hinting on objects/arrays.");
        }

        i++;
    }

    return {schema, obj};
}

module.exports = {
    RPCValidation,
    SharedObjectValidation,
    parseDiffDates,
    parseFullDates,
    SourceValidation: SourceSinkValidation,
    SinkValidation: SourceSinkValidation
};

function extractDatepaths(schema) {
    let out = [];
    if (schema && schema.type === "object" && schema.properties) {
        for (let prop in schema.properties) {
            if (schema.properties[prop].type === "object") {
                let recurse = extractDatepaths(schema.properties[prop]);
                out = [...out, ...recurse.map(x => [prop, ...x])];
            } else if (schema.properties[prop].type === "array") {
                let recurse = extractDatepaths(schema.properties[prop].items);
                out = [...out, ...recurse.map(x=>[prop,"*",...x])];
            } else if (schema.properties[prop].type === "date") {
                out.push([prop]);
            }
        }
    }

    return out;
}

function applyDatepath(path, obj) {
    if (!obj[path[0]] && !(path[0] === "*" && typeof obj === "object")) {
        return;
    }

    if (path.length === 1) {
        if (path[0] !== "*") {
            obj[path[0]] = new Date(obj[path[0]])
        } else {
            for(let key in obj) {
                obj[key] = new Date(obj[key]);
            }
        }
    } else {
        let nextPath = path.slice(1);
        if (path[0] !== "*") {
            applyDatepath(nextPath, obj[path[0]]);
        } else {
            for(let key in obj) {
                applyDatepath(nextPath, obj[key]);
            }
        }
    }
}