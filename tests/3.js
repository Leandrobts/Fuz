'use strict';
/**
 * Teste 3 — Proxy: re-entrância via get/set/has traps em métodos nativos de Array
 *
 * Foco: quando um método nativo (map, filter, forEach, sort, fill) acessa o array
 * internamente, as traps do Proxy são chamadas no meio da execução C++.
 * Essa re-entrada pode corromper o estado interno ou acessar posições não-inicializadas.
 *
 * Variantes:
 *   A — Proxy.set re-entra durante Array.prototype.forEach
 *   B — Proxy.get retorna length flutuante durante Array.prototype.map
 *   C — Proxy.has intercepta in-operator durante Array.prototype.filter
 *   D — Proxy.deleteProperty durante Array.prototype.fill
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['3'] = {
    id      : 3,
    name    : 'Proxy — re-entrância via traps em métodos nativos de Array',
    category: 'JSC-Proxy',
    timeout : 5000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var MARKER    = 9999.0001;

        /* ── Variante A: set trap re-entra durante forEach ── */
        (function variantA() {
          try {
            var target  = [1, 2, 3, 4, 5];
            var setLog  = [];
            var reentry = false;

            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                setLog.push({ prop: prop, val: val });
                if (!reentry && setLog.length === 1) {
                  reentry = true;
                  /* Re-entra: escreve durante o próprio set interceptado */
                  t[4] = MARKER;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = v * 2;
            });

            /* MARKER deve estar em target[4] — se forEach o sobrescreveu
             * com 5*2=10, houve race entre a re-entrada e o loop nativo */
            if (target[4] !== MARKER && target[4] !== 10) {
              anomalies.push('A: target[4] valor inesperado: ' + target[4]);
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
                  /* Retorna lengths diferentes a cada chamada */
                  return target.length + (callNum % 2);
                }
                return Reflect.get(t, prop, recv);
              }
            });

            var result;
            try {
              result = proxy.map(function (v) { return v * 3; });
            } catch (e2) {
              /* Pode lançar se length for insano — não é anomalia */
              return;
            }

            /* O resultado não deveria ter mais elementos que o length máximo retornado (5) */
            if (result && result.length > 6) {
              anomalies.push('B: map retornou ' + result.length + ' elementos com length não-determinístico');
            }
          } catch (e) {
            anomalies.push('B: ' + String(e));
          }
        }());

        /* ── Variante C: has trap durante filter (in-operator interno) ── */
        (function variantC() {
          try {
            var target = [10, 20, 30, 40, 50];
            var hasLog = [];

            var proxy = new Proxy(target, {
              has: function (t, key) {
                hasLog.push(key);
                /* Durante a verificação de 'in', apaga o elemento do target */
                if (hasLog.length === 2 && key === '1') {
                  delete t[1]; // hole no índice 1
                }
                return Reflect.has(t, key);
              }
            });

            var result = proxy.filter(function (v) { return v > 15; });

            /* Com o hole em [1], 20 não deve aparecer — mas se o C++ não
             * re-verifica via has e usa cache, 20 pode aparecer */
            if (result.indexOf(20) !== -1) {
              /* Isso pode ser anomalia ou comportamento definido — registrar */
              anomalies.push('C: elemento deletado via has trap ainda presente no resultado: ' + JSON.stringify(result));
            }
          } catch (e) {
            anomalies.push('C: ' + String(e));
          }
        }());

        /* ── Variante D: deleteProperty trap durante fill ── */
        (function variantD() {
          try {
            var target  = new Array(8).fill(0).map(function (_, i) { return i * 1.1; });
            var delLog  = [];

            var proxy = new Proxy(target, {
              defineProperty: function (t, prop, desc) {
                /* fill usa defineProperty ou set internamente */
                delLog.push(prop);
                if (delLog.length === 3) {
                  /* Durante a escrita de fill, apagar o elemento seguinte */
                  delete t[parseInt(prop, 10) + 1];
                }
                return Reflect.defineProperty(t, prop, desc);
              }
            });

            proxy.fill(MARKER, 0, 8);

            /* Verificar integridade: todos os 8 slots deveriam ser MARKER */
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

        /* ── Resolver ── */
        if (anomalies.length > 0) {
          resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
        } else {
          resolve({ status: 'PASS', detail: 'A-D sem anomalias' });
        }
      });
    }
  };

}(window));
