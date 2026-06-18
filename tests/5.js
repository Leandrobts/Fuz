'use strict';
/**
 * Teste 5 — WebCore: UI Events & Target Teardown UAF
 *
 * Foco: Forçar o C++ a iterar sobre uma cadeia de eventos (bubbling)
 * onde os nós ancestrais ou o próprio target são destruídos de forma
 * re-entrante durante a execução dos callbacks síncronos.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['5'] = {
    id      : 5,
    name    : 'WebCore.Events — Re-entrant dispatch and node teardown',
    category: 'WebCore-Events-UAF',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var sandbox = document.createElement('div');
      sandbox.id = 'fuzzer-sandbox-5';
      document.body.appendChild(sandbox);

      /* ── Variante A: Bubbling Chain Destruction ──────────────────────── */
      (function variantA() {
        try {
          var form = document.createElement('form');
          var input = document.createElement('input');
          form.appendChild(input);
          sandbox.appendChild(form);

          var step = 0;
          var savedEvent = null;

          form.addEventListener('focus', function(e) {
            step++;
            /* O alvo original (input) disparou o evento que agora subiu para o form.
             * Destruímos a árvore inteira agora. */
            sandbox.innerHTML = '';
            
            /* Tenta forçar a sobrescrita do C++ backing object (Heap Spray básico) */
            var spray = [];
            for (var i = 0; i < 500; i++) {
              var ta = new Uint32Array(1024);
              ta.fill(0x41414141);
              spray.push(ta);
            }

            savedEvent = e;
          }, true); // Capturing phase

          /* Dispara o evento de forma síncrona */
          input.focus();

          /* Uso pós-liberação: O motor ainda sabe quem é o e.target? */
          if (savedEvent) {
            var t = savedEvent.target;
            if (t) {
              if (typeof t.nodeType !== 'number') {
                anomalies.push('A: target corrompido no evento salvo (Type Confusion)');
              } else if (t.parentNode !== null) {
                /* Se o input ainda acha que tem um pai, os ponteiros do C++ estão desincronizados
                 * pois sandbox.innerHTML = '' deveria ter isolado a árvore. */
                anomalies.push('A: input zumbi relata parentNode ativo após innerHTML nuke');
              }
            }
          }
        } catch (e) {
          anomalies.push('A: ' + String(e));
        }
      }());

      document.body.removeChild(sandbox);

      if (anomalies.length > 0) {
        return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      }
      return { status: 'PASS', detail: 'Event bubbling sobreviveu à destruição síncrona' };
    }
  };

}(window));
