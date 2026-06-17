'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['11']={

id:11,

name:'Fullscreen + DOM Lifecycle',

timeout:8000,

run:function(){

return new Promise(function(resolve){

let anomalies=[];

let frame=0;

let container=document.createElement('div');

document.body.appendChild(container);

let el=document.createElement('div');

el.textContent='TEST';

el.style.width='200px';
el.style.height='200px';

container.appendChild(el);

function finish(){

try{
if(document.fullscreenElement){
document.exitFullscreen();
}
}catch(_){}

try{
container.remove();
}catch(_){}

resolve(
anomalies.length
? {status:'ANOMALY',detail:anomalies.join(' | ')}
: {status:'PASS',detail:'lifecycle consistente'}
);

}

function tick(){

frame++;

try{

if(frame===1){

if(el.requestFullscreen){

el.requestFullscreen();

}

}

if(frame===2){

container.removeChild(el);

}

if(frame===3){

container.appendChild(el);

}

if(frame===4){

let clone=el.cloneNode(true);

container.replaceChild(clone,el);

el=clone;

}

if(frame===5){

if(!el.isConnected){

anomalies.push('isConnected=false');

}

}

if(frame===6){

if(!document.body.contains(el)){

anomalies.push('contains=false');

}

}

if(frame===7){

if(el.parentNode!==container){

anomalies.push('parentNode inconsistente');

}

}

if(frame===8){

let r=el.getBoundingClientRect();

if(

!Number.isFinite(r.width) ||

!Number.isFinite(r.height)

){

anomalies.push('boundingRect inválido');

}

}

}catch(e){

anomalies.push(String(e));

}

if(frame<10){

requestAnimationFrame(tick);

}else{

finish();

}

}

requestAnimationFrame(tick);

});

}

};

})(window);
