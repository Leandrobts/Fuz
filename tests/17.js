'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['17']={

id:17,

name:'Array.sort + fill()',

timeout:6000,

run:function(){

let anomalies=[];
let info=[];

let arr=[];

for(let i=0;i<128;i++){

 arr.push(i+0.75);

}

let mutated=false;

try{

arr.sort(function(a,b){

 if(!mutated){

  mutated=true;

  arr.fill(7777.777);

 }

 return a-b;

});

let distinct=

new Set(arr);

info.push(

 'distinct='+distinct.size

);

info.push(

 'length='+arr.length

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