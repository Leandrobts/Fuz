'use strict';
/**
 * Teste 3 — Proxy: re-entrância via traps em métodos nativos de Array
 *
 * RESULTADO CONFIRMADO (log 16/06/2026):
 *   Variante A → target[4] = 19998.0002 (= MARKER × 2 = 9999.0001 × 2)
 *   forEach NÃO snapshot o array — relê via Proxy a cada iteração.
 *   A re-entrada no set trap durante o processamento do idx=0 escreve
 *   MARKER em target[4], e quando forEach chega no idx=4 lê MARKER
 *   via Proxy e escreve MARKER×2 de volta.
 *
 * Variantes originais (A-D): mantidas.
 * Variantes novas (E-F): exploram o resultado de A para ir além.
 *
 *   E — forEach cacheia o length ou relê via Proxy? (análogo ao bug do sort)
 *       Se o length for reduzido via Proxy durante forEach, forEach para?
 *       Se não parar, lê slots além do novo boundary → read primitive.
 *
 *   F — Proxy.set que transita Double→Contiguous durante forEach.
 *       Re-entrância A×tipo: a combinação pode corromper a butterfly
 *       enquanto forEach ainda está iterando sob o tipo antigo.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['3'] = {
    id      : 3,
    name    : 'Proxy — re-entrância via traps em métodos nativos de Array',
    category: 'JSC-Proxy',
    timeout : 6000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var MARKER    = 9999.0001;

        /* ── Variante A: set trap re-entra durante forEach (CONFIRMADO) ──
         *
         * Comportamento observado: target[4] = 19998.0002 = MARKER×2.
         * Isso prova que forEach relê os slots via Proxy a cada iteração,
         * permitindo que uma escrita re-entrante no set trap contamine
         * iterações futuras com o valor derivado.
         *
         * Agora verificamos também se a contaminação se propaga além de [4]:
         * se target[5] = (5.5 ou MARKER×2×2), o efeito em cascata é maior.
         */
        (function variantA() {
          try {
            var target   = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
            var origCopy = target.slice(); // snapshot para comparação
            var setLog   = [];
            var reentry  = false;

            var proxy = new Proxy(target, {
              get: function (t, prop, recv) {
                var val = Reflect.get(t, prop, recv);
                if (typeof val === 'function') {
                  return function () { return val.apply(t, arguments); };
                }
                return val;
              },
              set: function (t, prop, val, recv) {
                setLog.push({ prop: prop, val: val });
                if (!reentry && setLog.length === 1) {
                  reentry = true;
                  /* Re-entrar: escrever MARKER no slot idx=4
                   * enquanto forEach ainda está no idx=0 */
                  t[4] = MARKER;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = v * 2;
            });

            /* Verificar target[4] — deve ser MARKER×2 se a re-entrância ocorreu */
            if (target[4] === MARKER * 2) {
              anomalies.push(
                'A: re-entrância confirmada — target[4]=' + target[4] +
                ' (MARKER×2, esperado ' + (origCopy[4] * 2).toFixed(4) + ')'
              );
            }

            /* Verificar propagação: se [5..7] também foram afetados */
            var cascade = [];
            for (var i = 5; i < target.length; i++) {
              var expected = origCopy[i] * 2;
              if (Math.abs(target[i] - expected) > 0.0001) {
                cascade.push({ idx: i, got: target[i], expected: expected });
              }
            }
            if (cascade.length > 0) {
              anomalies.push(
                'A: efeito em cascata além de [4]: ' +
                cascade.map(function (x) {
                  return '[' + x.idx + ']=' + x.got.toFixed(4);
                }).join(', ')
              );
            }
          } catch (e) {
            anomalies.push('A: ' + String(e));
          }
        }());

        /* ── Variante B: get 'length' não-determinístico durante map ── */
        (function variantB() {
          try {
            var target  = [1, 2, 3, 4];
            var callNum = 0;

            var proxy = new Proxy(target, {
              get: function (t, prop, recv) {
                if (prop === 'length') {
                  callNum++;
                  return target.length + (callNum % 2);
                }
                return Reflect.get(t, prop, recv);
              }
            });

            var result;
            try {
              result = proxy.map(function (v) { return v * 3; });
            } catch (e2) {
              return;
            }

            if (result && result.length > 6) {
              anomalies.push('B: map retornou ' + result.length + ' elementos com length não-determinístico');
            }
          } catch (e) {
            anomalies.push('B: ' + String(e));
          }
        }());

        /* ── Variante C: has trap durante filter ── */
        (function variantC() {
          try {
            var target = [10, 20, 30, 40, 50];
            var hasLog = [];

            var proxy = new Proxy(target, {
              has: function (t, key) {
                hasLog.push(key);
                if (hasLog.length === 2 && key === '1') {
                  delete t[1];
                }
                return Reflect.has(t, key);
              }
            });

            var result = proxy.filter(function (v) { return v > 15; });

            if (result.indexOf(20) !== -1) {
              anomalies.push('C: elemento deletado via has trap ainda presente: ' + JSON.stringify(result));
            }
          } catch (e) {
            anomalies.push('C: ' + String(e));
          }
        }());

        /* ── Variante D: defineProperty trap durante fill ── */
        (function variantD() {
          try {
            var target  = new Array(8).fill(0).map(function (_, i) { return i * 1.1; });
            var defLog  = [];

            var proxy = new Proxy(target, {
              defineProperty: function (t, prop, desc) {
                defLog.push(prop);
                if (defLog.length === 3) {
                  delete t[parseInt(prop, 10) + 1];
                }
                return Reflect.defineProperty(t, prop, desc);
              }
            });

            proxy.fill(MARKER, 0, 8);

            var bad = [];
            for (var i = 0; i < 8; i++) {
              if (target[i] !== MARKER) bad.push({ idx: i, val: target[i] });
            }
            if (bad.length > 0) {
              anomalies.push('D: fill incompleto após deleteProperty re-entrante: ' + JSON.stringify(bad));
            }
          } catch (e) {
            anomalies.push('D: ' + String(e));
          }
        }());

        /* ── Variante E: forEach cacheia o length ou relê via Proxy? ──
         *
         * Análogo direto ao bug do sort (Teste 1):
         * se forEach cacheia length=SIZE antes de iterar (como sort faz em C++),
         * reduzir o length via Proxy durante a iteração não vai parar forEach —
         * ele continuará acessando slots além do novo length.
         *
         * Dois sub-casos:
         *   E1 — length reduzido via Proxy.get mentiroso
         *   E2 — length reduzido escrevendo em target.length diretamente
         */
        (function variantE() {
          /* E1: Proxy.get retorna length menor após 2ª leitura */
          (function e1() {
            try {
              var SIZE      = 8;
              var TRUNC     = 3;
              var target    = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
              var lenReads  = 0;
              var visited   = [];

              var proxy = new Proxy(target, {
                get: function (t, prop, recv) {
                  if (prop === 'length') {
                    lenReads++;
                    /* Na 2ª+ leitura de length, mentir: retornar TRUNC */
                    if (lenReads > 1) return TRUNC;
                    return t.length;
                  }
                  return Reflect.get(t, prop, recv);
                }
              });

              Array.prototype.forEach.call(proxy, function (v, i) {
                visited.push(i);
              });

              /* Se forEach ignorou o length mentiroso e visitou todos:
               * prova que cacheou length na 1ª leitura (como sort) */
              var beyondTrunc = visited.filter(function (i) { return i >= TRUNC; });
              if (beyondTrunc.length > 0) {
                anomalies.push(
                  'E1: forEach ignorou length=TRUNC mentiroso, visitou idx [' +
                  beyondTrunc.join(', ') + '] além de ' + TRUNC
                );
              }
            } catch (e) {
              anomalies.push('E1: ' + String(e));
            }
          }());

          /* E2: target.length truncado dentro do callback de forEach */
          (function e2() {
            try {
              var SIZE     = 8;
              var TRUNC    = 3;
              var target   = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
              var truncated = false;
              var visited  = [];
              var vals     = [];

              target.forEach(function (v, i) {
                visited.push(i);
                vals.push(v);
                if (!truncated && i === 1) {
                  truncated = true;
                  target.length = TRUNC; /* truncar durante o forEach */
                }
              });

              /* Se forEach cacheou length=8: visitará todos 8 slots,
               * incluindo [3..7] cujos valores podem ser undefined
               * (slots além do novo length). */
              var beyondTrunc = visited.filter(function (i) { return i >= TRUNC; });

              if (beyondTrunc.length > 0) {
                /* Verificar se os valores eram defined ou undefined */
                var undefReads = [];
                beyondTrunc.forEach(function (i) {
                  var pos = visited.indexOf(i);
                  if (vals[pos] === undefined) undefReads.push(i);
                });

                anomalies.push(
                  'E2: forEach visitou ' + beyondTrunc.length +
                  ' slots além de length truncado para ' + TRUNC +
                  ' | idx visitados=[' + beyondTrunc.join(', ') + ']' +
                  (undefReads.length > 0
                    ? ' | undefined em [' + undefReads.join(', ') + ']'
                    : ' | todos defined')
                );
              }
            } catch (e) {
              anomalies.push('E2: ' + String(e));
            }
          }());
        }());

        /* ── Variante F: Proxy.set dispara Double→Contiguous durante forEach ──
         *
         * Combina a re-entrância de A com mutação de tipo da butterfly.
         * O set trap força a transição de tipo no momento em que forEach
         * está no meio de uma iteração. Se o JSC não atualiza o iterador
         * interno para o novo layout, pode acessar slots com interpretação errada.
         *
         * Detectamos: tipo corrompido, valor inesperado, ou exceção interna.
         */
        (function variantF() {
          try {
            /* DoubleArray: todos floats */
            var target      = [1.1, 2.2, 3.3, 4.4, 5.5];
            var transitioned = false;
            var readAfterTrans = [];

            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                if (!transitioned && typeof prop === 'string' && !isNaN(parseInt(prop, 10))) {
                  transitioned = true;
                  /* Forçar Double→Contiguous durante o set do forEach */
                  t[0] = { sentinel: true }; /* objetos → ContiguousArray */
                }
                return Reflect.set(t, prop, val, recv);
              },
              get: function (t, prop, recv) {
                var val = Reflect.get(t, prop, recv);
                /* Capturar leituras de índices numéricos após transição */
                if (transitioned && !isNaN(parseInt(prop, 10))) {
                  readAfterTrans.push({ prop: prop, type: typeof val, val: val });
                }
                if (typeof val === 'function') {
                  return function () { return val.apply(t, arguments); };
                }
                return val;
              }
            });

            /* forEach que escreve de volta via proxy (dispara set trap) */
            proxy.forEach(function (v, i) {
              proxy[i] = (typeof v === 'number') ? v * 2 : v;
            });

            /* Verificar integridade após transição de tipo */
            var corrupt = [];
            for (var i = 1; i < target.length; i++) {
              /* [0] foi setado para objeto — pular */
              if (typeof target[i] !== 'number' && typeof target[i] !== 'object') {
                corrupt.push({ idx: i, type: typeof target[i], val: target[i] });
              }
            }

            if (corrupt.length > 0) {
              anomalies.push(
                'F: tipo corrompido após Double→Contiguous durante forEach: ' +
                JSON.stringify(corrupt)
              );
            }

            /* Se houve leituras após transição com tipo inesperado */
            var badReads = readAfterTrans.filter(function (r) {
              return r.type !== 'number' && r.type !== 'object' && r.type !== 'undefined';
            });
            if (badReads.length > 0) {
              anomalies.push(
                'F: leituras com tipo inesperado após transição: ' +
                JSON.stringify(badReads.slice(0, 4))
              );
            }
          } catch (e) {
            /* TypeError pode ocorrer ao multiplicar {} por 2 — não é anomalia */
            if (!(e instanceof TypeError)) {
              anomalies.push('F: exceção inesperada: ' + String(e));
            }
          }
        }());

        /* ── Resolver ── */
        if (anomalies.length > 0) {
          resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
        } else {
          resolve({ status: 'PASS', detail: 'A-F sem anomalias' });
        }
      });
    }
  };

}(window));

