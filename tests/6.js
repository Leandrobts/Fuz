'use strict';
/**
 * Teste 6 — MessageChannel / BroadcastChannel: races de close/postMessage
 *
 * O diagnóstico confirma: messageChannel: true, broadcastChannel: true, sab: false.
 * Contexto relevante: investigação anterior de MessagePort UAF identificou que
 * dispatchMessages() no WebKit dessa versão não tem `Ref<MessagePort> protect(*this)`,
 * criando um gap de qualidade de código mesmo que não seja exploitável no modelo
 * single-threaded. Aqui testamos comportamento observável via JS.
 *
 * Variantes:
 *   A — port.close() chamado DENTRO do handler onmessage (re-entrância no dispatcher)
 *   B — postMessage() para porta já fechada (deve ser silencioso ou lançar DOMException)
 *   C — ArrayBuffer transfer via postMessage (verificar detach do buffer original)
 *   D — BroadcastChannel: close() durante onmessage, depois postar mais mensagens
 *   E — MessageChannel criado sem start() em nenhuma porta — mensagem deve ser enfileirada
 *   F — Cadeia de MessageChannels: A→B→C→D; fechar B no meio e verificar integridade
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['6'] = {
    id      : 6,
    name    : 'MessageChannel/BroadcastChannel — close durante dispatch, transfer, races',
    category: 'Messaging',
    timeout : 6000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var pending   = 6; // número de variantes assíncronas

        function done() {
          if (--pending <= 0) {
            if (anomalies.length > 0) {
              resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
            } else {
              resolve({ status: 'PASS', detail: 'A-F sem anomalias' });
            }
          }
        }

        /* ── Variante A: close() dentro do handler de onmessage ── */
        (function variantA() {
          try {
            var mc       = new MessageChannel();
            var received = 0;

            mc.port1.onmessage = function () {
              received++;
              /* Fechar DURANTE o dispatch */
              mc.port1.close();
              /* Postar de volta para port2 depois de fechar port1 */
              try {
                mc.port2.postMessage('after-port1-close');
              } catch (_) {}
            };

            mc.port2.onmessage = function (e) {
              /* 'after-port1-close' não deve chegar — port1 foi fechada */
              if (e.data === 'after-port1-close') {
                /* Dependendo da spec isso pode ou não chegar — registrar como info,
                 * mas verificar se causa comportamento inesperado posterior */
              }
              done();
            };

            mc.port1.start();
            mc.port2.start();
            mc.port2.postMessage('trigger');

            /* Timeout de segurança para variantA */
            setTimeout(function () {
              if (received === 0) {
                anomalies.push('A: onmessage nunca disparou');
              }
              done();
            }, 1500);
          } catch (e) {
            anomalies.push('A: ' + String(e));
            done(); done(); /* decrementa os 2 dones de A */
          }
        }());

        /* ── Variante B: postMessage para porta fechada ──
         *
         * CONFIRMADO: WebKit 605.1.15 faz silent drop em vez de InvalidStateError.
         *
         * B1 — comportamento base (mantido)
         * B2 — verificar se a mensagem "silenciada" chega em port2
         *       (se o motor entregou antes de detectar que port1 estava fechada)
         * B3 — race: fechar e postar na mesma microtask chain via Promise
         */
        (function variantB() {
          /* B1: base confirmado */
          (function b1() {
            try {
              var mc = new MessageChannel();
              mc.port1.start();
              mc.port2.start();
              mc.port1.close();

              var threw = false;
              try {
                mc.port1.postMessage('to-closed');
              } catch (e) {
                threw = true;
                var name = e.name || (e.constructor && e.constructor.name) || '';
                if (name !== 'InvalidStateError' && !(e instanceof DOMException)) {
                  anomalies.push('B1: exceção inesperada: ' + name + ' — ' + e.message);
                }
              }
              if (!threw) {
                anomalies.push('B1: silent drop confirmado — postMessage não lançou InvalidStateError');
              }
            } catch (e) {
              anomalies.push('B1: setup: ' + String(e));
            }
          }());

          /* B2: a mensagem silenciada chega em port2?
           * Se WebKit faz drop antes de enfileirar a mensagem: port2.onmessage não dispara.
           * Se faz drop depois de enfileirar: a mensagem pode chegar em port2
           * mesmo com port1 fechada — estado inconsistente. */
          (function b2() {
            var mc2 = new MessageChannel();
            mc2.port1.start();
            mc2.port2.start();

            var ghostArrived = false;
            mc2.port2.onmessage = function (e) {
              if (e.data === 'ghost') ghostArrived = true;
            };

            /* Fechar port1 e imediatamente postar */
            mc2.port1.close();
            try { mc2.port1.postMessage('ghost'); } catch (_) {}

            setTimeout(function () {
              if (ghostArrived) {
                anomalies.push(
                  'B2: mensagem "ghost" chegou em port2 após port1.close() + postMessage silencioso' +
                  ' — drop ocorreu APÓS enfileiramento'
                );
              }
              mc2.port2.close();
            }, 400);
          }());

          /* B3: race close/postMessage via microtask chain
           * Fechar em Promise.resolve().then() e postar logo depois —
           * o dispatch da mensagem e o close competem no microtask queue. */
          (function b3() {
            var mc3   = new MessageChannel();
            mc3.port1.start();
            mc3.port2.start();

            var raceArrived = false;
            mc3.port2.onmessage = function (e) {
              if (e.data === 'race') raceArrived = true;
            };

            Promise.resolve().then(function () {
              mc3.port1.close();
            });
            /* Postar no mesmo ciclo síncrono — antes do then rodar */
            try { mc3.port1.postMessage('race'); } catch (_) {}

            setTimeout(function () {
              if (raceArrived) {
                /* Mensagem postada ANTES do close chegou — comportamento correto */
                anomalies.push('B3: INFO — race ganho pela mensagem: "race" chegou antes do close()');
              } else {
                anomalies.push('B3: INFO — close() ganhou a race: "race" não chegou em port2');
              }
              mc3.port2.close();
            }, 400);
          }());

          done();
        }());

        /* ── Variante C: ArrayBuffer transfer — verificar detach ── */
        (function variantC() {
          try {
            var mc  = new MessageChannel();
            var BUF_SIZE = 512 * 1024; // 512KB
            var buf = new ArrayBuffer(BUF_SIZE);

            mc.port2.onmessage = function (e) {
              var received = e.data;
              if (!received || !(received instanceof ArrayBuffer)) {
                anomalies.push('C: dado recebido não é ArrayBuffer: ' + typeof received);
              } else if (received.byteLength !== BUF_SIZE) {
                anomalies.push('C: byteLength recebido=' + received.byteLength + ' esperado=' + BUF_SIZE);
              }
              done();
            };

            mc.port1.start();
            mc.port2.start();

            /* Transfer do buffer */
            mc.port1.postMessage(buf, [buf]);

            /* Após transfer, buf deve estar detached */
            if (buf.byteLength !== 0) {
              anomalies.push('C: buffer não detached após transfer (byteLength=' + buf.byteLength + ')');
            }

            /* Tentar acessar buffer detached deve lançar ou retornar 0 */
            try {
              var view = new Uint8Array(buf);
              /* Se chegou aqui, o buffer não foi realmente detachado — anomalia */
              anomalies.push('C: Uint8Array de buffer detached construída sem exceção, length=' + view.length);
            } catch (e2) {
              /* TypeError esperado — OK */
            }

            /* Timeout caso onmessage não dispare */
            setTimeout(function () {
              if (mc.port2.onmessage) {
                anomalies.push('C: onmessage nunca disparou');
                done();
              }
              mc.port1.close();
              mc.port2.close();
            }, 1500);

          } catch (e) {
            anomalies.push('C: ' + String(e));
            done();
          }
        }());

        /* ── Variante D: BroadcastChannel close() dentro do onmessage ── */
        (function variantD() {
          var CH_NAME = 'ps4fuzz-d-' + Date.now();
          try {
            var bc1      = new BroadcastChannel(CH_NAME);
            var bc2      = new BroadcastChannel(CH_NAME);
            var msgCount = 0;

            bc2.onmessage = function (e) {
              msgCount++;
              if (msgCount === 1) {
                /* Fecha durante o primeiro handler */
                bc2.close();
                /* Postar mais mensagens — bc2 não deve receber */
                bc1.postMessage('should-not-arrive');
                bc1.postMessage('should-not-arrive-2');
              } else {
                /* Se chegou mensagem após close, registrar */
                anomalies.push('D: BroadcastChannel recebeu mensagem após close() (msg ' + msgCount + ')');
              }
            };

            bc1.postMessage('trigger');

            setTimeout(function () {
              if (msgCount === 0) {
                anomalies.push('D: BroadcastChannel onmessage nunca disparou');
              }
              try { bc1.close(); } catch (_) {}
              try { bc2.close(); } catch (_) {}
              done();
            }, 1000);

          } catch (e) {
            anomalies.push('D: ' + String(e));
            done();
          }
        }());

        /* ── Variante E: MessageChannel sem start() — mensagem enfileirada ── */
        (function variantE() {
          try {
            var mc      = new MessageChannel();
            var gotMsg  = false;

            mc.port2.onmessage = function (e) {
              gotMsg = true;
              if (e.data !== 'queued') {
                anomalies.push('E: dado recebido incorreto: ' + JSON.stringify(e.data));
              }
            };

            /* port1 e port2 NÃO têm start() chamado ainda */
            mc.port1.postMessage('queued');

            /* Agora chamar start() — deve liberar a mensagem enfileirada */
            mc.port1.start();
            mc.port2.start();

            setTimeout(function () {
              if (!gotMsg) {
                anomalies.push('E: mensagem enfileirada não foi entregue após start()');
              }
              mc.port1.close();
              mc.port2.close();
              done();
            }, 800);

          } catch (e) {
            anomalies.push('E: ' + String(e));
            done();
          }
        }());

        /* ── Variante F: cadeia A→B→C; fechar B no meio ── */
        (function variantF() {
          try {
            var ab = new MessageChannel(); // porta A→B
            var bc = new MessageChannel(); // porta B→C
            var received = [];

            /* Nó A: envia para B */
            /* Nó B: repassa para C, depois fecha */
            ab.port2.onmessage = function (e) {
              bc.port1.postMessage({ relay: e.data });
              ab.port2.close(); // fecha B ao repassar
            };

            /* Nó C: coleta */
            bc.port2.onmessage = function (e) {
              received.push(e.data);
            };

            ab.port1.start(); ab.port2.start();
            bc.port1.start(); bc.port2.start();

            /* Enviar 3 mensagens — apenas a primeira deve percorrer A→B→C */
            ab.port1.postMessage('msg1');
            ab.port1.postMessage('msg2'); // B já fechado após msg1
            ab.port1.postMessage('msg3');

            setTimeout(function () {
              if (received.length === 0) {
                anomalies.push('F: nenhuma mensagem chegou ao nó C');
              } else if (received.length > 1) {
                /* msg2 e msg3 não deveriam chegar após close de B */
                anomalies.push('F: ' + received.length + ' mensagens chegaram ao nó C (esperado 1)');
              }
              try { ab.port1.close(); } catch (_) {}
              try { bc.port1.close(); bc.port2.close(); } catch (_) {}
              done();
            }, 1000);

          } catch (e) {
            anomalies.push('F: ' + String(e));
            done();
          }
        }());

      });
    }
  };

}(window));
