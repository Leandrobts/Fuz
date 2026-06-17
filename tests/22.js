'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['22']={

id:22,

name:'Forced Layout Cascade',

timeout:7000,

run:function(){

let anomalies=[];

try{

let box=document.createElement('div');

box.style.width='100px';

box.style.height='100px';

document.body.appendChild(box);

for(let i=0;i<20;i++){

 void box.offsetWidth;

 void box.offsetHeight;

 void box.getBoundingClientRect();

 box.style.transform=

  'translateX('+

  (i%5)+

  'px)';

 box.scrollTop=i;

}

let r=

box.getBoundingClientRect();

if(

 !Number.isFinite(r.left)

){

 anomalies.push('layout');

}

box.remove();

return anomalies.length

?{

 status:'ANOMALY',

 detail:anomalies.join(' | ')

}

:{

 status:'PASS',

 detail:'layout consistente'

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