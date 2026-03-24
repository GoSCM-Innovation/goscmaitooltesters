    /* ═══════════════════════════════════════════════════════════════
       SUPPLY NETWORK VISUALIZER — per-product API fetch
       ═══════════════════════════════════════════════════════════════ */
    var vizNetwork = null;
    var vizNetworkFull = null;
    var vizCurrentPrd = '';
    var vizSuggestions = [];
    var VIZ_DATA = null;  // cached data for current product
    var VIZ_VISIBLE = { plant: true, location: true, customer: true };
    var VIZ_HIDDEN_LOC = new Set();
    var VIZ_HIDDEN_CUST = new Set();

    /* --- Confirm mapping: load products only -------------------------- */
    async function vizConfirmMapping() {
      if (typeof toggleMappingBody === 'function') toggleMappingBody('bodyVizMDT', 'arrVizMDT', false);
      var productEntity = document.getElementById('selVizProduct').value;
      if (!productEntity) {
        alert('Selecciona la entidad Product antes de confirmar.');
        return;
      }
      var btn = document.getElementById('btnVizConfirm');
      var progBar = document.getElementById('progBarViz');
      var progFill = document.getElementById('progFillViz');
      var progStatus = document.getElementById('progStatusViz');
      var progText = document.getElementById('progStatusTextViz');
      var logEl = document.getElementById('logViz');
      btn.disabled = true;
      logEl.innerHTML = '';
      progBar.classList.remove('hidden');
      progStatus.style.cssText = 'display:flex;font-size:12px;color:var(--text2);margin-top:4px;align-items:center;gap:8px;';
      function setVizStatus(msg, pct) { progText.textContent = msg; if (pct !== undefined) progFill.style.width = pct + '%'; }
      try {
        var baseOData = CFG.url + '/sap/opu/odata/IBP/' + CFG.service + '/';
        var paFilter = CFG.pa
          ? (CFG.pver
            ? "PlanningAreaID eq '" + CFG.pa + "' and VersionID eq '" + CFG.pver + "'"
            : "PlanningAreaID eq '" + CFG.pa + "'")
          : '';
        setVizStatus('Descargando catálogo de productos…', 5);
        log(logEl, 'info', '[GET] ' + baseOData + productEntity + (paFilter ? ' | $filter=' + paFilter : '') + ' | $select=PRDID,PRDDESCR,MATTYPEID');
        var prods = await fetchAllPages(baseOData + productEntity, logEl, paFilter, 'PRDID,PRDDESCR,MATTYPEID');
        vizSuggestions = prods
          .filter(function (r) { return r.PRDID; })
          .map(function (r) { return { prdid: str(r.PRDID), prddescr: str(r.PRDDESCR || '') }; })
          .sort(function (a, b) { return a.prdid.localeCompare(b.prdid); });
        log(logEl, 'ok', '✓ ' + vizSuggestions.length + ' productos cargados');
        setVizStatus('✓ ' + vizSuggestions.length + ' materiales listos — selecciona uno y haz click en "Cargar red logística"', 100);
        vizInitAutocomplete();
        document.getElementById('vizControlsBar').style.display = 'flex';
        document.getElementById('vizLegend').style.display = 'block';
        document.getElementById('vizEmpty').style.display = 'block';
        document.getElementById('vizCanvas').style.height = 'calc(100vh - 230px)';
      } catch (e) {
        setVizStatus('✕ Error: ' + e.message, 0);
        log(logEl, 'err', '✕ ' + e.message);
      }
      btn.disabled = false;
    }

    /* --- Autocomplete ------------------------------------------------ */
    function vizInitAutocomplete() {
      var inp = document.getElementById('vizPrdInput');
      var list = document.getElementById('vizPrdList');
      if (!inp || inp._vizInited) return;
      inp._vizInited = true;
      inp.addEventListener('input', function () {
        var q = inp.value.trim().toLowerCase();
        if (!q) { list.classList.remove('open'); return; }
        vizRenderSugList(vizSuggestions.filter(function (s) {
          return s.prdid.toLowerCase().includes(q) || s.prddescr.toLowerCase().includes(q);
        }).slice(0, 40));
      });
      document.addEventListener('click', function (e) {
        if (!inp.contains(e.target) && !list.contains(e.target)) list.classList.remove('open');
      });
    }

    function vizRenderSugList(hits) {
      var list = document.getElementById('vizPrdList');
      if (!hits.length) { list.classList.remove('open'); return; }
      list.innerHTML = hits.map(function (s) {
        return '<div class="ss-opt" data-prdid="' + escH(s.prdid) + '">' +
          '<strong>' + escH(s.prdid) + '</strong>' +
          (s.prddescr ? ' <span style="color:var(--text3)">' + escH(s.prddescr) + '</span>' : '') +
          '</div>';
      }).join('');
      list.querySelectorAll('.ss-opt').forEach(function (opt) {
        opt.addEventListener('click', function () {
          var prdid = opt.getAttribute('data-prdid');
          document.getElementById('vizPrdInput').value = prdid;
          list.classList.remove('open');
          vizCurrentPrd = prdid;
          VIZ_DATA = null;
          var btnLoad = document.getElementById('btnVizLoadNet');
          btnLoad.disabled = false;
          btnLoad.style.opacity = '1';
          document.getElementById('vizStatus').textContent = 'Material: ' + prdid + ' — haz click en "Cargar red logística"';
        });
      });
      list.classList.add('open');
    }

    /* --- Load network for selected product (filtered API fetch) ------- */
    async function vizLoadNetwork() {
      var prdid = vizCurrentPrd;
      if (!prdid) return;
      var cfg = {
        base: CFG.url + '/sap/opu/odata/IBP/' + CFG.service + '/',
        location: document.getElementById('selVizLocation').value,
        customer: document.getElementById('selVizCustomer').value,
        sourceProd: document.getElementById('selVizSourceProd').value,
        locMaster: document.getElementById('selVizLocMaster').value,
        custMaster: document.getElementById('selVizCustMaster').value
      };
      var logEl = document.getElementById('logNet');
      var statusBar = document.getElementById('vizLoadStatusBar');
      var statusText = document.getElementById('vizLoadStatusText');
      var btnLoad = document.getElementById('btnVizLoadNet');
      logEl.innerHTML = '';
      logEl.classList.add('hidden');
      document.getElementById('btnToggleNetLogs').textContent = 'Ver logs técnicos';
      // Resetear visibilidad, checkboxes y filtros al cargar nuevo producto
      VIZ_VISIBLE = { plant: true, location: true, customer: true };
      VIZ_HIDDEN_LOC = new Set();
      VIZ_HIDDEN_CUST = new Set();
      vizUpdateFilterBtn();
      ['Plant', 'Location', 'Customer'].forEach(function (t) {
        var el = document.getElementById('vizChk' + t);
        if (el) el.checked = true;
      });
      statusBar.style.display = 'flex';
      statusText.textContent = 'Procesando red de ' + prdid + '…';
      btnLoad.disabled = true;
      document.getElementById('vizDetail').style.display = 'none';
      document.getElementById('vizEmpty').style.display = 'none';
      document.getElementById('vizStatus').textContent = 'Procesando…';
      document.getElementById('btnVizFullscreen').style.display = 'none';
      document.getElementById('vizAnalysisBar').style.display = 'none';
      document.getElementById('vizAnalysisPanel').style.display = 'none';
      document.getElementById('btnVizAnalysis').textContent = 'Ver análisis ▼';

      var paBase = CFG.pa
        ? (CFG.pver
          ? "PlanningAreaID eq '" + CFG.pa + "' and VersionID eq '" + CFG.pver + "'"
          : "PlanningAreaID eq '" + CFG.pa + "'")
        : '';
      var prdFilter = paBase
        ? paBase + " and PRDID eq '" + prdid + "'"
        : "PRDID eq '" + prdid + "'";

      try {
        log(logEl, 'info', '▶ Cargando red para: ' + prdid);
        var locRows = [], custRows = [], plantRows = [], locMasters = [], custMasters = [];

        if (cfg.location) {
          log(logEl, 'info', '[GET] ' + cfg.base + cfg.location + ' | $filter=' + prdFilter + ' | $select=PRDID,LOCFR,LOCID,TLEADTIME');
          locRows = await fetchAllPages(cfg.base + cfg.location, logEl, prdFilter, 'PRDID,LOCFR,LOCID,TLEADTIME');
          log(logEl, 'ok', '✓ Location Source: ' + locRows.length + ' registros');
        }
        if (cfg.customer) {
          log(logEl, 'info', '[GET] ' + cfg.base + cfg.customer + ' | $filter=' + prdFilter + ' | $select=PRDID,LOCID,CUSTID,CLEADTIME');
          custRows = await fetchAllPages(cfg.base + cfg.customer, logEl, prdFilter, 'PRDID,LOCID,CUSTID,CLEADTIME');
          log(logEl, 'ok', '✓ Customer Source: ' + custRows.length + ' registros');
        }
        if (cfg.sourceProd) {
          log(logEl, 'info', '[GET] ' + cfg.base + cfg.sourceProd + ' | $filter=' + prdFilter + ' | $select=PRDID,LOCID,PLEADTIME');
          plantRows = await fetchAllPages(cfg.base + cfg.sourceProd, logEl, prdFilter, 'PRDID,LOCID,PLEADTIME');
          log(logEl, 'ok', '✓ Production Source Header: ' + plantRows.length + ' registros');
        }

        // Collect unique LOCIDs / CUSTIDs to fetch masters
        var locIds = {}, custIds = {};
        locRows.forEach(function (r) { if (r.LOCFR) locIds[r.LOCFR] = true; if (r.LOCID) locIds[r.LOCID] = true; });
        custRows.forEach(function (r) { if (r.LOCID) locIds[r.LOCID] = true; if (r.CUSTID) custIds[r.CUSTID] = true; });
        plantRows.forEach(function (r) { if (r.LOCID) locIds[r.LOCID] = true; });

        if (cfg.locMaster && Object.keys(locIds).length) {
          var ids = Object.keys(locIds);
          var locMFilter = ids.map(function (id) { return "LOCID eq '" + id + "'"; }).join(' or ');
          if (paBase) locMFilter = '(' + locMFilter + ') and ' + paBase;
          log(logEl, 'info', '[GET] ' + cfg.base + cfg.locMaster + ' | $filter=' + locMFilter + ' | $select=LOCID,LOCDESCR');
          locMasters = await fetchAllPages(cfg.base + cfg.locMaster, logEl, locMFilter, 'LOCID,LOCDESCR');
          log(logEl, 'ok', '✓ Location Master: ' + locMasters.length + ' registros');
        }
        if (cfg.custMaster && Object.keys(custIds).length) {
          var ids = Object.keys(custIds);
          var custMFilter = ids.map(function (id) { return "CUSTID eq '" + id + "'"; }).join(' or ');
          if (paBase) custMFilter = '(' + custMFilter + ') and ' + paBase;
          log(logEl, 'info', '[GET] ' + cfg.base + cfg.custMaster + ' | $filter=' + custMFilter + ' | $select=CUSTID,CUSTDESCR');
          custMasters = await fetchAllPages(cfg.base + cfg.custMaster, logEl, custMFilter, 'CUSTID,CUSTDESCR');
          log(logEl, 'ok', '✓ Customer Master: ' + custMasters.length + ' registros');
        }

        var prdInfo = vizSuggestions.find(function (s) { return s.prdid === prdid; }) || {};
        VIZ_DATA = {
          locRows: locRows, custRows: custRows, plantRows: plantRows,
          prdRows: [{ PRDID: prdid, PRDDESCR: prdInfo.prddescr || '' }],
          locMasters: locMasters, custMasters: custMasters
        };
        // Auto-threshold: si hay más de 20 clientes, ocultar el exceso automáticamente
        var VIZ_CUST_THRESHOLD = 20;
        var _allCustIds = {};
        VIZ_DATA.custRows.forEach(function (r) { if (r.CUSTID) _allCustIds[str(r.CUSTID)] = true; });
        var _allCustList = Object.keys(_allCustIds).sort();
        var _autoHidden = 0;
        if (_allCustList.length > VIZ_CUST_THRESHOLD) {
          _allCustList.slice(VIZ_CUST_THRESHOLD).forEach(function (id) { VIZ_HIDDEN_CUST.add(id); });
          _autoHidden = _allCustList.length - VIZ_CUST_THRESHOLD;
          vizUpdateFilterBtn();
        }

        var graph = vizBuildGraph(prdid, VIZ_DATA);
        vizRender(graph.nodes, graph.edges);
        var summary = graph.nodes.length + ' nodos · ' + graph.edges.length + ' conexiones';
        statusText.textContent = '✓ ' + summary;
        var statusMsg = summary;
        if (_autoHidden > 0) statusMsg += ' — ' + _autoHidden + ' clientes ocultos automáticamente. Usa ▼ Filtros para ajustar.';
        document.getElementById('vizStatus').textContent = statusMsg;
        document.getElementById('btnVizFullscreen').style.display = '';
        document.getElementById('btnVizFilter').style.display = '';
        document.getElementById('vizAnalysisBar').style.display = 'flex';
        log(logEl, 'ok', '✓ Diagrama: ' + summary);
      } catch (e) {
        statusText.textContent = '✕ Error: ' + e.message;
        document.getElementById('vizStatus').textContent = '✕ Error: ' + e.message;
        log(logEl, 'err', '✕ Error: ' + e.message);
      } finally {
        var b = document.getElementById('btnVizLoadNet');
        if (b) { b.disabled = false; b.style.opacity = '1'; }
      }
    }

    /* --- Build nodes + edges ----------------------------------------- */
    function vizBuildGraph(prdid, data) {
      var nodeMap = {}, edgesArr = [];

      var locMap = {}, custMap = {};
      data.locMasters.forEach(function (r) { locMap[str(r.LOCID)] = r; });
      data.custMasters.forEach(function (r) { custMap[str(r.CUSTID)] = r; });

      var prdInfo = data.prdRows[0] || {};
      var prdDescr = str(prdInfo.PRDDESCR || '');

      var COLORS = {
        product: { background: '#6C63FF', border: '#8B84FF', hover: { background: '#8B84FF' }, highlight: { background: '#8B84FF', border: '#fff' } },
        plant: { background: '#F59E0B', border: '#FBBF24', hover: { background: '#FBBF24' }, highlight: { background: '#FBBF24', border: '#fff' } },
        location: { background: '#0E8FAD', border: '#06B6D4', hover: { background: '#06B6D4' }, highlight: { background: '#06B6D4', border: '#fff' } },
        customer: { background: '#0B8A63', border: '#10B981', hover: { background: '#10B981' }, highlight: { background: '#10B981', border: '#fff' } }
      };

      function addNode(id, type, label, title) {
        if (nodeMap[id]) return;
        var shapes = { product: 'star', plant: 'box', location: 'ellipse', customer: 'box' };
        var hidden = type !== 'product' && VIZ_VISIBLE[type] === false;
        nodeMap[id] = {
          id: id, label: label, title: title,
          color: COLORS[type] || COLORS.location,
          shape: shapes[type] || 'ellipse',
          font: {
            color: '#ffffff', size: type === 'product' ? 13 : 11,
            bold: type === 'product', multi: false
          },
          size: type === 'product' ? 28 : type === 'plant' ? 18 : 14,
          hidden: hidden,
          _type: type, _title: title
        };
      }

      function addEdge(from, to, dashes, ltLabel, ltDetail) {
        var key = from + '||' + to;
        if (edgesArr.some(function (e) { return e.id === key; })) return;
        var edgeObj = {
          id: key, from: from, to: to,
          arrows: { to: { enabled: true, scaleFactor: 0.55 } },
          dashes: !!dashes,
          color: { color: 'rgba(148,163,184,0.45)', highlight: 'rgba(247,168,0,0.9)', hover: 'rgba(247,168,0,0.7)' },
          width: 1.5,
          title: ltDetail || (from + ' → ' + to),
          _detail: ltDetail || ''
        };
        edgesArr.push(edgeObj);
      }

      // Product node (focal point)
      addNode(prdid, 'product', prdid + (prdDescr ? '\n' + prdDescr : ''), 'Producto: ' + prdid + (prdDescr ? '\n' + prdDescr : ''));

      // Plants
      data.plantRows.forEach(function (r) {
        var locid = str(r.LOCID); if (!locid) return;
        var lm = locMap[locid] || {};
        var d = str(lm.LOCDESCR || lm.LOCNAME || '');
        var plt = str(r.PLEADTIME || '');
        addNode(locid, 'plant', locid + (d ? '\n' + d : ''), 'Planta: ' + locid + (d ? '\n' + d : ''));
        addEdge(prdid, locid, false, '', plt ? 'Lead time producción: ' + plt : '');
      });

      // Location edges (LOCFR → LOCID)
      data.locRows.forEach(function (r) {
        var from = str(r.LOCFR), to = str(r.LOCID);
        if (!from || !to) return;
        if (VIZ_HIDDEN_LOC.has(from) || VIZ_HIDDEN_LOC.has(to)) return;
        var lf = locMap[from] || {}, lt = locMap[to] || {};
        var df = str(lf.LOCDESCR || lf.LOCNAME || '');
        var dt = str(lt.LOCDESCR || lt.LOCNAME || '');
        var tlt = str(r.TLEADTIME || '');
        addNode(from, 'location', from + (df ? '\n' + df : ''), 'Ubicación: ' + from + (df ? '\n' + df : ''));
        addNode(to, 'location', to + (dt ? '\n' + dt : ''), 'Ubicación: ' + to + (dt ? '\n' + dt : ''));
        addEdge(from, to, false, '', tlt ? 'Lead time transporte: ' + tlt : '');
      });

      // Customer edges (LOCID → CUSTID)
      data.custRows.forEach(function (r) {
        var locid = str(r.LOCID), custid = str(r.CUSTID);
        if (!locid || !custid) return;
        if (VIZ_HIDDEN_CUST.has(custid)) return;
        if (VIZ_HIDDEN_LOC.has(locid)) return;
        var lm = locMap[locid] || {};
        var cm = custMap[custid] || {};
        var dl = str(lm.LOCDESCR || lm.LOCNAME || '');
        var dc = str(cm.CUSTDESCR || '');
        var clt = str(r.CLEADTIME || '');
        addNode(locid, 'location', locid + (dl ? '\n' + dl : ''), 'Ubicación: ' + locid + (dl ? '\n' + dl : ''));
        addNode(custid, 'customer', custid + (dc ? '\n' + dc : ''), 'Cliente: ' + custid + (dc ? '\n' + dc : ''));
        addEdge(locid, custid, true, '', clt ? 'Lead time cliente: ' + clt : '');
      });

      return { nodes: Object.values(nodeMap), edges: edgesArr };
    }

    /* --- Manual column-based positioning ----------------------------- */
    function vizAssignPositions(nodes) {
      var COL_W = 260;  // horizontal gap between columns
      var ROW_H = 80;   // vertical gap between nodes in same column
      var MAX_ROWS = 8;    // max nodes per location column before adding a new column

      // Group by type
      var byType = { product: [], plant: [], location: [], customer: [] };
      nodes.forEach(function (n) {
        var t = n._type || 'location';
        if (byType[t]) byType[t].push(n); else byType.location.push(n);
      });

      // Number of location columns needed
      var numLocCols = Math.max(1, Math.ceil(byType.location.length / MAX_ROWS));

      // Column x anchors
      var xPrd = 0;
      var xPlt = COL_W;
      var xLoc0 = COL_W * 2;                       // first location column
      var xCust = COL_W * (2 + numLocCols);         // customer column

      // Helper: assign x/y to a list using N sub-columns
      function place(list, startX, numCols) {
        if (!list.length) return;
        var perCol = Math.ceil(list.length / numCols);
        list.forEach(function (n, i) {
          var col = Math.floor(i / perCol);
          var row = i % perCol;
          var colSize = Math.min(perCol, list.length - col * perCol);
          n.x = startX + col * COL_W;
          n.y = (row - (colSize - 1) / 2) * ROW_H;
        });
      }

      place(byType.product, xPrd, 1);
      place(byType.plant, xPlt, 1);
      place(byType.location, xLoc0, numLocCols);
      place(byType.customer, xCust, 1);

      return nodes;
    }

    /* --- Render vis.js ----------------------------------------------- */
    function vizMakeNetwork(container, nodes, edges) {
      vizAssignPositions(nodes);
      var net = new vis.Network(container,
        { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) },
        {
          physics: { enabled: false },
          interaction: { hover: true, tooltipDelay: 150, zoomView: true, dragView: true },
          nodes: { borderWidth: 1.5, borderWidthSelected: 3 },
          edges: {
            smooth: { type: 'curvedCW', roundness: 0.15 },
            arrows: { to: { enabled: true, scaleFactor: 0.55 } }
          }
        });
      net.once('afterDrawing', function () {
        net.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
      });
      return net;
    }

    function vizRender(nodes, edges) {
      var container = document.getElementById('vizCanvas');
      if (vizNetwork) { vizNetwork.destroy(); vizNetwork = null; }
      document.getElementById('vizEmpty').style.display = 'none';

      vizNetwork = vizMakeNetwork(container, nodes, edges);

      vizNetwork.on('click', function (params) {
        var detail = document.getElementById('vizDetail');
        if (params.nodes.length > 0) {
          var nid = params.nodes[0];
          var node = nodes.find(function (n) { return n.id === nid; });
          if (node) {
            var typeLabels = { product: 'Producto', plant: 'Planta', location: 'Ubicación', customer: 'Cliente' };
            var badgeMap = { product: 'badge-psh', plant: 'badge-main', location: 'badge-comp', customer: 'badge-leaf' };
            document.getElementById('vizDetailContent').innerHTML =
              '<span class="badge ' + (badgeMap[node._type] || 'badge-comp') + '">' +
              (typeLabels[node._type] || node._type) + '</span>' +
              ' <strong style="font-family:var(--mono);font-size:12px">' + escH(nid) + '</strong>' +
              (node._title && node._title !== nid ? ' <span style="color:var(--text2)">' + escH(node._title) + '</span>' : '');
            detail.style.cssText = 'display:flex;padding:10px 24px;background:var(--bg2);border-top:1px solid var(--border);font-size:12px;align-items:center;gap:10px;';
          }
        }
      });
    }

    function vizRerender() {
      if (vizCurrentPrd && VIZ_DATA) {
        var graph = vizBuildGraph(vizCurrentPrd, VIZ_DATA);
        vizRender(graph.nodes, graph.edges);
      }
    }

    function vizFitGraph() {
      if (vizNetwork) vizNetwork.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    }

    function vizCompact() {
      // Re-renderiza desde cero con posicionamiento manual LR
      var net = vizNetworkFull;
      if (net && vizCurrentPrd && VIZ_DATA) {
        var graph = vizBuildGraph(vizCurrentPrd, VIZ_DATA);
        net.destroy();
        vizNetworkFull = vizMakeNetwork(document.getElementById('vizCanvasFull'), graph.nodes, graph.edges);
      } else {
        vizRerender();
      }
    }

    /* --- Glob-aware text match (supports * as wildcard) -------------- */
    function vizGlobMatch(text, pattern) {
      if (!pattern) return true;
      var t = (text || '').toLowerCase();
      var p = (pattern || '').toLowerCase().trim();
      if (!p) return true;
      if (p.indexOf('*') < 0) return t.includes(p);
      var reStr = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      try { return new RegExp('^' + reStr + '$').test(t); } catch (e) { return t.includes(p.replace(/\*/g, '')); }
    }

    /* --- Filter modal ------------------------------------------------ */
    function vizOpenFilter() {
      if (!VIZ_DATA) return;
      var dlg = document.getElementById('vizFilterDlg');

      var locMap = {};
      VIZ_DATA.locMasters.forEach(function (r) { locMap[str(r.LOCID)] = str(r.LOCDESCR || ''); });
      var locIds = {};
      VIZ_DATA.locRows.forEach(function (r) {
        if (r.LOCFR) locIds[str(r.LOCFR)] = true;
        if (r.LOCID) locIds[str(r.LOCID)] = true;
      });
      VIZ_DATA.custRows.forEach(function (r) { if (r.LOCID) locIds[str(r.LOCID)] = true; });
      var locList = Object.keys(locIds).sort().map(function (id) {
        return { id: id, descr: locMap[id] || '' };
      });

      var custMap = {};
      VIZ_DATA.custMasters.forEach(function (r) { custMap[str(r.CUSTID)] = str(r.CUSTDESCR || ''); });
      var custIds = {};
      VIZ_DATA.custRows.forEach(function (r) { if (r.CUSTID) custIds[str(r.CUSTID)] = true; });
      var custList = Object.keys(custIds).sort().map(function (id) {
        return { id: id, descr: custMap[id] || '' };
      });

      dlg._locAll = locList;
      dlg._custAll = custList;
      document.getElementById('vizFltLocSearch').value = '';
      document.getElementById('vizFltCustSearch').value = '';
      vizRenderFilterList('loc', locList);
      vizRenderFilterList('cust', custList);
      dlg.showModal();
    }

    function vizRenderFilterList(type, items) {
      var pfx = type === 'loc' ? 'Loc' : 'Cust';
      var listEl = document.getElementById('vizFlt' + pfx + 'List');
      var countEl = document.getElementById('vizFlt' + pfx + 'Count');
      var hiddenSet = type === 'loc' ? VIZ_HIDDEN_LOC : VIZ_HIDDEN_CUST;
      var q = (document.getElementById('vizFlt' + pfx + 'Search').value || '').trim();
      var filtered = q ? items.filter(function (i) {
        return vizGlobMatch(i.id, q) || vizGlobMatch(i.descr, q);
      }) : items;
      var visCount = filtered.filter(function (i) { return !hiddenSet.has(i.id); }).length;
      countEl.textContent = '(' + visCount + ' de ' + filtered.length + ')';
      listEl.innerHTML = filtered.map(function (item) {
        var chk = hiddenSet.has(item.id) ? '' : 'checked';
        return '<label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer;font-size:12px;hover:background:var(--bg2);">' +
          '<input type="checkbox" data-id="' + escH(item.id) + '" data-type="' + type + '" ' + chk + ' onchange="vizFilterItemChange(this)" style="flex-shrink:0;">' +
          '<span style="font-family:var(--mono);color:var(--text);flex-shrink:0;">' + escH(item.id) + '</span>' +
          (item.descr ? '<span style="color:var(--text3);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escH(item.descr) + '</span>' : '') +
          '</label>';
      }).join('');
      vizUpdateSelectAll(type, filtered);
    }

    function vizFilterItemChange(chk) {
      var type = chk.getAttribute('data-type');
      var id = chk.getAttribute('data-id');
      var hiddenSet = type === 'loc' ? VIZ_HIDDEN_LOC : VIZ_HIDDEN_CUST;
      if (chk.checked) hiddenSet.delete(id); else hiddenSet.add(id);
      var dlg = document.getElementById('vizFilterDlg');
      var items = type === 'loc' ? dlg._locAll : dlg._custAll;
      var pfx = type === 'loc' ? 'Loc' : 'Cust';
      var q = (document.getElementById('vizFlt' + pfx + 'Search').value || '').trim();
      var filtered = q ? items.filter(function (i) { return vizGlobMatch(i.id, q) || vizGlobMatch(i.descr, q); }) : items;
      var countEl = document.getElementById('vizFlt' + pfx + 'Count');
      var visCount = filtered.filter(function (i) { return !hiddenSet.has(i.id); }).length;
      countEl.textContent = '(' + visCount + ' de ' + filtered.length + ')';
      vizUpdateSelectAll(type, filtered);
    }

    function vizUpdateSelectAll(type, items) {
      var pfx = type === 'loc' ? 'Loc' : 'Cust';
      var allChk = document.getElementById('vizFlt' + pfx + 'All');
      var hiddenSet = type === 'loc' ? VIZ_HIDDEN_LOC : VIZ_HIDDEN_CUST;
      var visCount = items.filter(function (i) { return !hiddenSet.has(i.id); }).length;
      allChk.checked = visCount === items.length;
      allChk.indeterminate = visCount > 0 && visCount < items.length;
    }

    function vizFilterSearch(type) {
      var dlg = document.getElementById('vizFilterDlg');
      var items = type === 'loc' ? (dlg._locAll || []) : (dlg._custAll || []);
      if (!items.length) return;
      vizRenderFilterList(type, items);
    }

    function vizFilterSelectAll(type, checked) {
      var dlg = document.getElementById('vizFilterDlg');
      var items = type === 'loc' ? dlg._locAll : dlg._custAll;
      var hiddenSet = type === 'loc' ? VIZ_HIDDEN_LOC : VIZ_HIDDEN_CUST;
      var pfx = type === 'loc' ? 'Loc' : 'Cust';
      var q = (document.getElementById('vizFlt' + pfx + 'Search').value || '').trim();
      var filtered = q ? items.filter(function (i) { return vizGlobMatch(i.id, q) || vizGlobMatch(i.descr, q); }) : items;
      filtered.forEach(function (item) {
        if (checked) hiddenSet.delete(item.id); else hiddenSet.add(item.id);
      });
      vizRenderFilterList(type, items);
    }

    function vizApplyFilter() {
      document.getElementById('vizFilterDlg').close();
      vizUpdateFilterBtn();
      vizRerender();
    }

    function vizClearFilter() {
      VIZ_HIDDEN_LOC = new Set();
      VIZ_HIDDEN_CUST = new Set();
      document.getElementById('vizFilterDlg').close();
      vizUpdateFilterBtn();
      vizRerender();
    }

    function vizUpdateFilterBtn() {
      var btn = document.getElementById('btnVizFilter');
      if (!btn) return;
      var total = VIZ_HIDDEN_LOC.size + VIZ_HIDDEN_CUST.size;
      if (total > 0) {
        btn.textContent = '▼ Filtros (' + total + ')';
        btn.style.cssText = 'background:#F59E0B;color:#000;border-color:#F59E0B;';
      } else {
        btn.textContent = '▼ Filtros';
        btn.style.cssText = '';
      }
    }

    /* --- Analysis panel ─────────────────────────────────────────── */
    function vizBuildGraphFromData(prdid, data) {
      var locEdges = {}, custEdges = {}, plantSet = {}, plants = [];
      var locLeadTimes = {}, custLeadTimes = {}, plantLeadTimes = {};
      (data.plantRows || []).forEach(function (r) {
        var l = str(r.LOCID); if (!l || plantSet[l]) return;
        plantSet[l] = true; plants.push(l);
        plantLeadTimes[l] = str(r.PLEADTIME || '');
      });
      (data.locRows || []).forEach(function (r) {
        var fr = str(r.LOCFR), to = str(r.LOCID); if (!fr || !to) return;
        if (!locEdges[fr]) locEdges[fr] = [];
        if (locEdges[fr].indexOf(to) < 0) locEdges[fr].push(to);
        locLeadTimes[fr + '||' + to] = str(r.TLEADTIME || '');
      });
      (data.custRows || []).forEach(function (r) {
        var fr = str(r.LOCID), to = str(r.CUSTID); if (!fr || !to) return;
        if (!custEdges[fr]) custEdges[fr] = [];
        if (custEdges[fr].indexOf(to) < 0) custEdges[fr].push(to);
        custLeadTimes[fr + '||' + to] = str(r.CLEADTIME || '');
      });
      var allLocs = {}, allCusts = {};
      Object.keys(locEdges).forEach(function (fr) {
        allLocs[fr] = true;
        locEdges[fr].forEach(function (to) { allLocs[to] = true; });
      });
      Object.keys(custEdges).forEach(function (fr) {
        allLocs[fr] = true;
        custEdges[fr].forEach(function (c) { allCusts[c] = true; });
      });
      return {
        prdid: prdid, plants: plants, plantSet: plantSet,
        locEdges: locEdges, custEdges: custEdges,
        locLeadTimes: locLeadTimes, custLeadTimes: custLeadTimes, plantLeadTimes: plantLeadTimes,
        allLocations: Object.keys(allLocs), allCustomers: Object.keys(allCusts)
      };
    }

    function vizToggleAnalysis() {
      var panel = document.getElementById('vizAnalysisPanel');
      var btn = document.getElementById('btnVizAnalysis');
      if (panel.style.display === 'none') {
        vizRunAnalysis();
        panel.style.display = 'block';
        btn.textContent = 'Ocultar análisis ▲';
      } else {
        panel.style.display = 'none';
        btn.textContent = 'Ver análisis ▼';
      }
    }

    function vizSwitchAnalysisTab(tab) {
      var tabs = ['calidad', 'hallazgos', 'metricas', 'resiliencia', 'health'];
      tabs.forEach(function (t) {
        var content = document.getElementById('vizTab' + t.charAt(0).toUpperCase() + t.slice(1));
        if (content) content.style.display = t === tab ? 'block' : 'none';
        var btn = document.getElementById('vizAtab-' + t);
        if (btn) {
          btn.style.color = t === tab ? 'var(--text)' : 'var(--text2)';
          btn.style.borderBottom = t === tab ? '2px solid #6C63FF' : '2px solid transparent';
          btn.style.fontWeight = t === tab ? '600' : '400';
        }
      });
    }

    function vizRunAnalysis() {
      if (!VIZ_DATA || !vizCurrentPrd) return;
      var locDescr = {}, custDescr = {};
      (VIZ_DATA.locMasters || []).forEach(function (r) { locDescr[str(r.LOCID)] = str(r.LOCDESCR || ''); });
      (VIZ_DATA.custMasters || []).forEach(function (r) { custDescr[str(r.CUSTID)] = str(r.CUSTDESCR || ''); });
      var prdInfo = vizSuggestions.find(function (s) { return s.prdid === vizCurrentPrd; }) || {};
      function ld(id) { return locDescr[id] || ''; }
      function cd(id) { return custDescr[id] || ''; }

      var prdid = vizCurrentPrd;
      var graph = vizBuildGraphFromData(prdid, VIZ_DATA);
      var paths = snFindAllPaths(graph);
      var sets = snComputeNetworkSets(graph);
      var ghosts = snFindGhostNodes(graph, sets);
      var deadEnds = snFindDeadEnds(graph);
      var isolatedPlants = snFindIsolatedPlants(graph, sets);
      var cycles = snFindCycles(graph);
      var ltIssues = snFindMissingLeadTimes(graph);
      var cats = snEvaluateCategories(graph, paths);
      var metrics = snComputeMetrics(prdid, graph, paths, ghosts, deadEnds);
      var resData = snAnalyzeResilience(prdid, graph, paths);
      var health = snComputeHealthScore(metrics, paths, ghosts, deadEnds);
      var catName = snCategoryLabel(cats);
      var catDesc = snCategoryDesc(cats, graph, paths, ghosts, deadEnds);

      function thStyle() { return 'padding:6px 10px;text-align:left;color:var(--text3);font-size:11px;font-weight:600;border-bottom:1px solid var(--border);background:var(--bg);'; }
      function tdStyle() { return 'padding:6px 10px;border-bottom:1px solid var(--border);'; }
      function pill(label, col) {
        return '<span style="background:' + col + '22;color:' + col + ';border:1px solid ' + col + '44;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;">' + escH(label) + '</span>';
      }

      /* ── Tab 1: Calidad ── */
      var h1 = '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>' +
        '<th style="' + thStyle() + '">Planta</th>' +
        '<th style="' + thStyle() + '">Descripción</th>' +
        '<th style="' + thStyle() + '">Estado</th>' +
        '<th style="' + thStyle() + '">Categoría</th>' +
        '</tr></thead><tbody>';
      if (!graph.plants.length) {
        h1 += '<tr><td colspan="4" style="padding:14px;color:var(--text3);text-align:center;">Sin planta de producción configurada</td></tr>';
      } else {
        graph.plants.forEach(function (plant) {
          var pp = paths.filter(function (p) { return p.plant === plant; });
          var pSt = pp.length > 0 ? 'Complete' : (graph.locEdges[plant] || graph.custEdges[plant]) ? 'Partial' : 'No Distribution';
          var col = pSt === 'Complete' ? '#10B981' : pSt === 'Partial' ? '#F59E0B' : '#EF4444';
          h1 += '<tr>' +
            '<td style="' + tdStyle() + 'font-family:var(--mono);">' + escH(plant) + '</td>' +
            '<td style="' + tdStyle() + 'color:var(--text2);">' + escH(ld(plant)) + '</td>' +
            '<td style="' + tdStyle() + '">' + pill(pSt, col) + '</td>' +
            '<td style="' + tdStyle() + 'color:var(--text2);font-size:11px;">' + escH(catName) + '</td>' +
            '</tr>';
        });
      }
      h1 += '</tbody></table>';
      if (catDesc) h1 += '<div style="font-size:11px;color:var(--text2);padding:8px 10px;border-top:1px solid var(--border);">' + escH(catDesc) + '</div>';
      document.getElementById('vizTabCalidad').innerHTML = h1;

      /* ── Tab 2: Hallazgos ── */
      var findings = [];
      cats.forEach(function (cat) {
        if (cat === 7) return;
        findings.push({ type: snFindingType(cat), sev: snFindingSeverity(cat), desc: snFindingDesc(cat), node: '' });
      });
      ghosts.forEach(function (loc) {
        findings.push({ type: 'Ghost Node', sev: 'High', desc: 'Recibe desde planta, tiene salidas, pero ninguna llega a un cliente', node: loc + (ld(loc) ? ' — ' + ld(loc) : '') });
      });
      deadEnds.forEach(function (loc) {
        findings.push({ type: 'Dead-End', sev: 'High', desc: 'Recibe producto pero no tiene ninguna salida registrada', node: loc + (ld(loc) ? ' — ' + ld(loc) : '') });
      });
      isolatedPlants.forEach(function (plant) {
        findings.push({ type: 'Planta aislada', sev: 'High', desc: 'Planta sin ruta válida hasta ningún cliente', node: plant + (ld(plant) ? ' — ' + ld(plant) : '') });
      });
      cycles.forEach(function (cycle) {
        findings.push({ type: 'Ciclo en red', sev: 'Critical', desc: 'Dependencia circular detectada: ' + cycle, node: '' });
      });
      if (graph.plants.length > 0 && graph.allCustomers.length === 0) {
        findings.push({ type: 'Sin clientes', sev: 'High', desc: 'El producto tiene producción configurada pero ningún cliente en la red', node: '' });
      }
      ltIssues.forEach(function (lt) {
        if (lt.type === 'loc')
          findings.push({ type: 'Lead Time faltante', sev: 'Medium', desc: 'TLEADTIME no definido', node: lt.from + ' → ' + lt.to });
        else if (lt.type === 'cust')
          findings.push({ type: 'Lead Time faltante', sev: 'Medium', desc: 'CLEADTIME no definido', node: lt.from + ' → ' + lt.to });
        else if (lt.type === 'plant')
          findings.push({ type: 'Lead Time faltante', sev: 'Medium', desc: 'PLEADTIME no definido en planta', node: lt.loc + (ld(lt.loc) ? ' — ' + ld(lt.loc) : '') });
      });
      var h2 = '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>' +
        '<th style="' + thStyle() + '">Tipo</th>' +
        '<th style="' + thStyle() + '">Severidad</th>' +
        '<th style="' + thStyle() + '">Descripción</th>' +
        '<th style="' + thStyle() + '">Nodo</th>' +
        '</tr></thead><tbody>';
      if (!findings.length) {
        h2 += '<tr><td colspan="4" style="padding:14px;color:#10B981;text-align:center;">✓ Sin hallazgos — red correctamente configurada</td></tr>';
      } else {
        findings.forEach(function (f) {
          var col = f.sev === 'Critical' ? '#EF4444' : f.sev === 'High' ? '#F59E0B' : '#94a3b8';
          h2 += '<tr>' +
            '<td style="' + tdStyle() + 'color:var(--text);font-size:11px;">' + escH(f.type) + '</td>' +
            '<td style="' + tdStyle() + '">' + pill(f.sev, col) + '</td>' +
            '<td style="' + tdStyle() + 'color:var(--text2);font-size:11px;">' + escH(f.desc) + '</td>' +
            '<td style="' + tdStyle() + 'font-family:var(--mono);font-size:11px;">' + escH(f.node || '') + '</td>' +
            '</tr>';
        });
      }
      h2 += '</tbody></table>';
      document.getElementById('vizTabHallazgos').innerHTML = h2;

      /* ── Tab 3: Métricas ── */
      var stCol = metrics.networkStatus === 'Complete' ? '#10B981' : metrics.networkStatus === 'Incomplete' ? '#F59E0B' : '#EF4444';
      function metCard(label, value, col) {
        return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 16px;min-width:90px;text-align:center;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px;">' + escH(label) + '</div>' +
          '<div style="font-size:22px;font-weight:700;color:' + (col || 'var(--text)') + ';">' + escH(String(value)) + '</div>' +
          '</div>';
      }
      var h3 = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;">' +
        metCard('Estado', metrics.networkStatus, stCol) +
        metCard('Plantas', metrics.plants) +
        metCard('Centros dist.', metrics.dcs) +
        metCard('Clientes', metrics.customers) +
        metCard('Rutas', metrics.paths) +
        metCard('Ruta más larga', metrics.longestPath) +
        metCard('Ghost nodes', metrics.ghosts, metrics.ghosts > 0 ? '#F59E0B' : '#10B981') +
        metCard('Dead-ends', metrics.deadEnds, metrics.deadEnds > 0 ? '#F59E0B' : '#10B981') +
        metCard('Nodos críticos', metrics.criticalNodes, metrics.criticalNodes > 0 ? '#EF4444' : '#10B981') +
        '</div>';
      document.getElementById('vizTabMetricas').innerHTML = h3;

      /* ── Tab 4: Resiliencia ── */
      var h4 = '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>' +
        '<th style="' + thStyle() + '">Cliente</th>' +
        '<th style="' + thStyle() + '">Descripción</th>' +
        '<th style="' + thStyle() + '">Rutas</th>' +
        '<th style="' + thStyle() + '">Categoría</th>' +
        '<th style="' + thStyle() + '">Nodos críticos</th>' +
        '</tr></thead><tbody>';
      if (!resData.length) {
        h4 += '<tr><td colspan="5" style="padding:14px;color:var(--text3);text-align:center;">Sin rutas completas — no hay datos de resiliencia</td></tr>';
      } else {
        resData.forEach(function (r) {
          var col = r.category === 'Resilient' ? '#10B981' : r.category === 'Single Path' ? '#EF4444' : '#F59E0B';
          h4 += '<tr>' +
            '<td style="' + tdStyle() + 'font-family:var(--mono);">' + escH(r.custid) + '</td>' +
            '<td style="' + tdStyle() + 'color:var(--text2);">' + escH(cd(r.custid)) + '</td>' +
            '<td style="' + tdStyle() + 'text-align:center;">' + r.pathCount + '</td>' +
            '<td style="' + tdStyle() + '">' + pill(r.category, col) + '</td>' +
            '<td style="' + tdStyle() + 'font-family:var(--mono);font-size:11px;color:var(--text2);">' + escH(r.criticalNodes.join(', ')) + '</td>' +
            '</tr>';
        });
      }
      h4 += '</tbody></table>';
      document.getElementById('vizTabResiliencia').innerHTML = h4;

      /* ── Tab 5: Health Score ── */
      var hCol = health.score >= 80 ? '#10B981' : health.score >= 60 ? '#6C63FF' : health.score >= 40 ? '#F59E0B' : '#EF4444';
      var h5 = '<div style="display:flex;align-items:center;gap:32px;padding:16px 0;">' +
        '<div style="text-align:center;flex-shrink:0;">' +
        '<div style="font-size:56px;font-weight:800;color:' + hCol + ';line-height:1;">' + health.score + '</div>' +
        '<div style="font-size:11px;color:var(--text3);margin-top:4px;">/ 100</div>' +
        '</div>' +
        '<div>' +
        '<div style="font-size:15px;font-weight:700;color:' + hCol + ';margin-bottom:8px;">' + escH(health.category) + '</div>' +
        '<div style="font-size:12px;color:var(--text2);line-height:1.6;">' + (health.comments ? escH(health.comments) : '<span style="color:#10B981;">Sin observaciones</span>') + '</div>' +
        '</div></div>';
      document.getElementById('vizTabHealth').innerHTML = h5;

      vizSwitchAnalysisTab('calidad');
    }

    function vizExportPNG() {
      if (!vizNetwork) return;
      var canvas = document.querySelector('#vizCanvas canvas');
      if (!canvas) return;
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'SupplyNetwork_' + (vizCurrentPrd || 'graph') + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    /* --- Fullscreen dialog ------------------------------------------- */
    function vizOpenFullscreen() {
      if (!vizCurrentPrd || !VIZ_DATA) return;
      var dlg = document.getElementById('vizFullscreenDlg');
      document.getElementById('vizFullTitle').textContent = vizCurrentPrd;
      if (vizNetworkFull) { vizNetworkFull.destroy(); vizNetworkFull = null; }
      dlg.showModal();
      ['Plant', 'Location', 'Customer'].forEach(function (t) {
        var el = document.getElementById('vizFsChk' + t);
        if (el) el.checked = VIZ_VISIBLE[t.toLowerCase()];
      });
      setTimeout(function () {
        var graph = vizBuildGraph(vizCurrentPrd, VIZ_DATA);
        vizNetworkFull = vizMakeNetwork(
          document.getElementById('vizCanvasFull'), graph.nodes, graph.edges);
      }, 100);
    }

    function vizCloseFullscreen() {
      document.getElementById('vizFullscreenDlg').close();
      if (vizNetworkFull) { vizNetworkFull.destroy(); vizNetworkFull = null; }
    }

    function vizFsFit() {
      if (vizNetworkFull) vizNetworkFull.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    }

    /* --- Toggle node type visibility --------------------------------- */
    function vizToggleType(type, visible) {
      VIZ_VISIBLE[type] = visible;

      // Sincronizar ambos checkboxes (main + fullscreen)
      var chkMain = document.getElementById('vizChk' + type.charAt(0).toUpperCase() + type.slice(1));
      var chkFs = document.getElementById('vizFsChk' + type.charAt(0).toUpperCase() + type.slice(1));
      if (chkMain && chkMain.checked !== visible) chkMain.checked = visible;
      if (chkFs && chkFs.checked !== visible) chkFs.checked = visible;

      // Actualizar nodos en los networks activos sin re-renderizar
      [vizNetwork, vizNetworkFull].forEach(function (net) {
        if (!net) return;
        var ds = net.body.data.nodes;
        var updates = [];
        ds.forEach(function (node) {
          if (node._type === type) updates.push({ id: node.id, hidden: !visible });
        });
        if (updates.length) {
          ds.update(updates);
          // Recentrar suavemente tras cambio de visibilidad
          net.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } });
        }
      });
    }

    function setConnected(on) {
      if (typeof IS_CONNECTED !== 'undefined') IS_CONNECTED = !!on;
      document.getElementById('statusDot').className = 'status-dot ' + (on ? 'on' : 'off');
      document.getElementById('statusText').textContent = on ? 'Conectado' : 'Desconectado';
      
      document.querySelectorAll('.lock-icon').forEach(function(el) {
          el.style.display = on ? 'none' : 'inline';
      });
      
      if (typeof updateTabLocks === 'function') {
          updateTabLocks();
      }
      
      if (on && typeof _connectPanelOpen !== 'undefined' && _connectPanelOpen) {
          toggleConnectPanel();
      }

      if (on) {
          var toast = document.createElement('div');
          toast.textContent = '✅ Conectado a SAP IBP con éxito';
          toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#10B981;color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:9999;transition:opacity 0.3s;';
          document.body.appendChild(toast);
          setTimeout(function() {
              toast.style.opacity = '0';
              setTimeout(function() { if(toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
          }, 3500);
      }
    }

    function setProgress(pct) {
      document.getElementById('progFill').style.width = pct + '%';
    }


