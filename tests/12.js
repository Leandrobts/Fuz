'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['12']={

id:12,

name:'Media + Fullscreen State Sync',

timeout:10000,

run:function(){

return new Promise(function(resolve){

let anomalies=[];

let video=document.createElement('video');

video.controls=true;

document.body.appendChild(video);

let step=0;

function finish(){

try{

if(document.fullscreenElement){

document.exitFullscreen();

}

}catch(_){}

video.remove();

resolve(

anomalies.length

? {status:'ANOMALY',detail:anomalies.join(' | ')}

: {status:'PASS',detail:'media consistente'}

);

}

function next(){

step++;

try{

if(step===1){

if(video.requestFullscreen){

video.requestFullscreen();

}

}

if(step===2){

video.pause();

}

if(step===3){

video.muted=!video.muted;

}

if(step===4){

video.removeAttribute('src');

video.load();

}

if(step===5){

if(

document.fullscreenElement &&

!document.body.contains(video)

){

anomalies.push('fullscreen sem vídeo');

}

}

if(step===6){

if(

video.readyState===0 &&

video.paused===false

){

anomalies.push('readyState inconsistente');

}

}

if(step===7){

if(video.error){

anomalies.push(

'media error='+video.error.code

);

}

}

}catch(e){

anomalies.push(String(e));

}

if(step<8){

setTimeout(next,250);

}else{

finish();

}

}

next();

});

}

};

})(window);
