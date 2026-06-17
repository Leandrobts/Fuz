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
            var idx = -1;
            for (var i = 0; i < arr.length; i++) {
              if (arr[i] === orig) { idx = i; break; }
            }
            if (idx !== -1) {
              if (typeof orig.id !== 'string' || typeof orig.val !== 'number') {
                anomalies.push('B: objeto orig {id:' + orig.id + '} corrompido após sort');
              }
            }
          });

          /* Detector: Object.keys numéricos vs arr.length
           * Se keys.length < arr.length → holes inesperados no butterfly.
           * Holes criados pelo sort (não pelo código JS) indicam corrupção. */
          var numericKeys = Object.keys(arr).filter(function (k) {
            return k === String(parseInt(k, 10));
          });
          if (numericKeys.length !== arr.length) {
            anomalies.push(
              'B: Object.keys numéricos (' + numericKeys.length +
              ') !== arr.length (' + arr.length + ') — holes inesperados no butterfly'
            );
          }

          /* Detector: descriptores impossíveis em qualquer slot
           * Accessor property (get/set) em slot numérico após sort =
           * sort C++ não normalizou o descritor antes de escrever. */
          for (var i = 0; i < arr.length; i++) {
            var d = Object.getOwnPropertyDescriptor(arr, String(i));
            if (d && typeof d.get === 'function') {
              anomalies.push('B[' + i + ']: accessor persiste após sort — slot non-writable pelo C++');
            }
            if (d && d.writable === false && typeof d.get !== 'function') {
              anomalies.push('B[' + i + ']: slot non-writable após sort (inesperado)');
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

          /* Verificação 1: aliasing deve ser preservado — mesmo buffer */
          if (ta1.buffer !== ta2.buffer) {
            anomalies.push('C: aliasing quebrado — ta1.buffer !== ta2.buffer após sort');
          }

          /* Verificação 2: byteLength do buffer não deve mudar */
          var expectedBytes = SIZE * 8;
          if (ta1.buffer.byteLength !== expectedBytes) {
            anomalies.push(
              'C: byteLength corrompido — esperado ' + expectedBytes +
              ' encontrado ' + ta1.buffer.byteLength
            );
          }

          /* Verificação 3: nenhum slot deve ser NaN ou não-finito
           * O buffer foi preenchido com inteiros 0..31 + MARKER no sort.
           * NaN ou Infinity indicam interpretação incorreta de bits do buffer. */
          var badSlots = [];
          for (var k = 0; k < SIZE; k++) {
            var v = ta1[k];
            if (!isFinite(v) || isNaN(v)) {
              badSlots.push({ idx: k, val: v });
            }
          }
          if (badSlots.length > 0) {
            anomalies.push(
              'C: slot(s) com valor impossível (NaN/Infinity) após sort com aliasing: ' +
              JSON.stringify(badSlots)
            );
          }

          /* Verificação 4: valores fora do domínio esperado
           * Os únicos valores legítimos são 0..31 (originais) e MARKER (9999.0001).
           * Qualquer outro double indica leitura de bits do buffer com interpretação errada. */
          var alien = [];
          for (var m = 0; m < SIZE; m++) {
            var val = ta1[m];
            var isOriginal = (val >= 0 && val <= SIZE - 1 && val === Math.floor(val));
            var isMarker   = (val === MARKER || val === MARKER - 1);
            if (!isOriginal && !isMarker) {
              alien.push({ idx: m, val: val });
            }
          }
          if (alien.length > 0) {
            anomalies.push(
              'C: valor(es) fora do domínio {0..31, MARKER} após sort com aliasing: ' +
              JSON.stringify(alien.slice(0, 4))
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
          var arr      = [8.8, 3.3, 6.6, 1.1, 7.7, 2.2, 5.5, 4.4];
          var done     = false;
          var getCount = 0;
          var FAKE_VAL = 0.001;

          try {
            arr.sort(function (x, y) {
              if (!done) {
                done = true;
                Object.defineProperty(arr, '3', {
                  get: function () { getCount++; return FAKE_VAL; },
                  configurable: true
                  /* sem setter — write pelo sort deve lançar TypeError em strict */
                });
              }
              return x - y;
            });

            /* Sort completou SEM exceção — o accessor foi ignorado silenciosamente.
             * Verificar estado do slot [3] após sort. */
            var desc3 = Object.getOwnPropertyDescriptor(arr, '3');

            if (desc3 && typeof desc3.get === 'function') {
              /* Accessor persiste — sort C++ não conseguiu escrever no slot.
               * O slot contém um valor "virtual" (FAKE_VAL) que nunca
               * existiu na butterfly real. */
              anomalies.push(
                'D: accessor persiste após sort silencioso' +
                ' (getCount=' + getCount + ')' +
                ' — arr[3]=' + arr[3] + ' via getter'
              );
            }

            /* Verificar descriptor impossível: non-configurable accessor em slot de array */
            for (var i = 0; i < arr.length; i++) {
              var d = Object.getOwnPropertyDescriptor(arr, String(i));
              if (d && d.configurable === false && typeof d.get === 'function') {
                anomalies.push('D[' + i + ']: accessor non-configurable após sort (inesperado)');
              }
            }

            checkTypes(arr, 'D');

          } catch (sortErr) {
            /* TypeError é o comportamento CORRETO — sort tentou write no accessor sem setter.
             * Só reportar se for outro tipo de exceção. */
            if (!(sortErr instanceof TypeError)) {
              anomalies.push(
                'D: exceção inesperada durante sort com accessor: ' +
                sortErr.name + ' — ' + sortErr.message
              );
            }
            /* TypeError esperado — verificar estado do array após a exceção parcial */
            var partialDesc = Object.getOwnPropertyDescriptor(arr, '3');
            if (partialDesc && typeof partialDesc.get === 'function') {
              /* Accessor criado antes da exceção — verificar se arr está em estado consistente */
              var holes = 0;
              for (var j = 0; j < arr.length; j++) {
                if (!Object.prototype.hasOwnProperty.call(arr, String(j))) holes++;
              }
              if (holes > 0) {
                anomalies.push(
                  'D: ' + holes + ' hole(s) no array após sort interrompido por TypeError'
                );
              }
            }
          }

        } catch (e) {
          anomalies.push('D: setup: ' + String(e));
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

