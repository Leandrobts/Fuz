'use strict';
/**
 * Teste 4 — DOM lifecycle stress
 *
 * Foca em races entre criação de elementos, disparo de eventos e remoção.
 * No WebKit/PS4 sem JIT, o custo de cada operação DOM é mais previsível,
 * mas os callbacks C++ (MutationObserver, event listeners) ainda podem
 * criar janelas de UAF se o lifetime do nó não for corretamente protegido.
 *
 * Variantes:
 *   A — createElement + appendChild + removeChild em loop (200×)
 *       com listener que modifica o próprio pai durante o evento
 *   B — MutationObserver que remove nós durante o callback de addedNodes
 *   C — iframe criação/remoção antes do load (Manx relevante)
 *   D — style mutation em loop + forçar layout (getBoundingClientRect)
 *   E — EventTarget.addEventListener + dispatchEvent + removeEventListener
 *       em objeto não-anexado ao DOM
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['4'] = {
    id      : 4,
    name    : 'DOM lifecycle — criação/remoção rápida, MutationObserver, iframe',
    category: 'DOM',
    timeout : 7000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var root      = document.createElement('div');
        document.body.appendChild(root);

        /* ── Variante A: ciclo create/append/remove com listener re-entrante ── */
        (function variantA() {
          for (var i = 0; i < 200; i++) {
            var parent = document.createElement('div');
            var child  = document.createElement('span');
            parent.appendChild(child);
            root.appendChild(parent);

            /* Listener que remove o próprio nó ao ser chamado */
            child.addEventListener('click', function onClick(e) {
              var node = e.currentTarget;
              node.removeEventListener('click', onClick);
              if (node.parentNode) {
                try { node.parentNode.removeChild(node); } catch (_) {}
              }
            });

            root.removeChild(parent);
          }
          /* Verificar: root deve estar vazio */
          if (root.childNodes.length !== 0) {
            anomalies.push('A: root tem ' + root.childNodes.length + ' filhos após cleanup');
          }
        }());

        /* ── Variante B: MutationObserver remove nós no callback ── */
        (function variantB() {
          var observed  = document.createElement('div');
          root.appendChild(observed);
          var obs = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
              m.addedNodes.forEach(function (node) {
                if (node.parentNode) {
                  try { node.parentNode.removeChild(node); } catch (_) {}
                }
              });
            });
          });
          obs.observe(observed, { childList: true, subtree: true });

          for (var i = 0; i < 50; i++) {
            var el = document.createElement('p');
            observed.appendChild(el);
          }

          obs.disconnect();

          /* Flush de observers pendentes */
          var records = obs.takeRecords();

          if (observed.childNodes.length > 5) {
            /* Se sobrou muita coisa, o observer pode ter perdido eventos */
            anomalies.push('B: observed.childNodes=' + observed.childNodes.length + ' após observer removal');
          }
          if (observed.parentNode) {
            try { observed.parentNode.removeChild(observed); } catch (_) {}
          }
        }());

        /* ── Variante C: iframe lifecycle antes do load ── */
        (function variantC() {
          for (var i = 0; i < 15; i++) {
            var iframe    = document.createElement('iframe');
            iframe.srcdoc = '<html><body>test ' + i + '</body></html>';
            root.appendChild(iframe);

            /* Remover antes do evento load — estado interno de Manx */
            if (i % 3 === 0) {
              /* Imediatamente */
              root.removeChild(iframe);
            } else if (i % 3 === 1) {
              /* Via timeout minúsculo */
              (function (fr) {
                setTimeout(function () {
                  if (fr.parentNode) { try { fr.parentNode.removeChild(fr); } catch (_) {} }
                }, 0);
              }(iframe));
            } else {
              /* Depois do onload */
              (function (fr) {
                fr.onload = function () {
                  if (fr.parentNode) { try { fr.parentNode.removeChild(fr); } catch (_) {} }
                };
              }(iframe));
            }
          }
        }());

        /* ── Variante D: style mutation + forçar layout ── */
        (function variantD() {
          var el = document.createElement('div');
          root.appendChild(el);
          for (var i = 0; i < 300; i++) {
            el.style.width   = (i % 100) + 'px';
            el.style.display = (i % 2 === 0) ? 'block' : 'inline-block';
            if (i % 50 === 0) {
              /* Força layout — pode expor bugs de recálculo de estilo */
              void el.getBoundingClientRect();
            }
          }
          root.removeChild(el);
        }());

        /* ── Variante E: addEventListener/dispatchEvent/remove em nó desanexado ── */
        (function variantE() {
          try {
            var detached = document.createElement('button');
            /* NÃO anexar ao DOM */
            var callCount = 0;
            var handler   = function () { callCount++; };
            detached.addEventListener('click', handler);
            detached.dispatchEvent(new Event('click'));
            detached.dispatchEvent(new Event('click'));
            detached.removeEventListener('click', handler);
            detached.dispatchEvent(new Event('click')); /* não deve incrementar */

            if (callCount !== 2) {
              anomalies.push('E: callCount=' + callCount + ' (esperado 2)');
            }
          } catch (e) {
            anomalies.push('E: ' + String(e));
          }
        }());

        /* ── Cleanup e resolução ── */
        setTimeout(function () {
          try {
            /* Aguarda iframes de variantC que usaram setTimeout(0) */
            while (root.firstChild) root.removeChild(root.firstChild);
            if (root.parentNode) root.parentNode.removeChild(root);
          } catch (_) {}

          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-E sem anomalias' });
          }
        }, 800);
      });
    }
  };

}(window));
