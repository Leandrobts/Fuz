'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['14']={

id:14,

name:'Array.sort Structural Stability',

timeout:6000,

run:function(){

let anomalies=[];

const SENTINEL={id:1337};

let arr=[];

for(let i=0;i<16;i++){

arr.push(i+0.25);

}

let mutated=false;

let lengths=[];

arr.sort(function(a,b){

lengths.push(arr.length);

if(!mutated){

mutated=true;

/* força transição */

arr[4]=SENTINEL;

arr[216]=9999.123;

}

return a-b;

});

if(arr.length!==217){

anomalies.push(

'length='+arr.length

);

}

if(arr[4]!==SENTINEL){

anomalies.push(

'sentinel perdido'

);

}

for(let i=0;i<arr.length;i++){

let v=arr[i];

if(v===undefined){

continue;

}

if(

typeof v!=='number' &&

typeof v!=='object'

){

anomalies.push(

'tipo inesperado idx='+i

);

}

}

let unique=[...new Set(lengths)];

if(unique.length>4){

anomalies.push(

'expansões excessivas='+unique.join(',')

);

}

return anomalies.length

? {

status:'ANOMALY',

detail:anomalies.join(' | ')

}

: {

status:'PASS',

detail:'estrutura estável'

};

}

};

})(window);
