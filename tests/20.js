'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['20']={

id:20,

name:'DOM Lifecycle Cascade',

timeout:7000,

run:function(){

return new Promise(function(resolve){

let anomalies=[];

let frame=0;

let root=document.createElement('div');

document.body.appendChild(root);

let node=document.createElement('div');

root.appendChild(node);

function loop(){

frame++;

try{

if(frame===1){

 root.removeChild(node);

}

if(frame===2){

 root.appendChild(node);

}

if(frame===3){

 let clone=node.cloneNode(true);

 root.replaceChild(clone,node);

 node=clone;

}

if(frame===4){

 let n=document.createElement('div');

 root.replaceChild(n,node);

 node=n;

}

if(frame===5){

 if(!node.isConnected){

  anomalies.push('isConnected=false');

 }

}

if(frame===6){

 if(node.parentNode!==root){

  anomalies.push('parentNode');

 }

}

}catch(e){

 anomalies.push(String(e));

}

if(frame<8){

 requestAnimationFrame(loop);

}else{

 root.remove();

 resolve(

 anomalies.length

 ?{

  status:'ANOMALY',

  detail:anomalies.join(' | ')

 }

 :{

  status:'PASS',

  detail:'lifecycle consistente'

 }

 );

}

}

requestAnimationFrame(loop);

});

}

};

})(window);