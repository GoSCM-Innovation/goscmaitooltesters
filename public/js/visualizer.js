    /* ═══════════════════════════════════════════════════════════════
       SUPPLY NETWORK VISUALIZER — per-product API fetch
       ═══════════════════════════════════════════════════════════════ */
    var vizNetwork = null;
    var vizNetworkFull = null;
    var vizCurrentPrd = '';
    var vizSuggestions = [];
    var VIZ_DATA = null;  // cached data for current product
    var VIZ_VISIBLE = { plant: true, location: true, customer: true, supplier: true };
    var VIZ_HIDDEN_LOC = new Set();
    var VIZ_HIDDEN_CUST = new Set();

    /* --- Confirm mapping: load products only -------------------------- */
    async function vizConfirmMapping() {
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
        var _vb1 = document.getElementById('bodyVizMDT'); if (_vb1) _vb1.style.display = 'none';
        var _va1 = document.getElementById('arrVizMDT');  if (_va1) _va1.textContent = '▶';
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
        var t1 = [], t2 = [], t3 = [];
        vizSuggestions.forEach(function (s) {
          var pid = s.prdid.toLowerCase();
          var pdesc = s.prddescr.toLowerCase();
          if (pid.startsWith(q))            { t1.push(s); }
          else if (pdesc.startsWith(q))     { t2.push(s); }
          else if (pid.includes(q) || pdesc.includes(q)) { t3.push(s); }
        });
        vizRenderSugList(t1.concat(t2).concat(t3).slice(0, 40));
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
      // Reset Rutas panel for new product
      _vizRutas = [];
      var _rp = document.getElementById('vizRutasPanel'); if (_rp) _rp.style.display = 'none';
      var _rb = document.getElementById('vizRutasBody');  if (_rb) _rb.style.display = 'none';
      var _bt = document.getElementById('btnVizRutasToggle'); if (_bt) _bt.textContent = '▶ Rutas';
      var cfg = {
        base: CFG.url + '/sap/opu/odata/IBP/' + CFG.service + '/',
        location: document.getElementById('selVizLocation').value,
        customer: document.getElementById('selVizCustomer').value,
        sourceProd: document.getElementById('selVizSourceProd').value,
        locMaster: document.getElementById('selVizLocMaster').value,
        custMaster: document.getElementById('selVizCustMaster').value,
        sourceItem: (document.getElementById('selVizSourceItem') || {}).value || '',
        locProd:    (document.getElementById('selVizLocProd')    || {}).value || '',
        custProd:   (document.getElementById('selVizCustProd')   || {}).value || ''
      };
      var logEl = document.getElementById('logNet');
      var statusBar = document.getElementById('vizLoadStatusBar');
      var statusText = document.getElementById('vizLoadStatusText');
      var btnLoad = document.getElementById('btnVizLoadNet');
      logEl.innerHTML = '';
      logEl.classList.add('hidden');
      document.getElementById('btnToggleNetLogs').textContent = 'Ver logs técnicos';
      // Resetear visibilidad, checkboxes y filtros al cargar nuevo producto
      VIZ_VISIBLE = { plant: true, location: true, customer: true, supplier: true };
      VIZ_HIDDEN_LOC = new Set();
      VIZ_HIDDEN_CUST = new Set();
      vizUpdateFilterBtn();
      ['Plant', 'Location', 'Customer', 'Supplier'].forEach(function (t) {
        var el = document.getElementById('vizChk' + t);
        if (el) el.checked = true;
      });
      statusBar.style.display = 'flex';
      statusText.textContent = 'Procesando red de ' + prdid + '…';
      btnLoad.disabled = true;
      btnLoad.textContent = '⏳ Cargando...';
      btnLoad.style.opacity = '0.7';
      document.getElementById('vizDetail').style.display = 'none';
      document.getElementById('vizEmpty').style.display = 'none';
      document.getElementById('vizStatus').textContent = '⏳ Cargando ' + prdid + '…';
      document.getElementById('btnVizFullscreen').style.display = 'none';

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
        var psiRows = [], supplierLocRows = [], locProdRows = [], custProdRows = [];

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
          log(logEl, 'info', '[GET] ' + cfg.base + cfg.sourceProd + ' | $filter=' + prdFilter + ' | $select=SOURCEID,PRDID,LOCID,PLEADTIME');
          plantRows = await fetchAllPages(cfg.base + cfg.sourceProd, logEl, prdFilter, 'SOURCEID,PRDID,LOCID,PLEADTIME');
          log(logEl, 'ok', '✓ Production Source Header: ' + plantRows.length + ' registros');
        }

        // Collect unique LOCIDs / CUSTIDs (base — before supplier rows)
        var locIds = {}, custIds = {};
        locRows.forEach(function (r) { if (r.LOCFR) locIds[r.LOCFR] = true; if (r.LOCID) locIds[r.LOCID] = true; });
        custRows.forEach(function (r) { if (r.LOCID) locIds[r.LOCID] = true; if (r.CUSTID) custIds[r.CUSTID] = true; });
        plantRows.forEach(function (r) { if (r.LOCID) locIds[r.LOCID] = true; });

        // PSI — BOM components for this product
        if (cfg.sourceItem && plantRows.length) {
          var sourceIdSet = {}, sourceIds = [];
          plantRows.forEach(function (r) { var s = str(r.SOURCEID); if (s && !sourceIdSet[s]) { sourceIdSet[s] = true; sourceIds.push(s); } });
          if (sourceIds.length) {
            var psiFilter = sourceIds.map(function (s) { return "SOURCEID eq '" + s + "'"; }).join(' or ');
            if (paBase) psiFilter = '(' + psiFilter + ') and ' + paBase;
            log(logEl, 'info', '[GET] ' + cfg.base + cfg.sourceItem + ' | PSI para ' + sourceIds.length + ' fuentes');
            psiRows = await fetchAllPages(cfg.base + cfg.sourceItem, logEl, psiFilter, 'SOURCEID,PRDID,COMPONENTCOEFFICIENT');
            log(logEl, 'ok', '✓ PSI: ' + psiRows.length + ' componentes');
          }
        }

        // Supplier Location Source arcs (for PSI components)
        if (cfg.location && psiRows.length) {
          var compSet = {};
          psiRows.forEach(function (r) { var c = str(r.PRDID); if (c) compSet[c] = true; });
          var compList = Object.keys(compSet).slice(0, 100); // cap URL length
          if (compList.length) {
            var suppFilter = compList.map(function (c) { return "PRDID eq '" + c + "'"; }).join(' or ');
            if (paBase) suppFilter = '(' + suppFilter + ') and ' + paBase;
            log(logEl, 'info', '[GET] ' + cfg.base + cfg.location + ' | Arcos de proveedor para ' + compList.length + ' componentes');
            supplierLocRows = await fetchAllPages(cfg.base + cfg.location, logEl, suppFilter, 'PRDID,LOCFR,LOCID,TLEADTIME');
            log(logEl, 'ok', '✓ Arcos de proveedor: ' + supplierLocRows.length + ' registros');
            supplierLocRows.forEach(function (r) { if (r.LOCFR) locIds[r.LOCFR] = true; if (r.LOCID) locIds[r.LOCID] = true; });
          }
        }

        // Location Product (current product)
        if (cfg.locProd) {
          log(logEl, 'info', '[GET] ' + cfg.base + cfg.locProd + ' | Location Product → ' + prdid);
          locProdRows = await fetchAllPages(cfg.base + cfg.locProd, logEl, prdFilter, 'PRDID,LOCID');
          log(logEl, 'ok', '✓ Location Product: ' + locProdRows.length + ' registros');
        }

        // Customer Product (current product)
        if (cfg.custProd) {
          log(logEl, 'info', '[GET] ' + cfg.base + cfg.custProd + ' | Customer Product → ' + prdid);
          custProdRows = await fetchAllPages(cfg.base + cfg.custProd, logEl, prdFilter, 'PRDID,CUSTID');
          log(logEl, 'ok', '✓ Customer Product: ' + custProdRows.length + ' registros');
        }

        if (cfg.locMaster && Object.keys(locIds).length) {
          var ids = Object.keys(locIds);
          var locMFilter = ids.map(function (id) { return "LOCID eq '" + id + "'"; }).join(' or ');
          if (paBase) locMFilter = '(' + locMFilter + ') and ' + paBase;
          log(logEl, 'info', '[GET] ' + cfg.base + cfg.locMaster + ' | $filter=' + locMFilter + ' | $select=LOCID,LOCDESCR,LOCTYPE');
          locMasters = await fetchAllPages(cfg.base + cfg.locMaster, logEl, locMFilter, 'LOCID,LOCDESCR,LOCTYPE');
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
          locMasters: locMasters, custMasters: custMasters,
          psiRows: psiRows, supplierLocRows: supplierLocRows,
          locProdRows: locProdRows, custProdRows: custProdRows
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
        log(logEl, 'ok', '✓ Diagrama: ' + summary);
        vizRenderRutas();
        var _vb2 = document.getElementById('bodyVizMDT'); if (_vb2) _vb2.style.display = 'none';
        var _va2 = document.getElementById('arrVizMDT');  if (_va2) _va2.textContent = '▶';
      } catch (e) {
        statusText.textContent = '✕ Error: ' + e.message;
        document.getElementById('vizStatus').textContent = '✕ Error: ' + e.message;
        log(logEl, 'err', '✕ Error: ' + e.message);
      } finally {
        var b = document.getElementById('btnVizLoadNet');
        if (b) { b.disabled = false; b.style.opacity = '1'; b.textContent = 'Cargar red logística'; }
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
        product:  { background: '#6C63FF', border: '#8B84FF', hover: { background: '#8B84FF' }, highlight: { background: '#8B84FF', border: '#fff' } },
        plant:    { background: '#F59E0B', border: '#FBBF24', hover: { background: '#FBBF24' }, highlight: { background: '#FBBF24', border: '#fff' } },
        location: { background: '#0E8FAD', border: '#06B6D4', hover: { background: '#06B6D4' }, highlight: { background: '#06B6D4', border: '#fff' } },
        customer: { background: '#0B8A63', border: '#10B981', hover: { background: '#10B981' }, highlight: { background: '#10B981', border: '#fff' } },
        supplier: { background: '#5B21B6', border: '#a78bfa', hover: { background: '#7C3AED' }, highlight: { background: '#7C3AED', border: '#fff' } }
      };

      function addNode(id, type, label, title) {
        if (nodeMap[id]) return;
        var shapes = { product: 'star', plant: 'box', location: 'ellipse', customer: 'box', supplier: 'diamond' };
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

      // Supplier arcs (LOCFR=LOCTYPE:V → plant LOCID) — group by supp+dest for clean edges
      if (data.supplierLocRows && data.supplierLocRows.length) {
        var plantLocSet = {};
        data.plantRows.forEach(function (r) { var l = str(r.LOCID); if (l) plantLocSet[l] = true; });

        // psiByPlant: plant LOCID → { compPRDID: true } — only components in that plant's BOM
        var psiByPlant = {};
        if (data.plantRows && data.psiRows && data.psiRows.length) {
          var srcToPlant = {};
          data.plantRows.forEach(function (r) {
            var sid = str(r.SOURCEID), loc = str(r.LOCID);
            if (sid && loc) srcToPlant[sid] = loc;
          });
          data.psiRows.forEach(function (r) {
            var sid = str(r.SOURCEID), comp = str(r.PRDID);
            var plant = srcToPlant[sid];
            if (!plant || !comp) return;
            if (!psiByPlant[plant]) psiByPlant[plant] = {};
            psiByPlant[plant][comp] = true;
          });
        }

        var suppEdgeMap = {};
        data.supplierLocRows.forEach(function (r) {
          var supp = str(r.LOCFR), dest = str(r.LOCID);
          var compId = str(r.PRDID || '');
          if (!supp || !dest) return;
          var lm = locMap[supp] || {};
          if (str(lm.LOCTYPE) !== 'V') return;   // only supplier-type locations
          if (!plantLocSet[dest]) return;          // only arcs targeting a production plant
          // only if component is actually in the BOM of that specific plant
          if (compId && psiByPlant[dest] && !psiByPlant[dest][compId]) return;
          if (VIZ_VISIBLE.supplier === false) return;
          var key = supp + '||' + dest;
          if (!suppEdgeMap[key]) suppEdgeMap[key] = { supp: supp, dest: dest, lm: lm, comps: [] };
          var tlt    = str(r.TLEADTIME || '');
          suppEdgeMap[key].comps.push(compId + (tlt ? ' [LT:' + tlt + ']' : ''));
        });

        Object.keys(suppEdgeMap).forEach(function (key) {
          var se = suppEdgeMap[key];
          var ds = str(se.lm.LOCDESCR || '');
          addNode(se.supp, 'supplier',
            se.supp + (ds ? '\n' + ds : ''),
            'Proveedor: ' + se.supp + (ds ? '\n' + ds : ''));
          if (!edgesArr.some(function (e) { return e.id === key; })) {
            edgesArr.push({
              id: key, from: se.supp, to: se.dest,
              arrows: { to: { enabled: true, scaleFactor: 0.55 } },
              dashes: [6, 4],
              color: { color: 'rgba(167,139,250,0.5)', highlight: 'rgba(167,139,250,0.95)', hover: 'rgba(167,139,250,0.75)' },
              width: 1.5,
              title: 'Componentes: ' + se.comps.join(', '),
              _detail: 'Componentes: ' + se.comps.join(', ')
            });
          }
        });
      }

      return { nodes: Object.values(nodeMap), edges: edgesArr };
    }

    /* --- Manual column-based positioning (barycenter to reduce crossings) */
    function vizAssignPositions(nodes) {
      var COL_W = 260;
      var ROW_H = 80;
      var MAX_ROWS = 8;

      var byType = { product: [], plant: [], location: [], customer: [], supplier: [] };
      nodes.forEach(function (n) {
        var t = n._type || 'location';
        if (byType[t]) byType[t].push(n); else byType.location.push(n);
      });

      var numLocCols  = Math.max(1, Math.ceil(byType.location.length  / MAX_ROWS));
      var numSuppCols = Math.max(1, Math.ceil(byType.supplier.length   / MAX_ROWS));

      var xSupp0 = -(numSuppCols * COL_W);
      var xPrd   = 0;
      var xPlt   = COL_W;
      var xLoc0  = COL_W * 2;
      var xCust  = COL_W * (2 + numLocCols);

      // Build adjacency from edges for barycenter sorting
      var nodeById = {};
      nodes.forEach(function (n) { nodeById[n.id] = n; });

      // Place function with column splitting
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

      // Step 1: Place plants first (anchor column), sort alphabetically
      byType.plant.sort(function (a, b) { return a.id.localeCompare(b.id); });
      place(byType.plant, xPlt, 1);

      // Step 2: Sort suppliers by barycenter of their connected plants
      if (byType.supplier.length && byType.plant.length) {
        var plantYMap = {};
        byType.plant.forEach(function (n) { plantYMap[n.id] = n.y; });
        // Collect supplier→plant connections from edges in VIZ_DATA
        var suppToPlants = {};
        if (VIZ_DATA && VIZ_DATA.supplierLocRows) {
          var plantSet = {};
          byType.plant.forEach(function (n) { plantSet[n.id] = true; });
          VIZ_DATA.supplierLocRows.forEach(function (r) {
            var supp = str(r.LOCFR), dest = str(r.LOCID);
            if (supp && dest && plantSet[dest]) {
              if (!suppToPlants[supp]) suppToPlants[supp] = {};
              suppToPlants[supp][dest] = true;
            }
          });
        }
        byType.supplier.sort(function (a, b) {
          var aTargets = suppToPlants[a.id] ? Object.keys(suppToPlants[a.id]) : [];
          var bTargets = suppToPlants[b.id] ? Object.keys(suppToPlants[b.id]) : [];
          var aAvg = aTargets.length ? aTargets.reduce(function (s, t) { return s + (plantYMap[t] || 0); }, 0) / aTargets.length : 0;
          var bAvg = bTargets.length ? bTargets.reduce(function (s, t) { return s + (plantYMap[t] || 0); }, 0) / bTargets.length : 0;
          return aAvg - bAvg;
        });
      }
      place(byType.supplier, xSupp0, numSuppCols);

      // Step 3: Sort locations by barycenter of connected plants (incoming edges)
      if (byType.location.length && byType.plant.length) {
        var plantYMap2 = {};
        byType.plant.forEach(function (n) { plantYMap2[n.id] = n.y; });
        var locIncoming = {};
        if (VIZ_DATA) {
          (VIZ_DATA.locRows || []).forEach(function (r) {
            var fr = str(r.LOCFR), to = str(r.LOCID);
            if (fr && to) {
              if (!locIncoming[to]) locIncoming[to] = {};
              locIncoming[to][fr] = true;
              if (!locIncoming[fr]) locIncoming[fr] = {};
            }
          });
        }
        // Compute barycenter: average y of all connected nodes that are already placed
        var plantSet2 = {};
        byType.plant.forEach(function (n) { plantSet2[n.id] = n.y; });
        byType.location.sort(function (a, b) {
          var aSum = 0, aCnt = 0, bSum = 0, bCnt = 0;
          var aIn = locIncoming[a.id] || {};
          var bIn = locIncoming[b.id] || {};
          Object.keys(aIn).forEach(function (src) { if (plantSet2[src] !== undefined) { aSum += plantSet2[src]; aCnt++; } });
          Object.keys(bIn).forEach(function (src) { if (plantSet2[src] !== undefined) { bSum += plantSet2[src]; bCnt++; } });
          var aAvg = aCnt ? aSum / aCnt : 0;
          var bAvg = bCnt ? bSum / bCnt : 0;
          return aAvg - bAvg;
        });
      }
      place(byType.location, xLoc0, numLocCols);

      // Step 4: Sort customers by barycenter of connected locations
      if (byType.customer.length && byType.location.length) {
        var locYMap = {};
        byType.location.forEach(function (n) { locYMap[n.id] = n.y; });
        var custToLocs = {};
        if (VIZ_DATA) {
          (VIZ_DATA.custRows || []).forEach(function (r) {
            var loc = str(r.LOCID), cust = str(r.CUSTID);
            if (loc && cust) {
              if (!custToLocs[cust]) custToLocs[cust] = {};
              custToLocs[cust][loc] = true;
            }
          });
        }
        byType.customer.sort(function (a, b) {
          var aLocs = custToLocs[a.id] ? Object.keys(custToLocs[a.id]) : [];
          var bLocs = custToLocs[b.id] ? Object.keys(custToLocs[b.id]) : [];
          var aAvg = aLocs.length ? aLocs.reduce(function (s, l) { return s + (locYMap[l] || 0); }, 0) / aLocs.length : 0;
          var bAvg = bLocs.length ? bLocs.reduce(function (s, l) { return s + (locYMap[l] || 0); }, 0) / bLocs.length : 0;
          return aAvg - bAvg;
        });
      }
      place(byType.customer, xCust, 1);

      place(byType.product, xPrd, 1);

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
            var typeLabels = { product: 'Producto', plant: 'Planta', location: 'Ubicación', customer: 'Cliente', supplier: 'Proveedor' };
            var badgeMap = { product: 'badge-psh', plant: 'badge-main', location: 'badge-comp', customer: 'badge-leaf', supplier: 'badge-coprod' };
            var html =
              '<span class="badge ' + (badgeMap[node._type] || 'badge-comp') + '">' +
              (typeLabels[node._type] || node._type) + '</span>' +
              ' <strong style="font-family:var(--mono);font-size:12px">' + escH(nid) + '</strong>' +
              (node._title && node._title !== nid ? ' <span style="color:var(--text2)">' + escH(node._title) + '</span>' : '');

            // Supplier click: show component inputs
            if (node._type === 'supplier' && VIZ_DATA && VIZ_DATA.supplierLocRows) {
              var compsBySupp = {};
              VIZ_DATA.supplierLocRows.forEach(function (r) {
                if (str(r.LOCFR) === nid) {
                  var comp = str(r.PRDID || '');
                  if (comp) compsBySupp[comp] = true;
                }
              });
              var compList = Object.keys(compsBySupp).sort();
              if (compList.length) {
                var prdLookup = {};
                vizSuggestions.forEach(function (s) { prdLookup[s.prdid] = s.prddescr; });
                html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">' +
                  '<div style="font-size:11px;color:var(--text3);margin-bottom:4px;font-weight:600;">Insumos abastecidos (' + compList.length + '):</div>' +
                  '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
                compList.forEach(function (c) {
                  var descr = prdLookup[c] || '';
                  html += '<span style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:var(--mono);">' +
                    escH(c) + (descr ? ' <span style="color:var(--text3)">' + escH(descr) + '</span>' : '') + '</span>';
                });
                html += '</div></div>';
              }
            }

            document.getElementById('vizDetailContent').innerHTML = html;
            detail.style.cssText = 'display:block;padding:10px 24px;background:var(--bg2);border-bottom:1px solid var(--border);font-size:12px;';
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
      ['Plant', 'Location', 'Customer', 'Supplier'].forEach(function (t) {
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
      
      if (on && typeof closeConnectDialog === 'function') {
          closeConnectDialog();
      }

      if (on) {
          var toast = document.createElement('div');
          toast.textContent = '✅ Conectado a SAP IBP con éxito';
          toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--green);color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:9999;transition:opacity 0.3s;';
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

    /* ══════════════════════════════════════════════════════════════════
       RUTAS PANEL — computa y muestra rutas completas e incompletas
       para el producto activo en el Visualizer. Reutiliza snFindAllPaths.
       ══════════════════════════════════════════════════════════════════ */
    var _vizRutas = [];

    function vizRenderRutas() {
      if (!VIZ_DATA || !vizCurrentPrd) return;
      var panel   = document.getElementById('vizRutasPanel');
      var summEl  = document.getElementById('vizRutasSummary');
      var csvBtn  = document.getElementById('btnVizRutasCsv');
      if (!panel) return;

      var graph = vizBuildGraphFromData(vizCurrentPrd, VIZ_DATA);
      var paths = snFindAllPaths(graph);

      var plantsWithPaths = {};
      paths.forEach(function(p) { plantsWithPaths[p.plant] = true; });
      var incompletePaths = [];
      graph.plants.forEach(function(plant) {
        if (!plantsWithPaths[plant]) {
          incompletePaths.push({ plant: plant, nodes: [plant], customer: null, complete: false });
        }
      });

      _vizRutas = paths.map(function(p) {
        return { plant: p.plant, nodes: p.nodes, customer: p.customer, complete: true };
      }).concat(incompletePaths);

      var nC = paths.length, nI = incompletePaths.length;
      var truncNote = paths._truncated ? ' (truncadas a 50.000)' : '';
      summEl.textContent = nC + ' ruta(s) completa(s)' + truncNote
        + (nI > 0 ? ' · ' + nI + ' planta(s) sin ruta a cliente' : '');
      if (csvBtn) csvBtn.style.display = _vizRutas.length ? '' : 'none';
      panel.style.display = '';
      vizRutasRenderTable();
    }

    function vizRutasToggle() {
      var body = document.getElementById('vizRutasBody');
      var btn  = document.getElementById('btnVizRutasToggle');
      if (!body) return;
      var open = body.style.display === 'none';
      body.style.display = open ? 'block' : 'none';
      btn.textContent = open ? '▼ Rutas' : '▶ Rutas';
    }

    function vizRutasRenderTable() {
      var tbl = document.getElementById('vizRutasTable');
      if (!tbl) return;
      if (!_vizRutas.length) {
        tbl.innerHTML = '<p style="color:var(--text2);font-size:12px;margin:0;">No hay rutas configuradas para este producto.</p>';
        return;
      }
      var rows = [
        '<table style="width:100%;border-collapse:collapse;font-size:12px;">',
        '<thead><tr>',
        '<th style="text-align:left;padding:4px 8px;color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:.05em;">#</th>',
        '<th style="text-align:left;padding:4px 8px;color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:.05em;">Tipo</th>',
        '<th style="text-align:left;padding:4px 8px;color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:.05em;">Ruta</th>',
        '<th style="text-align:right;padding:4px 8px;color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:.05em;">Saltos</th>',
        '</tr></thead><tbody>'
      ];
      _vizRutas.forEach(function(r, i) {
        var label = r.complete
          ? '<span style="color:var(--green);font-weight:600;">\u2713 Completa</span>'
          : '<span style="color:#F59E0B;font-weight:600;">\u26a0 Sin cliente</span>';
        var nodesStr = r.nodes.join(' \u2192 ') + (r.customer ? ' \u2192 ' + r.customer : '');
        var saltos = r.nodes.length - 1 + (r.customer ? 1 : 0);
        var bg = i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)';
        rows.push(
          '<tr style="background:' + bg + ';cursor:pointer;" onclick="vizRutasHighlight(' + i + ')" title="Click para resaltar en el grafo">',
          '<td style="padding:4px 8px;color:var(--text2);">' + (i + 1) + '</td>',
          '<td style="padding:4px 8px;">' + label + '</td>',
          '<td style="padding:4px 8px;color:var(--text);font-family:var(--mono);font-size:11px;">' + escH(nodesStr) + '</td>',
          '<td style="padding:4px 8px;text-align:right;color:var(--text2);">' + saltos + '</td>',
          '</tr>'
        );
      });
      rows.push('</tbody></table>');
      tbl.innerHTML = rows.join('');
    }

    function vizRutasHighlight(idx) {
      if (!vizNetwork) return;
      var r = _vizRutas[idx];
      if (!r) return;
      var allNodes = r.nodes.concat(r.customer ? [r.customer] : []);
      var edgeIds  = [];
      var vizEdges = vizNetwork.body.data.edges;
      function checkArc(fr, to) {
        vizEdges.forEach(function(e) {
          if ((e.from === fr && e.to === to) || (e.from === to && e.to === fr)) edgeIds.push(e.id);
        });
      }
      for (var k = 0; k < r.nodes.length - 1; k++) checkArc(r.nodes[k], r.nodes[k + 1]);
      if (r.customer) checkArc(r.nodes[r.nodes.length - 1], r.customer);
      vizNetwork.selectNodes(allNodes);
      vizNetwork.selectEdges(edgeIds);
      if (allNodes.length > 0) {
        try {
          vizNetwork.focus(allNodes[0], { animation: { duration: 500, easingFunction: 'easeInOutQuad' }, scale: 0.85 });
        } catch(e) {}
      }
    }

    function vizRutasCsv() {
      if (!_vizRutas.length) return;
      var prd = vizCurrentPrd || 'producto';
      var lines = ['"#","Tipo","Planta","Ruta","Cliente","# Saltos"'];
      _vizRutas.forEach(function(r, i) {
        var tipo  = r.complete ? 'Completa' : 'Sin cliente';
        var ruta  = r.nodes.join(' -> ') + (r.customer ? ' -> ' + r.customer : '');
        lines.push([(i + 1), tipo, r.plant, '"' + ruta + '"', r.customer || '', r.nodes.length - 1 + (r.customer ? 1 : 0)].join(','));
      });
      var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Rutas_' + prd + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }


