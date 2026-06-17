'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['19']={

id:19,

name:'sort() Cascade',

timeout:7000,

run:function(){

let anomalies=[];
let arr=[];

for(let i=0;i<64;i++){

 arr.push(i+0.5);

}

let mutated=false;

try{

arr.sort(function(a,b){

 if(!mutated){

  mutated=true;

  arr.splice(8,4);

  arr.reverse();

  arr.fill(5555.555,16,32);

  arr.length=256;

  arr[255]=9999.999;

 }

 return a-b;

});

if(arr.length!==256){

 anomalies.push('length='+arr.length);

}

if(!(255 in arr)){

 anomalies.push('255 perdido');

}

return anomalies.length

?{

 status:'ANOMALY',

 detail:anomalies.join(' | ')

}

:{

 status:'PASS',

 detail:'cascade consistente'

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