'use strict';
/**
 * Teste 6 — WebCore: MessagePort & Detached Contexts UAF
 *
 * Foco: Transferência de propriedade (Transferable Objects) para um 
 * contexto (iframe) que é imediatamente destruído, testando a resiliência
 * da fila assíncrona do WebKit MessagePort C++ backend.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['6'] = {
    id      : 6,
    name    : 'WebCore.MessagePort — In-flight UAF and detached contexts',
    category: 'WebCore-MessagePort-UAF',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var sandbox = document.createElement('div');
      sandbox.id = 'fuzzer-sandbox-6';
      document.body.appendChild(sandbox);

      (function variantA() {
        try {
          var iframe = document.createElement('iframe');
          sandbox.appendChild(iframe);
          
          if (!iframe.contentWindow) return;

          var channel = new MessageChannel();
          var port1 = channel.port1;
          var port2 = channel.port2;

          /* Envia a porta 2 para dentro do iframe, transferindo a propriedade */
          iframe.contentWindow.postMessage('init', '*', [port2]);

          /* Configura o canal local para receber respostas */
          port1.onmessage = function(e) {
            try {
              if (e.data === 'leak' && typeof e.ports[0] === 'object') {
                /* Se a porta sobreviveu, tentamos acessar propriedades no momento errado */
                var p = e.ports[0];
                p.start();
              }
            } catch(err) {}
          };

          /* Engatilha tráfego na porta antes da destruição */
          port1.postMessage('trigger');

          /* Destruição violenta: Remove o iframe do DOM imediatamente.
           * O backend do MessagePort no C++ agora tem uma mensagem pendente
           * direcionada a um Document/DOMWindow que está sendo coletado. */
          sandbox.removeChild(iframe);

          /* Spray massivo na fila de eventos para forçar a reutilização da página de memória do iframe */
          var spray = [];
          for (var i = 0; i < 1000; i++) {
            spray.push(new ArrayBuffer(1024 * 64)); // 64MB totais de pressão no heap
          }

          /* A validação do UAF neste teste ocorre fora da thread síncrona.
           * Se o C++ falhar ao lidar com o porto órfão, o fuzzer reportará um CRASH via worker heartbeat. */
          
        } catch (e) {
          anomalies.push('A: ' + String(e));
        }
      }());

      /* O sandbox já teve o iframe removido, mas garantimos a limpeza completa */
      if (document.body.contains(sandbox)) {
        document.body.removeChild(sandbox);
      }

      if (anomalies.length > 0) {
        return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      }
      return { status: 'PASS', detail: 'MessagePort transferido e contexto destruído (Crash via IPC esperado)' };
    }
  };

}(window));
