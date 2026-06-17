'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['14']={

id:14,

name:'Array.sort Behavioral Signature',

timeout:6000,

run:function(){

let anomalies=[];
let info=[];

const SIZE=16;
const FAR=216;

const SENTINEL={
 id:0x1337,
 marker:true
};

let arr=[];

for(let i=0;i<SIZE;i++){

 arr.push(i+0.25);

}

let mutated=false;

try{

arr.sort(function(a,b){

 if(!mutated){

  mutated=true;

  /*
   objeto
  */

  arr[4]=SENTINEL;

  /*
   valor distante
  */

  arr[FAR]=9999.123;

 }

 return a-b;

});

/* ======================
   length
====================== */

info.push(

 'length='+arr.length

);

/* ======================
   has9999
====================== */

let has9999=

arr.includes(9999.123);

info.push(

 'has9999='+has9999

);

/* ======================
   hasSentinel
====================== */

let hasSentinel=

arr.includes(SENTINEL);

info.push(

 'hasSentinel='+hasSentinel

);

/* ======================
   objectCount
====================== */

let objectCount=0;

for(let i=0;i<arr.length;i++){

 if(

  typeof arr[i]==='object' &&

  arr[i]!==null

 ){

  objectCount++;

 }

}

info.push(

 'objects='+objectCount

);

/* ======================
   keys
====================== */

let keyCount=

Object.keys(arr).length;

info.push(

 'keys='+keyCount

);

/* ======================
   holes
====================== */

let holes=0;

for(let i=0;i<arr.length;i++){

 if(!(i in arr)){

  holes++;

 }

}

info.push(

 'holes='+holes

);

/* ======================
   tipos inesperados
====================== */

for(let i=0;i<arr.length;i++){

 let v=arr[i];

 if(v===undefined){

  continue;

 }

 let t=typeof v;

 if(

  t!=='number' &&

  t!=='object'

 ){

  anomalies.push(

   'tipo='+t+

   '@'+i

  );

 }

}

/* ======================
   NaN inesperado
====================== */

for(let i=0;i<arr.length;i++){

 let v=arr[i];

 if(

  typeof v==='number' &&

  Number.isNaN(v)

 ){

  anomalies.push(

   'NaN@'+i

  );

 }

}

/* ======================
   length inválido
====================== */

if(arr.length!==217){

 anomalies.push(

  'length='+arr.length

 );

}

/* ======================
   resultado
====================== */

if(anomalies.length){

 return {

  status:'ANOMALY',

  detail:

   anomalies.join(' | ')+

   ' | INFO: '+

   info.join(' | ')

 };

}

return {

 status:'PASS',

 detail:

  info.join(' | ')

};

}catch(e){

return{

 status:'ANOMALY',

 detail:String(e)

};

}

}

};

})(window);
