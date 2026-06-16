'use strict';
/**
 * Teste 5 — Canvas 2D: ImageData boundary, OOB de pixels, createImageBitmap lifecycle
 *
 * O diagnóstico mostra:
 *   canvas: true  |  offscreen: false  |  ImageData: true
 *   ImageBitmap: true  |  createImageBitmap: true  |  webgl/webgl2: false
 *   Canvas OOB Baseline: nonZeroBytes=0  sample=00 00 00 00 00 00 00 00
 *
 * O baseline limpo é o comportamento esperado. Este teste procura desvios.
 *
 * Variantes:
 *   A — getImageData com origem negativa (clipping esperado, checar leak)
 *   B — putImageData com ImageData maior que o canvas (offset fora dos limites)
 *   C — createImageData(0, N) e (N, 0) — dimensão zero (deve lançar IndexSizeError)
 *   D — createImageBitmap lifecycle stress (criar + close em loop + GC pressure)
 *   E — drawImage de canvas para si mesmo (self-copy — comportamento indefinido)
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['5'] = {
    id      : 5,
    name    : 'Canvas 2D — ImageData boundary e createImageBitmap lifecycle',
    category: 'Canvas',
    timeout : 6000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        /* Helper: cria canvas pintado com cor sólida */
        function makeCanvas(w, h, color) {
          var c   = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          if (color) { ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); }
          return { canvas: c, ctx: ctx };
        }

        /* ── Variante A: getImageData com origem negativa ── */
        (function variantA() {
          try {
            var r   = makeCanvas(64, 64, '#ff0000');
            var ctx = r.ctx;

            /* Crop que começa antes do canto superior-esquerdo */
            var imgData;
            try {
              imgData = ctx.getImageData(-8, -8, 80, 80);
            } catch (e2) {
              /* IndexSizeError ou SecurityError — esperado */
              return;
            }

            /* Região antes do canvas (x<0 ou y<0) deve ser rgba(0,0,0,0) */
            /* Linha 0, colunas 0..7 correspondem a x=-8..-1 → devem ser 0 */
            var nonZero = 0;
            for (var col = 0; col < 8; col++) {
              var base = col * 4;
              for (var ch = 0; ch < 4; ch++) {
                if (imgData.data[base + ch] !== 0) nonZero++;
              }
            }
            if (nonZero > 0) {
              anomalies.push('A: ' + nonZero + ' bytes não-zero em região fora do canvas (linha 0, x=-8..-1)');
            }
          } catch (e) {
            anomalies.push('A: exceção: ' + String(e));
          }
        }());

        /* ── Variante B: putImageData com ImageData maior que o canvas ── */
        (function variantB() {
          try {
            var r   = makeCanvas(32, 32, null); // canvas transparente
            var ctx = r.ctx;

            /* ImageData 2× maior, totalmente opaca (R=255) */
            var large = ctx.createImageData(64, 64);
            for (var i = 0; i < large.data.length; i += 4) {
              large.data[i]     = 255; // R
              large.data[i + 3] = 255; // A
            }

            /* Colocar com offset negativo (-16,-16) — overlap [16..31]x[16..31] no canvas */
            ctx.putImageData(large, -16, -16);

            /* Verificar região que NÃO deve ter sido afetada: linha 0, cols 0..14 */
            var check = ctx.getImageData(0, 0, 32, 32);
            var bad   = 0;
            for (var row = 0; row < 15; row++) {
              for (var col = 0; col < 15; col++) {
                var idx = (row * 32 + col) * 4;
                /* r=255 aq indica que pixels além da overlap foram escritos */
                if (check.data[idx] === 255 && check.data[idx + 3] === 255) bad++;
              }
            }
            if (bad > 0) {
              anomalies.push('B: ' + bad + ' pixels vermelho em região não-overlap');
            }
          } catch (e) {
            anomalies.push('B: exceção: ' + String(e));
          }
        }());

        /* ── Variante C: createImageData com dimensão zero ── */
        (function variantC() {
          try {
            var r   = makeCanvas(16, 16, null);
            var ctx = r.ctx;
            var cases = [
              [0, 16], [16, 0], [0, 0],
              [-1, 16], [16, -1]
            ];
            cases.forEach(function (pair) {
              try {
                var id = ctx.createImageData(pair[0], pair[1]);
                /* Se não lançou, verificar se o objeto é seguro */
                if (id && id.data && id.data.length === 0 && (pair[0] === 0 || pair[1] === 0)) {
                  /* Aceitável — alguns motores permitem ImageData vazia */
                } else if (id && id.width === Math.abs(pair[0]) && id.height === Math.abs(pair[1])) {
                  /* OK — largura/altura absolutas */
                } else if (id) {
                  anomalies.push('C: createImageData(' + pair + ') => ' + id.width + 'x' + id.height);
                }
              } catch (e2) {
                /* IndexSizeError/RangeError esperado para 0 ou negativo */
                var name = e2.name || (e2.constructor && e2.constructor.name) || 'Error';
                if (name !== 'IndexSizeError' && name !== 'RangeError' && !(e2 instanceof DOMException)) {
                  anomalies.push('C: createImageData(' + pair + ') lançou ' + name + ': ' + e2.message);
                }
              }
            });
          } catch (e) {
            anomalies.push('C: setup: ' + String(e));
          }
        }());

        /* ── Variante D: createImageBitmap lifecycle stress ── */
        (function variantD() {
          if (typeof createImageBitmap !== 'function') return;
          var r   = makeCanvas(128, 128, '#00ff00');

          var promises = [];
          for (var i = 0; i < 30; i++) {
            (function (idx) {
              var opts = (idx % 4 === 0)
                ? { resizeWidth: 1, resizeHeight: 1 }         // downscale extremo
                : (idx % 4 === 1)
                  ? { resizeWidth: 256, resizeHeight: 256 }   // upscale
                  : (idx % 4 === 2)
                    ? { imageOrientation: 'flipY' }
                    : {};

              var p = createImageBitmap(r.canvas, 0, 0, 128, 128, opts)
                .then(function (bmp) {
                  /* Usar o bitmap imediatamente antes de fechar */
                  var tmp = makeCanvas(bmp.width, bmp.height, null);
                  tmp.ctx.drawImage(bmp, 0, 0);
                  bmp.close();
                  /* Tentar usar após close — deve ser silencioso ou lançar */
                  try {
                    tmp.ctx.drawImage(bmp, 0, 0);
                  } catch (_) {
                    /* Esperado: InvalidStateError */
                  }
                })
                .catch(function () { /* Opções inválidas — ignorar */ });
              promises.push(p);
            }(i));
          }

          /* Não aguardamos o resultado aqui — deixamos o GC trabalhar assincronamente */
          Promise.all(promises).catch(function () {});
        }());

        /* ── Variante E: drawImage de canvas para si mesmo (self-copy) ── */
        (function variantE() {
          try {
            var r   = makeCanvas(64, 64, '#0000ff');
            var ctx = r.ctx;
            /* self-copy — comportamento indefinido na spec, mas não deve crashar */
            ctx.drawImage(r.canvas, 0, 0);
            ctx.drawImage(r.canvas, 32, 32, 32, 32, 0, 0, 32, 32);

            /* Verificar que o canvas não ficou corrompido (não-preto) */
            var pixel = ctx.getImageData(16, 16, 1, 1);
            if (pixel.data[0] === 0 && pixel.data[1] === 0 && pixel.data[2] === 0 && pixel.data[3] === 255) {
              /* Canvas ficou completamente preto — suspeito (era azul) */
              anomalies.push('E: canvas ficou preto após self-copy (era azul)');
            }
          } catch (e) {
            anomalies.push('E: ' + String(e));
          }
        }());

        /* ── Resolver após dar tempo para Variante D (Promises async) ── */
        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-E sem anomalias' });
          }
        }, 1200);
      });
    }
  };

}(window));
