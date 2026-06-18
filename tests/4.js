

  /**
   * Teste 4 — WebCore: DOM Tree Manipulation (Circularity & Adoption)
   * * Foco: Burlar checagens de HierarchyRequestError e enganar o 
   * Garbage Collector durante cross-document adoption.
   */
  global.FuzzerTests['4'] = {
    id      : 4,
    name    : 'WebCore.DOMManipulation — Tree Circularity and Adoption',
    category: 'WebCore-DOMManipulation',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var sandbox = document.createElement('div');
      document.body.appendChild(sandbox);

      /* ── Variante A: Hierarchy Circularity Bypass ──────────────────── */
      (function variantA() {
        try {
          var nodeA = document.createElement('div');
          var nodeB = document.createElement('div');
          
          nodeA.appendChild(nodeB);
          
          /* Tentamos fazer B ser pai de A (Ciclo). O DOM DEVE lançar HierarchyRequestError */
          var bypassCount = 0;
          nodeB.addEventListener('DOMNodeInserted', function() {
            bypassCount++;
            if (bypassCount === 1) {
              try {
                nodeB.appendChild(nodeA);
              } catch(e) {
                if (e.name !== 'HierarchyRequestError') {
                  anomalies.push('A: Exceção inesperada na re-entrância: ' + e.name);
                }
              }
            }
          });

          /* Start the trigger */
          sandbox.appendChild(nodeA);

          /* Verificação estrita de ciclo impossível */
          if (nodeB.parentNode === nodeA && nodeA.parentNode === nodeB) {
            anomalies.push('A: BURLOU HIERARCHY — Ciclo infinito criado no DOM');
          }

        } catch (e) {
          /* É esperado o DOMException principal */
          if (e.name !== 'HierarchyRequestError') anomalies.push('A: ' + String(e));
        }
      }());

      /* ── Variante B: Cross-Document Adoption em transição de render ─ */
      (function variantB() {
        try {
          var iframe = document.createElement('iframe');
          sandbox.appendChild(iframe);
          var idoc = iframe.contentDocument;
          if (!idoc) return;

          /* Criamos um nó complexo (SVG) no iframe */
          var svg = idoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
          var anim = idoc.createElementNS('http://www.w3.org/2000/svg', 'animate');
          svg.appendChild(anim);
          idoc.body.appendChild(svg);

          /* Adotamos o nó principal */
          document.adoptNode(svg);
          
          /* Destruimos o iframe imediatamente enquanto o SVG tem sub-nós */
          sandbox.removeChild(iframe);

          /* Anexamos o nó adotado ao documento principal */
          sandbox.appendChild(svg);

          /* Checagem de integridade */
          if (anim.ownerDocument !== document) {
            anomalies.push('B: Sub-nó manteve ownerDocument antigo após adoptNode no pai');
          }

        } catch (e) {
          anomalies.push('B: ' + String(e));
        }
      }());

      document.body.removeChild(sandbox);

      if (anomalies.length > 0) return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      return { status: 'PASS', detail: 'Manipulação de árvore rejeitou ciclos e lidou com adoption' };
    }
  };

}(window));
