"use strict";

var assert = require("assert");
var fastcopy = require("fast-copy").default;
var doValidate = require("../misc/Validation").SharedObjectValidation;
var differ = require("deep-diff");

class SharedObjectService{
    constructor(endpoint, transports, initial){
        if (!transports.rpc || !transports.source)
            throw new Error("Shared objects need both Source and RPC transports to be configured");

        doValidate(endpoint, initial);
        this.data = initial;
        this._lastTransmit = fastcopy(initial);
        this._v = 0;
        this.endpoint = endpoint;
        transports.rpc.on('message', this._processRPC.bind(this));
        this.diffTransport = transports.source;
        this.stats = {updates: 0};
    }

    _processRPC(message, reply){
        if (message.endpoint === "_SO_" + this.endpoint.name){
            if (message.input === "init"){
                reply({err:null, res:{data: this.data, v: this._v}});
            }else{
                throw "Got bad data on RPC channel";
            }
        }
    }

    notify(hint, dirtyBypass){
        var now = new Date();

        if (!hint)
            hint = [];

        doValidate(this.endpoint, this.data, hint);

        var diffs = diffAndReverseAndApplyWithHint(this._lastTransmit, this.data, hint, dirtyBypass);

        if (diffs && diffs.length) {
            this.stats.updates++;
            this._v++;
            var OTW = {
                endpoint: "_SO_" + this.endpoint.name,
                message: {diffs, v: this._v, now}
            };
            this.diffTransport.send([OTW.endpoint,JSON.stringify(OTW)]);
        }
    }

    getStats(){
        var current_stats = JSON.parse(JSON.stringify(this.stats));
        this.stats.updates = 0;
        return current_stats;
    }
}

function diffAndReverseAndApplyWithHint(lhs, rhs, hint, bypass){
    var lhsWithHint = lhs;
    var rhsWithHint = rhs;
    var lhsParent = null;
    var i = 0;

    while(i < hint.length){
        // Stop if add or delete.
        if (!(hint[i] in lhsWithHint) || !(hint[i] in rhsWithHint)){
            break
        }

        lhsParent = lhsWithHint;

        lhsWithHint = lhsWithHint[hint[i]];
        rhsWithHint = rhsWithHint[hint[i]];
        i++;
    }

    var hintUsed = hint.slice(0,i);

    var reportDiffs = []; // Separate because of clone changes

    if (hintUsed.length < hint.length){ // SHORTCUT
         if (!(hint[i] in lhsWithHint) && (hint[i] in rhsWithHint)){ // SHORTCUT ADD
             var cloned = fastcopy(rhsWithHint[hint[i]]);
             reportDiffs.push({kind: 'N', path: [...hintUsed, hint[i]], rhs: cloned});
             lhsWithHint[hint[i]] = cloned
         }else if (!(hint[i] in rhsWithHint)){ // SHORTCUT DEL
             reportDiffs.push({kind: 'D', path: [...hintUsed, hint[i]], lhs: lhsWithHint[hint[i]]});
             delete lhsWithHint[hint[i]];
         }else{
             throw new Error("Wut?");
         }
    } else {
        if (!bypass) {
            var diffs = differ(lhsWithHint, rhsWithHint);
            if (diffs) {
                for (let i = diffs.length - 1; i >= 0; i--) {
                    var diff = fastcopy(diffs[i]);
                    if (diff.path) {
                        diff.path = [...hintUsed, ...diff.path];
                    } else {
                        diff.path = hintUsed;
                    }
                    differ.applyChange(lhs, rhs, diff);
                    reportDiffs.push(diff);
                }
            }
        } else {
            // BYPASS
            assert(lhsParent && hint[0]);

            reportDiffs.push({
                kind: 'N',
                path: hint,
                rhs: rhsWithHint
            });

            lhsParent[hint[hint.length-1]] = rhsWithHint;

        }
    }

    return reportDiffs;
}

module.exports = SharedObjectService;
