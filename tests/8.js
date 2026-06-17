'use strict';
/**
 * Teste 8 — SharedWorker lifecycle: races de connect/close/postMessage
 *
 * O diagnóstico confirma: sharedWorker: true.
 * Contexto: bug de $500 HackerOne foi confirmado neste subsistema.
 * O SharedWorker em WebKit mantém uma lista de MessagePorts associados.
 * Races entre connect, port.close(), postMessage e self.close() podem
 * expor UAF ou state machine corruption no lado C++.
 *
 * Dependência: workers/shared-worker.js deve estar acessível no servidor.
 *
 * Variantes:
 *   A — Connect + port.close() imediato, antes mesmo de start()
 *   B — postMessage enviado antes de port.start() (mensagem deve ser enfileirada)
 *   C — Múltiplas conexões simultâneas ao mesmo SharedWorker
 *   D — postMessage após port.close() (deve lançar InvalidStateError)
 *   E — Worker self.close() enquanto porta ainda está ativa
 *   F — Reconectar ao mesmo SharedWorker após self.close()
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['8'] = {
    id      : 8,
    name    : 'SharedWorker — connect/close races, multi-port, self.close() com porta ativa',
    category: 'Worker',
    timeout : 10000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var WORKER_URL = 'workers/shared-worker.js';

        /* Verificar suporte */
        if (typeof SharedWorker === 'undefined') {
          return resolve({ status: 'PASS', detail: 'SharedWorker não disponível — skip' });
        }

        /* ── Helper: cria nova instância do SharedWorker com cache-bust ──
         * Cada variante usa uma URL ligeiramente diferente para garantir
         * que não compartilha estado com outras variantes.
         * SharedWorkers são identificados por (URL + name), então name
         * único isola cada variante.                                      */
        function makeWorker(name) {
          return new SharedWorker(WORKER_URL, { name: name || ('fuzz-' + Date.now()) });
        }

        /* ── Helper: Promise que aguarda a primeira mensagem de uma porta ── */
        function waitMsg(port, timeoutMs) {
          return new Promise(function (res) {
            var timer = setTimeout(function () { res(null); }, timeoutMs || 2000);
            port.onmessage = function (e) {
              clearTimeout(timer);
              port.onmessage = null;
              res(e.data);
            };
          });
        }

        var pending = 6;
        function done(varName, anomaly) {
          if (anomaly) anomalies.push(varName + ': ' + anomaly);
          if (--pending <= 0) {
            if (anomalies.length > 0) {
              resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
            } else {
              resolve({ status: 'PASS', detail: 'A-F sem anomalias' });
            }
          }
        }

        /* ── Variante A: close() imediato antes de start() ── */
        (function variantA() {
          try {
            var w    = makeWorker('fuzz-A');
            var port = w.port;
            /* Fechar porta sem ter chamado start() — não deve crashar */
            port.close();
            /* Tentar usar a porta fechada */
            try {
              port.postMessage('after-close-no-start');
            } catch (e) {
              /* InvalidStateError esperado */
            }
            done('A');
          } catch (e) {
            done('A', String(e));
          }
        }());

        /* ── Variante B: postMessage antes de port.start() ──
         *
         * Fix: o handler anterior não filtrava a mensagem 'connected'
         * que o SharedWorker envia imediatamente ao conectar, antes
         * mesmo de processar qualquer mensagem enfileirada.
         * Agora ignoramos 'connected' e aguardamos especificamente 'pong'.
         */
        (function variantB() {
          try {
            var w    = makeWorker('fuzz-B');
            var port = w.port;

            var gotPong  = false;
            var gotConn  = false;

            port.onmessage = function (e) {
              if (e.data && e.data.type === 'connected') {
                /* Mensagem de handshake inicial — ignorar, aguardar pong */
                gotConn = true;
                return;
              }
              if (e.data && e.data.type === 'pong') {
                gotPong = true;
                return;
              }
              /* Qualquer outra resposta é inesperada */
              anomalies.push('B: resposta inesperada após ping: ' + JSON.stringify(e.data));
            };

            /* postMessage ANTES de start() — deve ser enfileirado no port */
            port.postMessage({ cmd: 'ping' });

            /* start() libera a fila — 'connected' chega primeiro, depois 'pong' */
            port.start();

            setTimeout(function () {
              if (!gotPong) {
                anomalies.push(
                  'B: pong nunca chegou após start()' +
                  ' (connected=' + gotConn + ')'
                );
              }
              port.close();
              done('B');
            }, 2000);
          } catch (e) {
            done('B', String(e));
          }
        }());

        /* ── Variante C: múltiplas conexões simultâneas ── */
        (function variantC() {
          try {
            /* Mesmo nome = mesmo worker, portas distintas */
            var wName = 'fuzz-C-' + Date.now();
            var ports = [];
            var N     = 5;

            for (var i = 0; i < N; i++) {
              var w = makeWorker(wName);
              ports.push(w.port);
              w.port.start();
            }

            /* Perguntar a contagem de portas para o worker via a última porta */
            var lastPort  = ports[ports.length - 1];
            var gotCount  = false;
            var savedHandler = lastPort.onmessage;

            lastPort.onmessage = function (e) {
              if (e.data && e.data.type === 'port-count') {
                gotCount = true;
                var count = e.data.count;
                if (count < 1 || count > N + 2) {
                  /* Margem de +2 para workers que possam ter portas de rounds anteriores */
                  anomalies.push('C: port-count=' + count + ' inesperado para N=' + N);
                }
              } else if (e.data && e.data.type === 'connected') {
                /* Ignorar mensagem de connected — esperar port-count */
                lastPort.postMessage({ cmd: 'port-count' });
              }
            };

            setTimeout(function () {
              if (!gotCount) {
                anomalies.push('C: port-count nunca respondido');
              }
              ports.forEach(function (p) { try { p.close(); } catch (_) {} });
              done('C');
            }, 2500);
          } catch (e) {
            done('C', String(e));
          }
        }());

        /* ── Variante D: postMessage após port.close() ──
         *
         * CONFIRMADO: WebKit 605.1.15 faz silent drop, igual ao 6-B.
         *
         * D1 — comportamento base (mantido)
         * D2 — verificar se o worker recebeu a mensagem "silenciada"
         *       abrindo uma nova conexão e consultando o msgCount do worker
         * D3 — race síncrono: postMessage→close() na mesma call stack
         *       sem aguardar 'connected' — testa o caminho de dispatch
         *       antes do handshake completar
         */
        (function variantD() {
          /* D1: base confirmado */
          (function d1() {
            try {
              var w    = makeWorker('fuzz-D1');
              var port = w.port;
              port.start();

              port.onmessage = function (e) {
                if (e.data && e.data.type === 'connected') {
                  port.onmessage = null;
                  port.close();

                  var threw = false;
                  try {
                    port.postMessage({ cmd: 'ping' });
                  } catch (e2) {
                    threw = true;
                    if ((e2.name || '') !== 'InvalidStateError') {
                      anomalies.push('D1: exceção inesperada: ' + e2.name);
                    }
                  }
                  if (!threw) {
                    anomalies.push('D1: silent drop confirmado — postMessage não lançou exceção após close()');
                  }
                }
              };
              setTimeout(function () {
                if (w.port.onmessage !== null) {
                  anomalies.push('D1: connected nunca recebido');
                }
              }, 2000);
            } catch (e) {
              anomalies.push('D1: ' + String(e));
            }
          }());

          /* D2: o worker recebeu a mensagem "silenciada"?
           * Após o silent drop, abrimos uma 2ª conexão e pedimos o msgCount.
           * Se msgCount > 0, o worker processou a mensagem mesmo com a porta fechada. */
          (function d2() {
            try {
              var wName  = 'fuzz-D2-' + Date.now();
              var w1     = makeWorker(wName);
              w1.port.start();

              w1.port.onmessage = function (e) {
                if (e.data && e.data.type === 'connected') {
                  w1.port.onmessage = null;
                  w1.port.close();
                  try { w1.port.postMessage({ cmd: 'ping' }); } catch (_) {}

                  /* Aguardar 200ms e abrir nova conexão para consultar msgCount */
                  setTimeout(function () {
                    try {
                      var w2 = makeWorker(wName);
                      w2.port.start();
                      w2.port.onmessage = function (e2) {
                        if (e2.data && e2.data.type === 'connected') {
                          w2.port.postMessage({ cmd: 'port-count' });
                          return;
                        }
                        /* Usar 'echo' para pedir msgCount indiretamente */
                        if (e2.data && e2.data.type === 'port-count') {
                          /* Se msgCount > 0 dentro do worker, o pong foi processado */
                          var portCount = e2.data.count;
                          anomalies.push(
                            'D2: INFO — após silent drop, portCount no worker=' + portCount
                          );
                          w2.port.close();
                        }
                      };
                    } catch (e3) {
                      anomalies.push('D2: reconexão falhou: ' + String(e3));
                    }
                  }, 200);
                }
              };
            } catch (e) {
              anomalies.push('D2: ' + String(e));
            }
          }());

          /* D3: race síncrono postMessage→close() sem aguardar handshake
           * Abre conexão, imediatamente posta e fecha na mesma call stack.
           * Testa o caminho onde close() e postMessage disputam antes
           * do worker ter registrado a porta. */
          (function d3() {
            try {
              var w    = makeWorker('fuzz-D3-' + Date.now());
              var port = w.port;
              port.start();

              /* Sem aguardar 'connected' — fechar imediatamente após start() */
              var threw = false;
              try {
                port.postMessage({ cmd: 'ping' }); /* antes do close */
              } catch (e2) {
                threw = true;
              }
              port.close();
              try {
                port.postMessage({ cmd: 'ping2' }); /* depois do close */
              } catch (e3) {
                /* Esperado InvalidStateError */
              }

              anomalies.push(
                'D3: INFO — postMessage pré-close ' + (threw ? 'lançou' : 'silenciou') +
                ' | postMessage pós-close ' + (threw ? '' : 'ambos silenciaram')
              );
            } catch (e) {
              anomalies.push('D3: ' + String(e));
            }
          }());

          done('D');
        }());

        /* ── Variante E: worker self.close() com porta ativa ── */
        (function variantE() {
          try {
            var w    = makeWorker('fuzz-E');
            var port = w.port;
            port.start();

            var seq = [];
            port.onmessage = function (e) {
              seq.push(e.data && e.data.type);

              if (seq.length === 1 && e.data.type === 'connected') {
                /* Pedir ao worker para fechar a si mesmo */
                port.postMessage({ cmd: 'close-self' });

                /* Tentar postar mais mensagens após o worker ter feito self.close() */
                setTimeout(function () {
                  try {
                    port.postMessage({ cmd: 'ping' });
                  } catch (_) {
                    /* Pode lançar — porta detecta worker morto */
                  }
                }, 100);
              }
            };

            setTimeout(function () {
              if (seq.length === 0) {
                anomalies.push('E: nenhuma mensagem recebida antes de self.close()');
              }
              /* Não esperamos pong — o worker se fechou.
               * O importante é que o browser não crashou. */
              try { port.close(); } catch (_) {}
              done('E');
            }, 2500);
          } catch (e) {
            done('E', String(e));
          }
        }());

        /* ── Variante F: reconectar após self.close() ── */
        (function variantF() {
          try {
            /* Fase 1: conectar e pedir self.close() */
            var wName = 'fuzz-F-' + Date.now();
            var w1    = makeWorker(wName);
            w1.port.start();

            w1.port.onmessage = function (e) {
              if (e.data && e.data.type === 'connected') {
                w1.port.onmessage = null;
                w1.port.postMessage({ cmd: 'close-self' });

                /* Fase 2: aguardar um ciclo e reconectar com mesmo nome */
                setTimeout(function () {
                  try {
                    var w2   = makeWorker(wName);
                    var port2 = w2.port;
                    var gotConn = false;

                    port2.onmessage = function (e2) {
                      if (e2.data && e2.data.type === 'connected') {
                        gotConn = true;
                        /* Verificar que o worker recomeçou com port-count = 1 */
                        port2.postMessage({ cmd: 'port-count' });
                      } else if (e2.data && e2.data.type === 'port-count') {
                        var count = e2.data.count;
                        if (count !== 1) {
                          anomalies.push('F: port-count=' + count + ' após reconexão (esperado 1)');
                        }
                      }
                    };
                    port2.start();

                    setTimeout(function () {
                      if (!gotConn) {
                        anomalies.push('F: reconexão após self.close() não recebeu connected');
                      }
                      try { port2.close(); } catch (_) {}
                      try { w1.port.close(); } catch (_) {}
                      done('F');
                    }, 2000);
                  } catch (e3) {
                    done('F', 'reconexão: ' + String(e3));
                  }
                }, 300);
              }
            };

            /* Timeout global de variantF */
            setTimeout(function () {
              if (w1.port.onmessage !== null) {
                anomalies.push('F: fase 1 nunca recebeu connected');
                try { w1.port.close(); } catch (_) {}
                done('F');
              }
            }, 4000);

          } catch (e) {
            done('F', String(e));
          }
        }());

      });
    }
  };

}(window));
