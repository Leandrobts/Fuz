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

        /* ── Variante A2: re-entrância sem flag — mede profundidade do loop ──
         *
         * A original tem flag `reentry` que limita a 1 re-entrada.
         * Aqui removemos a proteção e usamos um contador para medir
         * quantas vezes o set trap dispara recursivamente antes de
         * o motor detectar stack overflow ou encerrar.
         *
         * Se o motor não detectar a recursão e o contador explodir,
         * é evidência de que a cadeia de re-entrância é arbitrariamente profunda.
         */
        (function variantA2() {
          try {
            var target   = [1.1, 2.2, 3.3, 4.4, 5.5];
            var depth    = 0;
            var MAX_SAFE = 50; /* limite de segurança para evitar stack overflow real */

            var proxy = new Proxy(target, {
              get: function (t, prop, recv) {
                var val = Reflect.get(t, prop, recv);
                if (typeof val === 'function') {
                  return function () { return val.apply(t, arguments); };
                }
                return val;
              },
              set: function (t, prop, val, recv) {
                depth++;
                if (depth < MAX_SAFE && !isNaN(parseInt(prop, 10))) {
                  /* Re-entrar: escrever no próximo slot, disparando set de novo */
                  var nextIdx = (parseInt(prop, 10) + 1) % target.length;
                  t[nextIdx] = (typeof val === 'number') ? val + 0.0001 : val;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = v * 2;
            });

            if (depth >= MAX_SAFE) {
              anomalies.push(
                'A2: re-entrância ilimitada detectada — depth=' + depth +
                ' atingiu MAX_SAFE=' + MAX_SAFE +
                ' (cadeia potencialmente arbitrária)'
              );
            } else {
              /* Registrar profundidade real como info */
              anomalies.push('A2: INFO — profundidade de re-entrância: depth=' + depth);
            }
          } catch (e) {
            /* Stack overflow esperado se a recursão for real */
            var isStackOF = /stack|recursion|maximum call/i.test(String(e));
            anomalies.push(
              'A2: ' + (isStackOF ? 'stack overflow confirmado' : 'exceção inesperada') +
              ' — ' + String(e)
            );
          }
        }());

        /* ── Variante A3: re-entrância com objeto {} — força Double→Contiguous ──
         *
         * Em vez de escrever MARKER (float), a re-entrância escreve um objeto
         * no slot [4] durante o set do slot [0]. Isso força a transição
         * DoubleArray→ContiguousArray NO MEIO da iteração do forEach.
         * Se o forEach não atualiza o ponteiro interno de iteração para o
         * novo layout da butterfly, o acesso subsequente a [5..7] pode ler
         * slots com a interpretação de tipo errada.
         */
        (function variantA3() {
          try {
            var target    = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7]; /* DoubleArray */
            var reentry   = false;
            var sentinel  = { injected: true, uid: 0xCAFE };
            var readTypes = [];

            var proxy = new Proxy(target, {
              get: function (t, prop, recv) {
                var val = Reflect.get(t, prop, recv);
                /* Capturar tipo de cada leitura de slot numérico após transição */
                if (reentry && !isNaN(parseInt(prop, 10))) {
                  readTypes.push({ prop: prop, type: typeof val });
                }
                if (typeof val === 'function') {
                  return function () { return val.apply(t, arguments); };
                }
                return val;
              },
              set: function (t, prop, val, recv) {
                if (!reentry && prop === '0') {
                  reentry = true;
                  /* Injetar objeto no slot [4] — força transição de tipo */
                  t[4] = sentinel;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = (typeof v === 'number') ? v * 2 : v;
            });

            /* Verificar slot [4]: deve ter o sentinel injetado */
            if (target[4] !== sentinel && !(target[4] && target[4].injected)) {
              anomalies.push(
                'A3: sentinel não encontrado em target[4] após transição: ' +
                typeof target[4] + '=' + target[4]
              );
            }

            /* Verificar se forEach leu tipos incorretos após a transição */
            var badTypes = readTypes.filter(function (r) {
              return r.type !== 'number' && r.type !== 'object' && r.type !== 'undefined';
            });
            if (badTypes.length > 0) {
              anomalies.push(
                'A3: tipos inesperados em leituras pós-transição: ' +
                JSON.stringify(badTypes)
              );
            }

            /* Verificar slots [5..6]: devem ser double*2, não corrompidos */
            var corrupt = [];
            for (var i = 5; i < 7; i++) {
              if (typeof target[i] !== 'number') {
                corrupt.push({ idx: i, type: typeof target[i] });
              }
            }
            if (corrupt.length > 0) {
              anomalies.push('A3: slots corrompidos após transição: ' + JSON.stringify(corrupt));
            }
          } catch (e) {
            if (!(e instanceof TypeError)) {
              anomalies.push('A3: exceção inesperada: ' + String(e));
            }
          }
        }());
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

              var beyondTrunc = visited.filter(function (i) { return i >= TRUNC; });

              if (beyondTrunc.length > 0) {
                var undefReads = [];
                beyondTrunc.forEach(function (i) {
                  var pos = visited.indexOf(i);
                  if (vals[pos] === undefined) undefReads.push(i);
                });

                anomalies.push(
                  'E2: forEach visitou ' + beyondTrunc.length +
                  ' slots além de length truncado para ' + TRUNC +
                  ' | idx=[' + beyondTrunc.join(', ') + ']' +
                  (undefReads.length > 0
                    ? ' | undefined em [' + undefReads.join(', ') + ']'
                    : ' | todos defined')
                );
              }
            } catch (e) {
              anomalies.push('E2: ' + String(e));
            }
          }());

          /* ── E3: Proxy retorna length=0 — forEach não deveria visitar nada ──
           *
           * Caso extremo de E1: se o Proxy mente que length=0 na 1ª leitura,
           * forEach deveria encerrar imediatamente sem visitar nenhum slot.
           * Se visitar algum slot, o length cacheado é ignorado ou há outro
           * mecanismo de iteração que não depende do length do Proxy.
           */
          (function e3() {
            try {
              var target  = [10, 20, 30, 40, 50];
              var visited = [];

              var proxy = new Proxy(target, {
                get: function (t, prop, recv) {
                  if (prop === 'length') return 0; /* mentir: array vazio */
                  return Reflect.get(t, prop, recv);
                }
              });

              Array.prototype.forEach.call(proxy, function (v, i) {
                visited.push({ i: i, v: v });
              });

              if (visited.length > 0) {
                anomalies.push(
                  'E3: forEach visitou ' + visited.length + ' slot(s) com length=0 via Proxy' +
                  ' — idx=[' + visited.map(function (x) { return x.i; }).join(', ') + ']'
                );
              }
            } catch (e) {
              anomalies.push('E3: ' + String(e));
            }
          }());

          /* ── E4: deletar slot durante iteração dos extras (além do TRUNC mentiroso) ──
           *
           * Combina E1 (length mentiroso) com deleção de slot durante o callback.
           * Quando forEach está num slot "extra" (>= TRUNC), deletamos o slot
           * seguinte. Se forEach usa HasProperty para decidir se chama o callback,
           * o slot deletado deve ser pulado. Verificamos se o valor do slot
           * deletado aparece mesmo assim no callback (indicando que HasProperty
           * não foi relido após deleção, ou que o valor foi cacheado).
           */
          (function e4() {
            try {
              var TRUNC   = 3;
              var target  = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
              var lenReads = 0;
              var visited  = [];
              var deleted  = [];

              var proxy = new Proxy(target, {
                get: function (t, prop, recv) {
                  if (prop === 'length') {
                    lenReads++;
                    if (lenReads > 1) return TRUNC; /* mente após 1ª leitura */
                    return t.length;
                  }
                  return Reflect.get(t, prop, recv);
                }
              });

              Array.prototype.forEach.call(proxy, function (v, i) {
                visited.push({ i: i, v: v });
                /* Durante slots extras, deletar o próximo */
                if (i >= TRUNC && i + 1 < target.length) {
                  delete target[i + 1];
                  deleted.push(i + 1);
                }
              });

              var extras = visited.filter(function (x) { return x.i >= TRUNC; });
              if (extras.length > 0) {
                /* Verificar se algum slot deletado apareceu no callback */
                var deletedButVisited = extras.filter(function (x) {
                  return deleted.indexOf(x.i) !== -1;
                });
                var detail = 'E4: extras visitados=[' +
                  extras.map(function (x) { return x.i; }).join(', ') + ']';
                if (deletedButVisited.length > 0) {
                  detail += ' | slots deletados-mas-visitados=[' +
                    deletedButVisited.map(function (x) { return x.i; }).join(', ') + ']';
                }
                anomalies.push(detail);
              }
            } catch (e) {
              anomalies.push('E4: ' + String(e));
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
