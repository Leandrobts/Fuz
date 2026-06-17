'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['15']={

id:15,

name:'Array.sort + splice()',

timeout:6000,

run:function(){

let anomalies=[];
let info=[];

let arr=[];

for(let i=0;i<32;i++){

 arr.push(i+0.5);

}

let mutated=false;

const MARKER={tag:'splice'};

try{

arr.sort(function(a,b){

 if(!mutated){

  mutated=true;

  arr.splice(

   8,

   4,

   MARKER,

   9999.001,

   9999.002

  );

 }

 return a-b;

});

info.push(

 'length='+arr.length

);

info.push(

 'marker='+arr.includes(MARKER)

);

let keys=

Object.keys(arr).length;

info.push(

 'keys='+keys

);

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

return anomalies.length

?{

 status:'ANOMALY',

 detail:

 anomalies.join(' | ')+

 ' | INFO: '+

 info.join(' | ')

}

:{

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