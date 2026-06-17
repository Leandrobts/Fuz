'use strict';
/**
 * Teste 1 — Array.prototype.sort: mutação de estado via comparator
 *
 * Base: bug confirmado em FW 13.50 onde o C++ cacheia o length antes do sort
 * e o comparator pode crescer/encolher o array sem que o loop nativo saiba.
 *
 * Variantes:
 *   A — push de extras durante o sort (length cresce)
 *   B — truncar length durante o sort (butterfly pode ter elementos "mortos")
 *   C — transição de tipo (Double → Contiguous) durante o sort
 *   D — array esparso com holes, escrita além do length original
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['1'] = {
    id      : 1,
    name    : 'Array.sort — mutação de length/tipo via comparator',
    category: 'JSC-Array',
    timeout : 4000,

    run: function () {
      var anomalies = [];
      var MARKER    = 9999.0001;

      /* ── Variante A: crescer o array durante o sort ── */
      (function variantA() {
        try {
          var a       = [3, 1, 4, 1, 5, 9, 2, 6];
          var origLen = a.length;
          var injected = false;

          a.sort(function (x, y) {
            if (!injected) {
              injected = true;
              for (var i = 0; i < 16; i++) a.push(MARKER);
            }
            return (x | 0) - (y | 0);
          });

          /* O C++ pode ter usado o length original (8) e deixado
           * os 16 extras no butterfly sem fazer parte do resultado.
           * Se a[8] ou a[9] ainda valhem MARKER, o acesso está ok;
           * se o length ficou abaixo de 8, temos corrupção. */
          if (a.length < origLen) {
            anomalies.push('A: length corrompido após push (' + a.length + '<' + origLen + ')');
          }
          /* Leitura além do length original percebido — comparar com MARKER */
          var oob = a[origLen + 8];
          if (oob !== undefined && oob !== MARKER) {
            anomalies.push('A: OOB read valor inesperado: a[' + (origLen + 8) + ']=' + oob);
          }
        } catch (e) {
          anomalies.push('A: exceção: ' + String(e));
        }
      }());

      /* ── Variante B: OOB Write potencial via escrita além de SIZE durante sort ──
       *
       * O JSC cacheia length=SIZE antes do loop C++.
       * O comparator escreve em arr[SIZE], arr[SIZE+1], arr[SIZE+7] enquanto
       * o sort está ativo. Ao terminar, o JSC restaura arr.length = SIZE.
       *
       * Se arr.length === SIZE mas arr[SIZE..SIZE+7] ainda contém MARKER:
       *   → escrita persistiu além do boundary declarado = OOB Write confirmado.
       * Se arr.length > SIZE:
       *   → array expandiu normalmente, escrita foi capturada pelo length.
       */
      (function variantB() {
        try {
          var SIZE   = 64;
          var MARKER = 9999.0001;
          var a      = [];
          for (var i = 0; i < SIZE; i++) a.push(Math.random());
          var done   = false;

          a.sort(function (x, y) {
            if (!done) {
              done = true;
              /* Escrever além de SIZE enquanto sort usa length cacheado */
              a[SIZE]     = MARKER;
              a[SIZE + 1] = MARKER;
              a[SIZE + 7] = MARKER;
            }
            return x - y;
          });

          var finalLen = a.length;

          if (finalLen === SIZE) {
            /* JSC restaurou length — verificar se MARKERs persistem além do boundary */
            var persist = [];
            for (var j = SIZE; j < SIZE + 8; j++) {
              if (a[j] === MARKER) persist.push(j);
            }
            if (persist.length > 0) {
              anomalies.push(
                'B: OOB Write confirmado — length restaurado para ' + SIZE +
                ' mas MARKER persiste em idx [' + persist.join(', ') + ']'
              );
            }
          } else if (finalLen > SIZE) {
            /* Array expandiu — escrita capturada no length, não é OOB Write puro.
             * Registrar finalLen para calibrar B2/B3. */
            var missing = [SIZE, SIZE + 1, SIZE + 7].filter(function (idx) {
              return a[idx] !== MARKER;
            });
            if (missing.length > 0) {
              anomalies.push(
                'B: array expandiu para ' + finalLen +
                ' mas MARKER ausente nos idx [' + missing.join(', ') + ']'
              );
            }
            /* PASS informativo — anotar finalLen */
            anomalies.push('B: INFO — sort expandiu array para finalLen=' + finalLen +
                           ' (MARKERs dentro do novo boundary)');
          } else {
            anomalies.push('B: length inválido após sort: ' + finalLen);
          }
        } catch (e) {
          anomalies.push('B: exceção: ' + String(e));
        }
      }());

      /* ── Variante B2: objeto além de SIZE — força ContiguousArray nos slots extras ──
       *
       * Se o sort expande o array (finalLen > SIZE), arr[SIZE] é um {} acessível.
       * Se o sort restaura length=SIZE, arr[SIZE] tem um objeto além do boundary.
       * Adicionalmente: verificar se arr[SIZE] pode ser lido como ponteiro JSValue
       * (acesso a objeto via índice além de length declarado).
       */
      (function variantB2() {
        try {
          var SIZE   = 32;
          var SENTINEL = { tag: 'B2-obj', uid: 0xDEAD };
          var a = [];
          for (var i = 0; i < SIZE; i++) a.push(Math.random());
          var done = false;

          a.sort(function (x, y) {
            if (!done) {
              done = true;
              a[SIZE]     = SENTINEL;   /* objeto → força ContiguousArray */
              a[SIZE + 1] = SENTINEL;
            }
            return x - y;
          });

          var finalLen = a.length;
          /* Tentar ler o objeto além do boundary declarado */
          var readBack = a[SIZE];

          if (finalLen === SIZE) {
            /* Sort restaurou length — objeto em a[SIZE] é OOB Write de JSValue */
            if (readBack === SENTINEL || (readBack && readBack.tag === 'B2-obj')) {
              anomalies.push(
                'B2: OOB Write de JSValue — length=' + SIZE +
                ' mas a[SIZE] ainda aponta para SENTINEL: ' + JSON.stringify(readBack)
              );
            }
          } else {
            /* Sort expandiu — registrar que objeto é acessível em finalLen */
            anomalies.push(
              'B2: INFO — sort expandiu para ' + finalLen +
              ', a[SIZE]=' + (readBack && readBack.tag ? readBack.tag : typeof readBack)
            );
          }
        } catch (e) {
          anomalies.push('B2: ' + String(e));
        }
      }());

      /* ── Variante B3: hole gigante — escrever em arr[SIZE + 200] ──
       *
       * O comparator escreve num slot muito além de SIZE.
       * Se o sort usa length cacheado (SIZE), o slot fica "órfão" num hole.
       * Verificar: finalLen, acesso ao slot, integridade da butterfly.
       */
      (function variantB3() {
        try {
          var SIZE   = 16;
          var FAR    = SIZE + 200;
          var MARKER = 9999.0001;
          var a      = [];
          for (var i = 0; i < SIZE; i++) a.push(i * 1.1);
          var done   = false;

          a.sort(function (x, y) {
            if (!done) {
              done = true;
              a[FAR] = MARKER; /* escreve 200 slots além do fim */
            }
            return x - y;
          });

          var finalLen = a.length;
          var farVal   = a[FAR];

          if (finalLen === SIZE) {
            /* Sort restaurou length — FAR slot persiste além do boundary? */
            if (farVal === MARKER) {
              anomalies.push(
                'B3: OOB Write com hole — length=' + SIZE +
                ' mas a[' + FAR + ']=MARKER persiste'
              );
            }
          } else if (finalLen > SIZE && finalLen <= FAR) {
            /* Sort expandiu mas ficou antes de FAR — a[FAR] é hole */
            anomalies.push(
              'B3: INFO — finalLen=' + finalLen + ' < FAR=' + FAR +
              ', a[FAR]=' + farVal
            );
          } else if (finalLen > FAR) {
            /* Sort expandiu até FAR */
            anomalies.push(
              'B3: INFO — sort expandiu até finalLen=' + finalLen +
              ', a[FAR]=' + farVal
            );
          }
        } catch (e) {
          anomalies.push('B3: ' + String(e));
        }
      }());

      /* ── Variante C: transição Double → Contiguous durante o sort ── */
      (function variantC() {
        try {
          var a      = [3.1, 1.2, 4.3, 1.4, 5.5, 9.6, 2.7, 6.8]; // DoubleArray
          var count  = 0;

          a.sort(function (x, y) {
            count++;
            if (count === 2) {
              a[0] = {};     // força transição → ContiguousArray
              a[1] = MARKER; // marcador de posição conhecida
            }
            /* comparador permissivo para não lançar TypeError */
            if (typeof x !== 'number' || typeof y !== 'number') return 0;
            return x - y;
          });

          /* Verificar: o MARKER chegou a posição errada? */
          var pos = a.indexOf(MARKER);
          if (pos !== -1 && pos > 2) {
            /* Suspeito: MARKER deveria estar no topo com sort numérico */
            anomalies.push('C: MARKER em posição suspeita: a[' + pos + ']=' + MARKER);
          }
        } catch (e) {
          /* TypeError ao comparar {} é esperado — não é anomalia */
          if (!(e instanceof TypeError)) {
            anomalies.push('C: exceção inesperada: ' + String(e));
          }
        }
      }());

      /* ── Variante D: array esparso com holes ── */
      (function variantD() {
        try {
          /* eslint-disable no-sparse-arrays */
          var a    = [5, 3, , , 1, , 9]; // length=7 com holes
          var done = false;

          a.sort(function (x, y) {
            if (!done) {
              done    = true;
              a[10]   = MARKER; // escreve além do comprimento original
            }
            return (x | 0) - (y | 0);
          });

          if (a[10] === MARKER) {
            /* Array expandiu — verificar se há leitura além do novo boundary */
            var beyond = a[11];
            if (beyond !== undefined) {
              anomalies.push('D: read beyond [11]=' + beyond);
            }
          }
        } catch (e) {
          anomalies.push('D: exceção: ' + String(e));
        }
      }());

      /* ── Resultado ── */
      if (anomalies.length > 0) {
        return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      }
      return { status: 'PASS', detail: 'A-D sem anomalias' };
    }
  };

}(window));
