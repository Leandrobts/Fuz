'use strict';
/**
 * Teste 2 — WebCore: Range & Selection
 * * Foco: Sincronia entre objetos Range e a RenderTree/DOM viva.
 * * Variantes:
 * A - Boundary Deletion: Deletar o contêiner de um Range ativo e 
 * tentar forçar a leitura/extração via cloneContents.
 * B - Selection UAF: Mutar agressivamente innerHTML após adicionar 
 * um Range à seleção global, testando ponteiros órfãos.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['2'] = {
    id      : 2,
    name    : 'WebCore.Range — Boundary deletion and Selection sync',
    category: 'WebCore-RangeSelection',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var sandbox = document.createElement('div');
      sandbox.id = 'fuzzer-sandbox-2';
      document.body.appendChild(sandbox);

      /* ── Variante A: Boundary Deletion ────────────────────────────── */
      (function variantA() {
        try {
          var p1 = document.createElement('p');
          var p2 = document.createElement('p');
          var txt = document.createTextNode('TARGET');
          p1.appendChild(txt);
          sandbox.appendChild(p1);
          sandbox.appendChild(p2);

          var r = document.createRange();
          r.setStart(txt, 0);
          r.setEnd(sandbox, 2);

          /* Destrói o container diretamente envolvido no Range */
          sandbox.removeChild(p1);
          
          /* Força o WebKit a operar sobre os ponteiros possivelmente órfãos */
          var frag = r.cloneContents();
          
          /* Detectores de estado impossível */
          if (r.startContainer === null || r.endContainer === null) {
             anomalies.push('A: Container do Range retornou null (inesperado na spec)');
          } else if (typeof r.startContainer.nodeType !== 'number') {
             anomalies.push('A: Identidade do startContainer corrompida (type confusion)');
          }

          /* Tenta escrever num limite fantasma */
          r.insertNode(document.createElement('span'));
          
        } catch (e) {
          /* DOMException (ex: InvalidStateError) é o correto se a engine detectar.
           * Lançar TypeError ou ReferenceError puro indica vazamento na bind do JSC. */
          if (!(e instanceof DOMException)) {
            anomalies.push('A: Exceção anômala em Range: ' + e.name);
          }
        }
      }());

      /* ── Variante B: Selection Mutation ────────────────────────────── */
      (function variantB() {
        try {
          var sel = window.getSelection();
          sel.removeAllRanges();

          var host = document.createElement('div');
          host.innerHTML = '<b>Node A</b><i>Node B</i>';
          sandbox.appendChild(host);

          var r2 = document.createRange();
          r2.selectNodeContents(host);
          sel.addRange(r2);

          /* Nuking the DOM while selection holds the reference */
          host.innerHTML = '';
          
          /* Coleta de lixo forçada "pobre" criando objetos gigantes */
          var garbage = [];
          for (var i = 0; i < 1000; i++) garbage.push(new ArrayBuffer(1024 * 64));

          var rangeCount = sel.rangeCount;
          if (rangeCount > 0) {
            var phantomRange = sel.getRangeAt(0);
            if (!phantomRange.startContainer) {
               anomalies.push('B: Selection possui Range vazio/nulo');
            } else if (!phantomRange.startContainer.parentNode && phantomRange.startContainer.nodeType !== 11) {
               // NodeType 11 é DocumentFragment, se não for, e não tiver pai, é suspeito.
               // Pode ser comportamento esperado de nó desconectado, mas requer escrutínio.
            }
          }
        } catch (e) {
          if (!(e instanceof DOMException)) anomalies.push('B: ' + e.name);
        }
      }());

      /* Limpeza */
      document.body.removeChild(sandbox);

      if (anomalies.length > 0) return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      return { status: 'PASS', detail: 'Range/Selection limpo' };
    }
  };

          
