'use strict';
/**
 * Teste 1 — Array.prototype.sort: vetores cirúrgicos pós-análise
 *
 * [Refatorado] Removido: B2, B3 (sort sempre expande — confirmado).
 * Removido: OOM/DoS vectors (não reportáveis).
 *
 * Foco exclusivo nos sinais reais de corrupção detectáveis via JS puro:
 *   ✓ typeof retorna tipo impossível para o slot
 *       (string/boolean/symbol em array de number/object)
 *   ✓ NaN === NaN  (NaN-boxing inválido — em IEEE 754 NaN !== NaN sempre)
 *   ✓ Identidade de objeto quebrada: obj !== obj
 *   ✓ Valor não escrito por nenhum código JS aparece em slot
 *   ✓ TypedArray aliasing: MARKER escrito via view2 desaparece do sort de view1
 *   ✓ Accessor property em slot sobrevive ao sort (write silenciado pelo C++)
 *
 * Variantes:
 *   A — sort + push no comparator + checkTypes em todos os slots resultantes
 *   B — ContiguousArray (mix double+objeto) mutado durante sort
 *       Detecta: leitura de ponteiro como double / double como ponteiro
 *   C — Float64Array aliasing (2 views, 1 ArrayBuffer)
 *       Mutar via view2 durante sort de view1 — MARKER deve chegar ao topo
 *   D — Object.defineProperty accessor num slot durante sort
 *       Detecta: write silenciado pelo C++ / accessor persiste após sort
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['1'] = {
    id      : 1,
    name    : 'Array.sort — ContiguousArray mutation, TypedArray aliasing, accessor trap',
    category: 'JSC-Array',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var MARKER    = 9999.0001;

      /* ── Helper: detectar sinais reais de corrupção ──────────────────────
       * Tipos impossíveis numa array de number/object:
       *   'string', 'boolean', 'symbol', 'function', 'bigint'
       * NaN-boxing inválido: isNaN(v) === true  mas  v === v (em IEEE 754, NaN !== NaN)
       * Identidade quebrada: typeof v === 'object' && v !== null && v !== v
       * ─────────────────────────────────────────────────────────────────── */
      function checkTypes(arr, label) {
        for (var i = 0; i < arr.length; i++) {
          var v = arr[i];
          var t = typeof v;

          if (t === 'string' || t === 'boolean' || t === 'symbol' ||
              t === 'function' || t === 'bigint') {
            anomalies.push(
              label + '[' + i + ']: typeof impossível "' + t + '" val=' + String(v)
            );
          }

          if (t === 'number' && isNaN(v) && v === v) {
            anomalies.push(label + '[' + i + ']: NaN-boxing inválido (NaN===NaN)');
          }

          if (t === 'object' && v !== null && v !== v) {
            anomalies.push(label + '[' + i + ']: identidade de objeto quebrada (obj!==obj)');
          }
        }
      }

      /* ── Variante A: sort + push no comparator + checkTypes ──────────────
       *
       * Push durante o sort expande o array (confirmado: finalLen > SIZE).
       * O interesse agora é: os slots adicionados via push, quando o sort
       * os processa no C++, têm tipos JS coerentes?
       * O sort pode ter cacheado o tipo da butterfly (DoubleArray) e
       * processar os novos slots como doubles mesmo se forem objetos.
       */
      (function variantA() {
        try {
          /* DoubleArray: apenas floats */
          var a        = [3.0, 1.0, 4.0, 1.0, 5.0, 9.0, 2.0, 6.0];
          var injected = false;

          a.sort(function (x, y) {
            if (!injected) {
              injected = true;
              /* Injetar mix de tipos: doubles e objetos */
              a.push(Math.random());        /* double — mantém DoubleArray? */
              a.push({ tag: 'injected' });  /* objeto — força ContiguousArray? */
              a.push(Math.random());
            }
            /* Comparador permissivo para mix de tipos */
            var xv = typeof x === 'number' ? x : 0;
            var yv = typeof y === 'number' ? y : 0;
            return xv - yv;
          });

          checkTypes(a, 'A');

          /* Verificar que o objeto injetado ainda tem identidade */
          var injObj = a.filter(function (v) {
            return v !== null && typeof v === 'object' && v.tag === 'injected';
          });
          if (injObj.length !== 1) {
            anomalies.push(
              'A: objeto injetado ' +
              (injObj.length === 0 ? 'desapareceu' : 'duplicou (' + injObj.length + 'x)') +
              ' após sort'
            );
          }
        } catch (e) {
          if (!(e instanceof TypeError)) anomalies.push('A: ' + String(e));
        }
      }());

      /* ── Variante B: ContiguousArray (mix double+objeto) mutado durante sort ──
       *
       * Array já é ContiguousArray desde o início (mix de doubles e objetos).
       * Durante o sort, mutar um slot de objeto para double e vice-versa.
       * O JSC C++ itera sobre a butterfly com a interpretação de tipo fixada
       * no início do sort? Se sim, pode ler objetos como doubles ou o oposto.
       *
       * Sinal: checkTypes detecta typeof impossível ou NaN-boxing inválido.
       */
      (function variantB() {
        try {
          var objA = { id: 'A', val: 0.5 };
          var objB = { id: 'B', val: 7.5 };
          var objC = { id: 'C', val: 3.5 };

          /* ContiguousArray: doubles e objetos intercalados */
          var arr = [1.1, objA, 9.9, objB, 4.4, objC, 6.6, 2.2];
          var mutCount = 0;

          arr.sort(function (a, b) {
            mutCount++;
            if (mutCount === 1) {
              /* Mutar slot[0]: double → objeto */
              arr[0] = { id: 'MUT0', val: 0.1 };
            }
            if (mutCount === 2) {
              /* Mutar slot[2]: double → double diferente */
              arr[2] = MARKER;
            }
            if (mutCount === 3) {
              /* Mutar objeto por double — ContiguousArray → potencial DoubleArray */
              arr[1] = 0.001;
            }
            var av = typeof a === 'number' ? a : (a && typeof a.val === 'number' ? a.val : 0);
            var bv = typeof b === 'number' ? b : (b && typeof b.val === 'number' ? b.val : 0);
            return av - bv;
          });

          checkTypes(arr, 'B');

          /* Verificar identidade dos objetos originais sobreviventes */
          var origObjs = [objA, objB, objC];
          origObjs.forEach(function (orig) {
            /* Objetos originais devem continuar íntegros se presentes */
            var idx = -1;
            for (var i = 0; i < arr.length; i++) {
              if (arr[i] === orig) { idx = i; break; }
            }
            if (idx !== -1) {
              /* Verificar que o objeto não foi corrompido */
              if (typeof orig.id !== 'string' || typeof orig.val !== 'number') {
                anomalies.push('B: objeto orig {id:' + orig.id + '} corrompido após sort');
              }
            }
          });

          /* MARKER deve estar presente e em posição coerente */
          var markerIdx = arr.indexOf(MARKER);
          if (arr.indexOf(MARKER) === -1) {
            anomalies.push('B: MARKER desapareceu do ContiguousArray após sort');
          } else {
            /* MARKER=9999.0001 é o maior double — deve estar próximo ao fim */
            var afterMarker = arr.slice(markerIdx + 1).filter(function (v) {
              return typeof v === 'number' && v > MARKER;
            });
            if (afterMarker.length > 0) {
              anomalies.push(
                'B: número maior que MARKER após MARKER no sort — ordenação corrompida: ' +
                JSON.stringify(afterMarker)
              );
            }
          }
        } catch (e) {
          if (!(e instanceof TypeError)) anomalies.push('B: ' + String(e));
        }
      }());

      /* ── Variante C: Float64Array aliasing (2 views, 1 ArrayBuffer) ────────
       *
       * Cria duas Float64Array sobre o mesmo ArrayBuffer.
       * Durante o sort de ta1, escreve MARKER via ta2 (alias).
       * Como ta1 e ta2 compartilham memória, ta1 "vê" o MARKER imediatamente.
       * O sort C++ pode ter cacheado os valores antes de processar ta2 — nesse
       * caso, o MARKER pode ser ignorado, mal-posicionado, ou causar
       * inconsistência no resultado da ordenação.
       *
       * Sinal esperado: MARKER não está na última posição (maior valor),
       * ou desapareceu completamente, ou NaN em algum slot.
       */
      (function variantC() {
        try {
          var SIZE = 32;
          var buf  = new ArrayBuffer(SIZE * 8); /* Float64: 8 bytes por elemento */
          var ta1  = new Float64Array(buf);
          var ta2  = new Float64Array(buf); /* alias — mesma memória */

          /* Valores iniciais conhecidos: 0.0, 1.0, 2.0 ... 31.0 */
          for (var i = 0; i < SIZE; i++) ta1[i] = (SIZE - 1 - i) * 1.0; /* ordem decrescente */

          var mutated = false;

          try {
            Array.prototype.sort.call(ta1, function (a, b) {
              if (!mutated) {
                mutated = true;
                /* Escrever MARKER no último slot via view alias */
                ta2[SIZE - 1] = MARKER;     /* maior valor possível */
                ta2[SIZE - 2] = MARKER - 1; /* segundo maior */
              }
              return a - b;
            });
          } catch (e2) {
            /* TypedArray sort pode não aceitar comparator personalizado */
            if (e2 instanceof TypeError) {
              /* Tentar sort sem comparator */
              try { ta1.sort(); } catch (_) {}
            } else {
              anomalies.push('C: exceção no sort: ' + String(e2));
              return;
            }
          }

          /* Verificação 1: MARKER deve estar em ta1[SIZE-1] (maior valor) */
          var lastVal = ta1[SIZE - 1];
          if (lastVal !== MARKER) {
            /* Procurar onde o MARKER foi parar */
            var markerAt = -1;
            for (var j = 0; j < SIZE; j++) {
              if (ta1[j] === MARKER) { markerAt = j; break; }
            }
            if (markerAt === -1) {
              anomalies.push(
                'C: MARKER desapareceu após sort com aliasing — valor em ta1[SIZE-1]=' + lastVal
              );
            } else {
              anomalies.push(
                'C: MARKER em posição inesperada ta1[' + markerAt + ']' +
                ' (esperado ' + (SIZE - 1) + ') — aliasing causou reordenação incorreta'
              );
            }
          }

          /* Verificação 2: nenhum NaN nos slots */
          var nanAt = [];
          for (var k = 0; k < SIZE; k++) {
            if (isNaN(ta1[k])) nanAt.push(k);
          }
          if (nanAt.length > 0) {
            anomalies.push('C: NaN em Float64Array após sort com aliasing: slots [' + nanAt.join(', ') + ']');
          }

          /* Verificação 3: ta1 e ta2 devem continuar em sync (mesmo buffer) */
          if (ta1[0] !== ta2[0] || ta1[SIZE - 1] !== ta2[SIZE - 1]) {
            anomalies.push(
              'C: sync de aliasing quebrada — ta1[0]=' + ta1[0] + ' ta2[0]=' + ta2[0]
            );
          }

        } catch (e) {
          anomalies.push('C: ' + String(e));
        }
      }());

      /* ── Variante D: Object.defineProperty accessor num slot durante sort ──
       *
       * O sort C++ precisa escrever os valores de volta nos slots após comparar.
       * Se um slot é redefinido como accessor property (get/set) durante o sort,
       * o C++ vai:
       *   (a) ignorar silenciosamente a escrita (sort incompleto)?
       *   (b) usar o getter para ler (valor diferente do original)?
       *   (c) normalizar de volta para data property (accessor não persiste)?
       *
       * Se o accessor persiste após o sort com um get personalizado, o sort
       * operou sobre um valor que não existia na memória da butterfly —
       * o getter retornou um valor "virtual" que foi usado para comparação.
       */
      (function variantD() {
        try {
          var arr     = [8.8, 3.3, 6.6, 1.1, 7.7, 2.2, 5.5, 4.4];
          var done    = false;
          var getCount = 0;
          var FAKE_VAL = 0.001; /* valor que o accessor retorna */

          arr.sort(function (x, y) {
            if (!done) {
              done = true;
              /* Substituir slot [3] por accessor durante o sort */
              Object.defineProperty(arr, '3', {
                get: function () {
                  getCount++;
                  return FAKE_VAL; /* retorna 0.001 em vez do valor real */
                },
                configurable: true
                /* sem setter: tentativa de write pelo sort é silenciada */
              });
            }
            return x - y;
          });

          /* Verificação 1: o accessor sobreviveu ao sort? */
          var desc = Object.getOwnPropertyDescriptor(arr, '3');
          if (desc && typeof desc.get === 'function') {
            anomalies.push(
              'D: accessor persiste em arr[3] após sort (getCount=' + getCount + ')' +
              ' — sort C++ não normalizou para data property'
            );
          }

          /* Verificação 2: se o accessor não persiste, arr[3] é um número? */
          var slot3 = arr[3];
          checkTypes([slot3], 'D-slot3');

          /* Verificação 3: FAKE_VAL = 0.001 deve aparecer na ordenação
           * se o sort usou o getter — o menor valor deve ser FAKE_VAL */
          if (arr[0] === FAKE_VAL) {
            /* O sort leu FAKE_VAL via getter e o posicionou como mínimo */
            anomalies.push(
              'D: sort usou valor do getter (FAKE_VAL=' + FAKE_VAL + ') para ordenação' +
              ' — arr[0]=' + arr[0] + ' (getCount=' + getCount + ')'
            );
          }

          /* Verificação 4: arr deve estar globalmente ordenado (salvo o slot do accessor) */
          var disorder = 0;
          for (var i = 1; i < arr.length; i++) {
            if (typeof arr[i - 1] === 'number' && typeof arr[i] === 'number') {
              if (arr[i] < arr[i - 1]) disorder++;
            }
          }
          if (disorder > 1) {
            anomalies.push('D: arr com ' + disorder + ' inversões após sort com accessor');
          }

        } catch (e) {
          anomalies.push('D: ' + String(e));
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

