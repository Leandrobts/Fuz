'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['18']={

id:18,

name:'Array.sort + Resize Stress',

timeout:6000,

run:function(){

let anomalies=[];
let info=[];

let arr=[];

for(let i=0;i<64;i++){

 arr.push(i+0.125);

}

let mutated=false;

try{

arr.sort(function(a,b){

 if(!mutated){

  mutated=true;

  arr.length=1;

  arr.length=4096;

  arr[4095]=12345.678;

 }

 return a-b;

});

info.push(

 'length='+arr.length

);

info.push(

 'has4095='+

 (4095 in arr)

);

let holes=0;

for(let i=0;i<arr.length;i++){

 if(!(i in arr)){

  holes++;

 }

}

info.push(

 'holes='+holes

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