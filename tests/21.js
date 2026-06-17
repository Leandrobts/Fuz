'use strict';

(function(global){

global.FuzzerTests=global.FuzzerTests||{};

global.FuzzerTests['21']={

id:21,

name:'Fullscreen + Media Cascade',

timeout:10000,

run:function(){

return new Promise(function(resolve){

let anomalies=[];

let step=0;

let video=document.createElement('video');

video.controls=true;

document.body.appendChild(video);

function finish(){

try{

 if(document.fullscreenElement){

  document.exitFullscreen();

 }

}catch(_){}

video.remove();

resolve(

 anomalies.length

 ?{

  status:'ANOMALY',

  detail:anomalies.join(' | ')

 }

 :{

  status:'PASS',

  detail:'media consistente'

 }

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

 video.load();

}

if(step===4){

 video.muted=!video.muted;

}

if(step===5){

 video.controls=!video.controls;

}

if(step===6){

 if(

  document.fullscreenElement &&

  !document.body.contains(video)

 ){

  anomalies.push('fullscreen inconsistente');

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