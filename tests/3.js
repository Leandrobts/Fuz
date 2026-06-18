'use strict';
/**
 * Teste 3 — WebCore: MutationObserver & Synchronous Events
 *
 * Foco: Ciclo de vida de microtasks e desincronização de RenderTree.
 * Obs: Utiliza DOMNodeInserted (síncrono) para forçar re-entrância 
 * e tentar causar UAF no callback de microtask pendente.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['3'] = {
    id      : 3,
    name    : 'WebCore.MutationObserver — Re-entrancy and GC timing',
    category: 'WebCore-MutationObserver',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var sandbox = document.createElement('div');
      sandbox.id = 'fuzzer-sandbox-3';
      document.body.appendChild(sandbox);

      /* ── Variante A: Re-entrância via Sync Events ────────────────── */
      (function variantA() {
        try {
          var parent = document.createElement('div');
          var child = document.createElement('span');
          var handlerFired = 0;

          parent.addEventListener('DOMNodeInserted', function handler(e) {
            handlerFired++;
            if (handlerFired === 1) {
              /* Destrói a si mesmo no meio do dispatching */
              parent.removeEventListener('DOMNodeInserted', handler);
              sandbox.removeChild(parent);
              
              /* Tenta injetar lixo na memória recém-liberada */
              var spray = new Uint32Array(1024);
              spray.fill(0x41414141);
            }
          });

          sandbox.appendChild(parent);
          /* Dispara o trigger síncrono */
          parent.appendChild(child);

          /* Se child.parentNode ainda for parent, OK. Se for undefined/lixo = bug */
          if (child.parentNode) {
            if (typeof child.parentNode.nodeType !== 'number') {
              anomalies.push('A: Type confusion no ponteiro do parentNode após evento sync');
            }
          }
        } catch (e) {
          anomalies.push('A: ' + String(e));
        }
      }());

      /* ── Variante B: Iframe Destruction pós MutationObserver setup ─ */
      (function variantB() {
        try {
          var iframe = document.createElement('iframe');
          sandbox.appendChild(iframe);
          var idoc = iframe.contentDocument;
          
          if (!idoc) return; // Se o iframe não renderizou a tempo, pula.

          var target = idoc.createElement('div');
          idoc.body.appendChild(target);

          var obs = new MutationObserver(function(mutations) {
            /* Como este é um microtask, pode rodar depois do fuzzer retornar PASS.
             * Se ele rodar e houver UAF, causará CRASH no worker.
             * Se sobreviver, tentamos pegar anomalias lógicas. */
            try {
              var m = mutations[0];
              var node = m.addedNodes[0];
              if (node && !node.ownerDocument) {
                // Log via console pois o run() já pode ter retornado
                console.warn('Fuzzer [3-B]: ownerDocument é nulo no callback de microtask');
              }
            } catch(e) {}
          });

          obs.observe(target, { childList: true });

          /* Mutação dispara o agendamento da microtask */
          target.appendChild(idoc.createElement('br'));

          /* Destruição violenta do contexto antes da microtask rodar */
          sandbox.removeChild(iframe);
          
        } catch (e) {
          anomalies.push('B: ' + String(e));
        }
      }());

      document.body.removeChild(sandbox);

      if (anomalies.length > 0) {
        return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      }
      return { status: 'PASS', detail: 'Mutation events processados (callback pendente pode causar crash)' };
    }
  };

}(window));
