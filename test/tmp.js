"use strict";

let source
let toAdd
let start,end;

let iters = 3;


source = ['a','a','a','a'];
toAdd = [1,2,3,4];
start = new Date();
for(let i = 0; i<iters; i++) {
    source = [...source, ...toAdd];
}
end = new Date();
console.log("Current:", end-start, 'ms');
console.log(source);


source = ['a','a','a','a'];
toAdd = [1,2,3,4];
start = new Date();
for(let i = 0; i<iters; i++) {
    source.push(...toAdd);
}
end = new Date();
console.log("Push:", end-start, 'ms');
console.log(source);



