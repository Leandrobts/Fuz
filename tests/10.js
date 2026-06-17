'use strict';

(function(global){

global.FuzzerTests = global.FuzzerTests || {};

global.FuzzerTests['10'] = {

id:10,

name:'Fullscreen + DOM lifecycle race',

category:'DOM',

timeout:8000,

run:function(){

return new Promise(function(resolve){

let anomalies=[];

let container=document.createElement('div');

document.body.appendChild(container);

let video=document.createElement('video');

video.width=320;
video.height=240;

container.appendChild(video);

let frame=0;

function cleanup(){

try{

if(document.fullscreenElement){

document.exitFullscreen();

}

}catch(_){}

try{

container.remove();

}catch(_){}

}

function nextFrame(){

frame++;

try{

/* 1 */

if(frame===1){

if(video.requestFullscreen){

video.requestFullscreen();

}

}

/* 2 */

if(frame===2){

container.removeChild(video);

}

/* 3 */

if(frame===3){

container.appendChild(video);

}

/* 4 */

if(frame===4){

video.width=640;

video.height=480;

video.muted=!video.muted;

}

/* 5 */

if(frame===5){

video.style.transform='scale(1.01)';

}

/* 6 */

if(frame===6){

video.removeAttribute('style');

}

/* 7 */

if(frame===7){

video.tabIndex=1;

}

/* 8 */

if(frame===8){

if(

video.parentNode!==container

){

anomalies.push(

'parentNode inconsistente'

);

}

if(

!document.body.contains(video)

){

anomalies.push(

'DOM perdeu referência'

);

}

}

if(frame<10){

requestAnimationFrame(nextFrame);

return;

}

}catch(e){

anomalies.push(

String(e)

);

}

cleanup();

resolve(

anomalies.length

? {

status:'ANOMALY',

detail:anomalies.join(' | ')

}

: {

status:'PASS',

detail:'lifecycle consistente'

}

);

}

requestAnimationFrame(nextFrame);

});

}

};

})(window);
