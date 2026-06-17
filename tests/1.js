'use strict';

(function(global){

global.FuzzerTests = global.FuzzerTests || {};

global.FuzzerTests['1'] = {

id:1,

name:'Array.sort — Butterfly Growth Investigation',

timeout:6000,

run:function(){

let anomalies=[];

const SENTINEL={
 id:0x41414141,
 tag:'sentinel'
};

/* ===========================
   B — Butterfly Growth
=========================== */

(function(){

try{

const SIZE=16;

let arr=[];

for(let i=0;i<SIZE;i++){

arr.push(i+0.123);

}

let mutated=false;

let lengths=[];

let snapshots=[];

arr.sort(function(x,y){

lengths.push(arr.length);

if(!mutated){

mutated=true;

/* crescimento progressivo */

for(let k=0;k<64;k++){

arr[SIZE+k]=SENTINEL;

}

}

/* snapshot */

snapshots.push({

len:arr.length,

type0:typeof arr[0],

typeLast:typeof arr[arr.length-1]

});

return x-y;

});

/* detector */

for(let i=SIZE;i<arr.length;i++){

let v=arr[i];

if(v===undefined){

continue;

}

if(

typeof v!=='number' &&

typeof v!=='object'

){

anomalies.push(

'B: tipo impossível idx='+i+

' typeof='+typeof v

);

}

if(

typeof v==='number' &&

v!==v &&

!Number.isNaN(v)

){

anomalies.push(

'B: identidade quebrada idx='+i

);

}

}

/* sentinel perdido */

let count=0;

for(let i=SIZE;i<arr.length;i++){

if(arr[i]===SENTINEL){

count++;

}

}

if(count!==64){

anomalies.push(

'B: sentinels perdidos count='+count

);

}

/* verificar instabilidade */

let unique=[...new Set(lengths)];

if(unique.length>3){

anomalies.push(

'B: múltiplas expansões='+unique.join(',')

);

}

}catch(e){

anomalies.push('B: '+e);

}

})();

/* ===========================
   B3 — Far Hole Growth
=========================== */

(function(){

try{

const SIZE=16;

const FAR=216;

let arr=[];

for(let i=0;i<SIZE;i++){

arr.push(i+0.5);

}

let mutated=false;

arr.sort(function(x,y){

if(!mutated){

mutated=true;

/* forçar transição */

arr[4]={marker:true};

arr[FAR]=SENTINEL;

}

return x-y;

});

/* validar sentinel */

if(arr[FAR]!==SENTINEL){

anomalies.push(

'B3: sentinel desapareceu'

);

}

/* procurar valores fantasmas */

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

'B3: tipo impossível idx='+i+

' '+typeof v

);

}

if(

typeof v==='object' &&

v!==SENTINEL &&

!v.marker

){

anomalies.push(

'B3: objeto fantasma idx='+i

);

}

}

/* crescimento inesperado */

if(arr.length<217){

anomalies.push(

'B3: expansão incompleta len='+arr.length

);

}

}catch(e){

anomalies.push('B3: '+e);

}

})();

return anomalies.length

?{

status:'ANOMALY',

detail:anomalies.join(' | ')

}

:{

status:'PASS',

detail:'Butterfly íntegra'

};

}

};

})(window);
