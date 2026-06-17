'use strict';

(function (global) {

global.FuzzerTests = global.FuzzerTests || {};

global.FuzzerTests['9'] = {

id: 9,

name: 'Array Layout Stability — reverse/splice/copyWithin',

category: 'JSC-Array',

timeout: 5000,

run: function () {

let anomalies = [];

const SENTINEL = { tag: 'sentinel' };

function validate(arr, stage) {

for (let i = 0; i < arr.length; i++) {

let v = arr[i];

if (v === undefined) continue;

/* tipos inesperados */

if (
typeof v !== 'number' &&
typeof v !== 'object'
) {

anomalies.push(
stage +
': tipo inesperado idx=' +
i +
' typeof=' +
typeof v
);

}

/* identidade quebrada */

if (
typeof v === 'object' &&
v !== null &&
v !== v
) {

anomalies.push(
stage +
': identidade quebrada idx=' +
i
);

}

}

/* SENTINEL desapareceu */

if (!arr.includes(SENTINEL)) {

anomalies.push(
stage +
': sentinel desapareceu'
);

}

}

/* ==========================
   reverse()
========================== */

(function(){

try{

let arr=[];

for(let i=0;i<32;i++){

arr.push(i+0.25);

}

arr[8]=SENTINEL;

arr.reverse();

validate(arr,'reverse');

}catch(e){

anomalies.push(
'reverse: '+e
);

}

})();

/* ==========================
   splice()
========================== */

(function(){

try{

let arr=[];

for(let i=0;i<64;i++){

arr.push(i+0.5);

}

/* força transição */

arr[12]=SENTINEL;

/* remove e reinsere */

arr.splice(
20,
5,
{},
{},
{}
);

validate(arr,'splice');

}catch(e){

anomalies.push(
'spice: '+e
);

}

})();

/* ==========================
   copyWithin()
========================== */

(function(){

try{

let arr=[];

for(let i=0;i<128;i++){

arr.push(i+0.75);

}

arr[16]=SENTINEL;

arr.copyWithin(
64,
0,
32
);

validate(arr,'copyWithin');

}catch(e){

anomalies.push(
'copyWithin: '+e
);

}

})();

return anomalies.length

? {
status:'ANOMALY',
detail:anomalies.join(' | ')
}

: {
status:'PASS',
detail:'layout estável'
};

}

};

})(window);
