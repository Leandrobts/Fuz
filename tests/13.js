'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['13']={

id:13,

name:'rAF + DOM Integrity',

timeout:7000,

run:function(){

return new Promise(function(resolve){

let anomalies=[];

let count=0;

let node=document.createElement('div');

document.body.appendChild(node);

function loop(){

count++;

try{

if(count===2){

node.remove();

}

if(count===3){

document.body.appendChild(node);

}

if(count===4){

let old=node;

node=document.createElement('div');

document.body.replaceChild(node,old);

}

if(count===5){

if(

!node.ownerDocument

){

anomalies.push('ownerDocument=null');

}

}

if(count===6){

if(

!node.isConnected

){

anomalies.push('nó desconectado');

}

}

if(count===7){

let r=node.getBoundingClientRect();

if(

!Number.isFinite(r.left)

){

anomalies.push('layout inválido');

}

}

}catch(e){

anomalies.push(String(e));

}

if(count<9){

requestAnimationFrame(loop);

}else{

node.remove();

resolve(

anomalies.length

? {status:'ANOMALY',detail:anomalies.join(' | ')}

: {status:'PASS',detail:'rAF consistente'}

);

}

}

requestAnimationFrame(loop);

});

}

};

})(window);
