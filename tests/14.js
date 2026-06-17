'use strict';

(function (global) {

global.FuzzerTests = global.FuzzerTests || {};

global.FuzzerTests['14'] = {

id: 14,

name: 'Array.sort Structural Stability (v2)',

category: 'JSC-Array',

timeout: 6000,

run: function () {

let anomalies = [];
let infos = [];

const SENTINEL = {
  id: 0x1337,
  marker: true
};

const SIZE = 16;
const FAR  = 216;

let arr = [];

for (let i = 0; i < SIZE; i++) {

  arr.push(i + 0.25);

}

let mutated = false;

let lengths = [];

try {

arr.sort(function (a, b) {

  lengths.push(arr.length);

  if (!mutated) {

    mutated = true;

    /*
      força transição
      DoubleArray -> ContiguousArray
    */

    arr[4] = SENTINEL;

    /*
      força expansão distante
    */

    arr[FAR] = 9999.123;

  }

  return a - b;

});

/* --------------------------
   Detector 1
   Comprimento final
-------------------------- */

if (arr.length !== 217) {

  anomalies.push(

    'length inesperado=' + arr.length

  );

}

/* --------------------------
   Detector 2
   Procurar SENTINEL
-------------------------- */

let sentinelIndexes = [];

for (let i = 0; i < arr.length; i++) {

  if (arr[i] === SENTINEL) {

    sentinelIndexes.push(i);

  }

}

if (sentinelIndexes.length === 0) {

  anomalies.push(

    'SENTINEL desapareceu completamente'

  );

} else {

  infos.push(

    'sentinel=' +

    sentinelIndexes.join(',')

  );

}

/* --------------------------
   Detector 3
   Contar objetos
-------------------------- */

let objectCount = 0;

for (let i = 0; i < arr.length; i++) {

  if (

    typeof arr[i] === 'object' &&

    arr[i] !== null

  ) {

    objectCount++;

  }

}

infos.push(

  'objects=' + objectCount

);

if (

  sentinelIndexes.length > 0 &&

  objectCount === 0

) {

  anomalies.push(

    'contador inconsistente'

  );

}

/* --------------------------
   Detector 4
   Tipos impossíveis
-------------------------- */

for (let i = 0; i < arr.length; i++) {

  let v = arr[i];

  if (v === undefined) {

    continue;

  }

  let t = typeof v;

  if (

    t !== 'number' &&

    t !== 'object'

  ) {

    anomalies.push(

      'tipo inesperado idx=' +

      i +

      ' typeof=' +

      t

    );

  }

}

/* --------------------------
   Detector 5
   NaN inesperado
-------------------------- */

for (let i = 0; i < arr.length; i++) {

  let v = arr[i];

  if (

    typeof v === 'number' &&

    Number.isNaN(v)

  ) {

    anomalies.push(

      'NaN inesperado idx=' +

      i

    );

  }

}

/* --------------------------
   Detector 6
   Múltiplas expansões
-------------------------- */

let uniqueLengths =

[...new Set(lengths)];

infos.push(

  'expansoes=' +

  uniqueLengths.join(',')

);

if (

  uniqueLengths.length > 5

) {

  anomalies.push(

    'expansões excessivas'

  );

}

/* --------------------------
   Resultado
-------------------------- */

if (anomalies.length) {

  return {

    status: 'ANOMALY',

    detail:

      anomalies.join(' | ') +

      (infos.length

        ? ' | INFO: ' +

          infos.join(' | ')

        : '')

  };

}

return {

  status: 'PASS',

  detail:

    'OK | ' +

    infos.join(' | ')

};

} catch (e) {

return {

  status: 'ANOMALY',

  detail: String(e)

};

}

}

};

})(window);
