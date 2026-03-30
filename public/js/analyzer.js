    /* ═══════════════════════════════════════════════════════════════
       SUPPLY NETWORK: STREAMING FETCH + INDEX + ANALYSE + EXPORT
       ═══════════════════════════════════════════════════════════════ */

    /* Fetches all OData pages, calls onPage(results) per page (no accumulation). */
    async function fetchAndIndex(entityUrl, logEl, pverFilter, selectFields, onPage) {
      var PAGE_SIZE = 5000;
      var page = 0, total = 0;
      var filterParam = pverFilter ? '&$filter=' + encodeURIComponent(pverFilter) : '';
      var selectParam = selectFields ? '&$select=' + encodeURIComponent(selectFields) : '';
      var url = entityUrl + '?$format=json&$top=' + PAGE_SIZE + filterParam + selectParam;

      while (url) {
        page++;
        if (page === 1) log(logEl, 'info', '  ↳ URL: ' + url);
        else log(logEl, 'info', '  ↳ Pág.' + page + ' → ' + url);
        var data = await apiJson(url);
        var results = (data.d && data.d.results) ? data.d.results : (data.value || []);
        await onPage(results);   // index/store this page, then let it be GC'd
        total += results.length;

        if (page > 1) log(logEl, 'info', '  ↳ Pág.' + page + ': +' + results.length + ' (acum: ' + total + ')');

        var next = (data.d && data.d.__next) ? data.d.__next : null;
        if (!next && data['@odata.nextLink']) next = data['@odata.nextLink'];
        if (next) {
          url = (next.indexOf('http') === 0) ? next : (CFG.url + next);
        } else if (results.length === PAGE_SIZE) {
          url = entityUrl + '?$format=json&$top=' + PAGE_SIZE + '&$skip=' + total + filterParam + selectParam;
          log(logEl, 'warn', '  ↳ Sin __next, fallback $skip=' + total);
        } else { url = null; }
      }
      return total;
    }

    /* Single-button handler: index → analyse → export — no raw arrays in memory */
    async function doAnalyzeAndExport() {
      if (typeof toggleMappingBody === 'function') toggleMappingBody('bodySNMDT', 'arrSNMDT', false);
      var logEl = document.getElementById('logSN');
      logEl.innerHTML = '';
      logEl.classList.add('hidden');
      document.getElementById('progBarSN').classList.remove('hidden');
      document.getElementById('progStatusSN').style.cssText = 'display:flex;font-size:12px;color:var(--text2);margin-top:4px;align-items:center;gap:8px;';
      document.getElementById('btnFetchSN').disabled = true;
      document.getElementById('snSuccessBanner').classList.add('hidden');
      var timer = createTimer();

      var locationEntity = document.getElementById('selSNLocation').value;
      var customerEntity = document.getElementById('selSNCustomer').value;
      var productEntity = document.getElementById('selSNProduct').value;
      var sourceProdEntity = document.getElementById('selSNSourceProd').value;
      var locMasterEntity = document.getElementById('selSNLocMaster').value;
      var custMasterEntity = document.getElementById('selSNCustMaster').value;
      var sourceItemEntity = document.getElementById('selSNSourceItem').value;
      var locProdEntity = document.getElementById('selSNLocProd').value;
      var custProdEntity = document.getElementById('selSNCustProd').value;

      if (!locationEntity && !customerEntity && !sourceProdEntity) {
        log(logEl, 'err', timer.fmt() + ' Configura al menos una entidad de red antes de analizar');
        document.getElementById('btnFetchSN').disabled = false;
        return;
      }

      var baseOData = CFG.url + '/sap/opu/odata/IBP/' + CFG.service + '/';
      var paFilter = CFG.pa
        ? (CFG.pver
          ? "PlanningAreaID eq '" + CFG.pa + "' and VersionID eq '" + CFG.pver + "'"
          : "PlanningAreaID eq '" + CFG.pa + "'")
        : '';

      // Reset SN — edge tables go to IDB, only small lookups stay in JS
      SN_IDX = { allPrds: {}, prdLookup: {}, locLookup: {}, custLookup: {}, pshPrds: {}, psiCompPrds: {} };

      try {
        var progEl = document.getElementById('progFillSN');
        progEl.style.width = '0%';

        // Open IDB and wipe previous SN edge data
        if (!IDB) IDB = await openDB();
        await Promise.all(['sn_loc', 'sn_cust', 'sn_plant', 'sn_psi', 'sn_loc_prod', 'sn_cust_prod'].map(idbClear));

        // ── PHASE 1: Download + store 6 entities (0 → 50%) ──────────────────

        if (locationEntity) {
          setStatusSN('info', 'Descargando Location Source → IDB...');
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + locationEntity);
          var nLoc = await fetchAndIndex(baseOData + locationEntity, logEl, paFilter,
            'PRDID,LOCFR,LOCID,TLEADTIME',
            function (rows) {
              rows.forEach(function (r) { var p = str(r.PRDID); if (p) SN_IDX.allPrds[p] = true; });
              return idbBulkPut('sn_loc', rows);
            });
          log(logEl, 'ok', timer.fmt() + ' Location Source: ' + nLoc + ' reg → IDB (' + Object.keys(SN_IDX.allPrds).length + ' productos)');
        }
        progEl.style.width = '8%';

        if (customerEntity) {
          setStatusSN('info', 'Descargando Customer Source → IDB...');
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + customerEntity);
          var nCust = await fetchAndIndex(baseOData + customerEntity, logEl, paFilter,
            'PRDID,LOCID,CUSTID,CLEADTIME',
            function (rows) {
              rows.forEach(function (r) { var p = str(r.PRDID); if (p) SN_IDX.allPrds[p] = true; });
              return idbBulkPut('sn_cust', rows);
            });
          log(logEl, 'ok', timer.fmt() + ' Customer Source: ' + nCust + ' reg → IDB');
        }
        progEl.style.width = '17%';

        if (productEntity) {
          setStatusSN('info', 'Indexando Product (lookup en memoria)...');
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + productEntity);
          var nPrd = await fetchAndIndex(baseOData + productEntity, logEl, paFilter,
            'PRDID,PRDDESCR,MATTYPEID',
            function (rows) {
              rows.forEach(function (r) { var k = str(r.PRDID); if (k) SN_IDX.prdLookup[k] = r; });
              return Promise.resolve();
            });
          log(logEl, 'ok', timer.fmt() + ' Product: ' + nPrd + ' reg');
        }
        progEl.style.width = '25%';

        if (sourceProdEntity) {
          setStatusSN('info', 'Descargando Production Source Header → IDB...');
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + sourceProdEntity);
          var nSrc = await fetchAndIndex(baseOData + sourceProdEntity, logEl, paFilter,
            'PRDID,LOCID,PLEADTIME',
            function (rows) {
              rows.forEach(function (r) { var p = str(r.PRDID); if (p) { SN_IDX.allPrds[p] = true; SN_IDX.pshPrds[p] = true; } });
              return idbBulkPut('sn_plant', rows);
            });
          log(logEl, 'ok', timer.fmt() + ' Production Source Header: ' + nSrc + ' reg → IDB');
        }
        progEl.style.width = '28%';

        if (sourceItemEntity) {
          setStatusSN('info', 'Descargando Production Source Item → IDB...');
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + sourceItemEntity);
          var nPsi = await fetchAndIndex(baseOData + sourceItemEntity, logEl, paFilter,
            'SOURCEID,PRDID,COMPONENTCOEFFICIENT,UOMID',
            function (rows) {
              rows.forEach(function (r) { var p = str(r.PRDID); if (p) SN_IDX.psiCompPrds[p] = true; });
              return idbBulkPut('sn_psi', rows);
            });
          log(logEl, 'ok', timer.fmt() + ' Production Source Item: ' + nPsi + ' reg → IDB (' + Object.keys(SN_IDX.psiCompPrds).length + ' componentes únicos)');
        }
        progEl.style.width = '33%';

        if (locMasterEntity) {
          setStatusSN('info', 'Indexando Location (lookup en memoria)...');
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + locMasterEntity);
          var nLocM = await fetchAndIndex(baseOData + locMasterEntity, logEl, paFilter,
            'LOCID,LOCDESCR,LOCTYPE',
            function (rows) {
              rows.forEach(function (r) { var k = str(r.LOCID); if (k) SN_IDX.locLookup[k] = r; });
              return Promise.resolve();
            });
          log(logEl, 'ok', timer.fmt() + ' Location: ' + nLocM + ' reg');
        }
        progEl.style.width = '38%';

        if (locProdEntity) {
          setStatusSN('info', 'Descargando Location Product → IDB...');
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + locProdEntity);
          var nLocProd = await fetchAndIndex(baseOData + locProdEntity, logEl, paFilter,
            'LOCID,PRDID',
            function (rows) { return idbBulkPut('sn_loc_prod', rows); });
          log(logEl, 'ok', timer.fmt() + ' Location Product: ' + nLocProd + ' reg → IDB');
        }
        progEl.style.width = '42%';

        if (custMasterEntity) {
          setStatusSN('info', 'Indexando Customer (lookup en memoria)...');
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + custMasterEntity);
          var nCustM = await fetchAndIndex(baseOData + custMasterEntity, logEl, paFilter,
            'CUSTID,CUSTDESCR',
            function (rows) {
              rows.forEach(function (r) { var k = str(r.CUSTID); if (k) SN_IDX.custLookup[k] = r; });
              return Promise.resolve();
            });
          log(logEl, 'ok', timer.fmt() + ' Customer: ' + nCustM + ' reg');
        }
        progEl.style.width = '46%';

        if (custProdEntity) {
          setStatusSN('info', 'Descargando Customer Product → IDB...');
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + custProdEntity);
          var nCustProd = await fetchAndIndex(baseOData + custProdEntity, logEl, paFilter,
            'CUSTID,PRDID',
            function (rows) { return idbBulkPut('sn_cust_prod', rows); });
          log(logEl, 'ok', timer.fmt() + ' Customer Product: ' + nCustProd + ' reg → IDB');
        }
        progEl.style.width = '50%';

        var totalPrds = Object.keys(SN_IDX.allPrds).length;
        log(logEl, 'ok', timer.fmt() + ' Índices listos. ' + totalPrds + ' productos en la red. Iniciando análisis...');
        setStatusSN('info', 'Analizando red (' + totalPrds + ' productos)...');

        // ── PHASE 2+3: Análisis + Excel streaming (50 → 100%) ──────────────
        // Las filas se escriben directamente a ExcelJS — sin arrays intermedios s1-s7.
        function onProg(pct) { progEl.style.width = pct + '%'; }
        function onStat(msg) { setStatusSN('info', msg); }
        var summary = await analyzeAndStreamExcel(onProg, onStat, timer, logEl);
        progEl.style.width = '100%';

        log(logEl, 'ok', timer.fmt() + ' ¡Excel descargado! ' + summary.totalProducts + ' productos analizados.');
        setStatusSN('ok', '¡Completado! ' + summary.totalProducts + ' productos · ' + timer.ms() + 'ms');
        document.getElementById('snSuccessBanner').classList.remove('hidden');

      } catch (e) {
        log(logEl, 'err', timer.fmt() + ' Error: ' + e.message);
        setStatusSN('err', 'Error: ' + e.message);
      }
      document.getElementById('btnFetchSN').disabled = false;
    }

    function setStatusSN(type, msg) {
      var el = document.getElementById('progStatusTextSN');
      if (!el) return;
      var colors = { ok: 'var(--accent)', err: 'var(--red)', warn: 'var(--amber)', info: 'var(--text2)' };
      el.style.color = colors[type] || 'var(--text2)';
      el.textContent = msg;
    }

    function toggleSNLogs() {
      var logEl = document.getElementById('logSN');
      var btn = document.getElementById('btnToggleSNLogs');
      var hidden = logEl.classList.toggle('hidden');
      btn.textContent = hidden ? 'Ver logs técnicos' : 'Ocultar logs';
    }

    function toggleVizLogs() {
      var logEl = document.getElementById('logViz');
      var btn = document.getElementById('btnToggleVizLogs');
      var hidden = logEl.classList.toggle('hidden');
      btn.textContent = hidden ? 'Ver logs técnicos' : 'Ocultar logs';
    }

    function toggleNetLogs() {
      var logEl = document.getElementById('logNet');
      var btn = document.getElementById('btnToggleNetLogs');
      var hidden = logEl.classList.toggle('hidden');
      btn.textContent = hidden ? 'Ver logs técnicos' : 'Ocultar logs';
    }


    /* ═══════════════════════════════════════════════════════════════
       SUPPLY NETWORK — ANÁLISIS + EXPORTACIÓN STREAMING
       Las filas se escriben directamente a ExcelJS sin acumular
       arrays intermedios s1-s7. Elimina la doble copia en RAM.
       ═══════════════════════════════════════════════════════════════ */
    async function analyzeAndStreamExcel(onProgress, onStatus, timer, logEl) {
      var products = Object.keys(SN_IDX.allPrds).sort();
      var n = products.length;

      function pd(id) { var p = SN_IDX.prdLookup[id] || {}; return str(p.PRDDESCR || ''); }
      function pm(id) { var p = SN_IDX.prdLookup[id] || {}; return str(p.MATTYPEID || ''); }
      function ld(id) { var l = SN_IDX.locLookup[id] || {}; return str(l.LOCDESCR || ''); }
      function cd(id) { var c = SN_IDX.custLookup[id] || {}; return str(c.CUSTDESCR || ''); }

      // ── Crear workbook + worksheets ANTES del loop ─────────────────────────
      var wb = new ExcelJS.Workbook();
      var today = new Date().toISOString().slice(0, 10);

      var GOLD = 'FFF7A800', ORANGE = 'FFE8622A', NAVY = 'FF0B1120';
      var TAB_COLS = ['FFF7A800', 'FFE8622A', 'FFFF6B6B', 'FF29ABE2', 'FFa78bfa', 'FFf472b6', 'FF34d399'];

      // Definición de los 7 sheets (sin campo rows — se escribe directo)
      var DEFS = [
        {
          name: 'Product Network Quality', tab: TAB_COLS[0],
          hdr: ['Product ID', 'Product Description', 'Material Type', 'Production Plant', 'Plant Description', 'Network Status', 'Quality Category', 'Description']
        },
        {
          name: 'Findings', tab: TAB_COLS[2],
          hdr: ['Finding Type', 'Product ID', 'Product Description', 'Location', 'Location Description', 'Customer', 'Customer Description', 'Description', 'Severity']
        },
        {
          name: 'Network Metrics', tab: TAB_COLS[3],
          hdr: ['Product ID', 'Product Description', 'Plants', 'Distribution Centers', 'Customers Reached', 'Paths', 'Longest Path', 'Ghost Nodes', 'Network Status']
        },
        {
          name: 'Network Resilience', tab: TAB_COLS[4],
          hdr: ['Product ID', 'Product Description', 'Customer ID', 'Customer Description', 'Paths', 'Critical Nodes', 'Resilience Category', 'Description']
        },
        {
          name: 'Critical Nodes', tab: TAB_COLS[5],
          hdr: ['Location ID', 'Location Description', 'Products Impacted', 'Customers Impacted', 'Node Type', 'Risk Level', 'Description']
        },
        {
          name: 'Network Health Score', tab: TAB_COLS[6],
          hdr: ['Product ID', 'Product Description', 'Health Score', 'Health Category', 'Plants', 'Customers', 'Paths', 'Ghost Nodes', 'Critical Nodes', 'Single Source Risk', 'Comments']
        }
      ];

      // Crear worksheets y escribir encabezados
      DEFS.forEach(function (def) {
        def.ws = wb.addWorksheet(def.name, { views: [{ state: 'frozen', ySplit: 1 }], properties: { tabColor: { argb: def.tab } } });
        def.ri = 0;
        def.colW = def.hdr.map(function (h) { return h.length; });
        def.ws.addRow(def.hdr);
        def.ws.getRow(1).eachCell(function (cell) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
          cell.font = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.border = { bottom: { style: 'medium', color: { argb: ORANGE } } };
        });
        def.ws.getRow(1).height = 20;
      });

      // Escribe una fila sin estilos por celda (reduce memoria ~50x vs styled rows)
      function addRow(di, rowData) {
        var def = DEFS[di];
        def.ri++;
        def.ws.addRow(rowData);
        // Actualizar ancho de columnas al vuelo
        rowData.forEach(function (v, ci) { var len = v != null ? String(v).length : 0; if (len > def.colW[ci]) def.colW[ci] = len; });
      }

      // Contadores de resumen (sin arrays)
      var selLocProd    = (document.getElementById('selSNLocProd')    || {}).value || '';
      var selCustProd   = (document.getElementById('selSNCustProd')   || {}).value || '';
      var selSourceItem = (document.getElementById('selSNSourceItem') || {}).value || '';

      var critNodeMap = {};
      var completeCount = 0;
      var totalPaths = 0;
      var ghostCount = 0;
      var healthSum = 0;
      var CHUNK = 50;

      for (var i = 0; i < n; i += CHUNK) {
        var batch = products.slice(i, Math.min(i + CHUNK, n));

        for (var bi = 0; bi < batch.length; bi++) {
          var prdid = batch[bi];
          var graph = await snBuildProductGraph(prdid);
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

          // Sheet 1 — Product Network Quality
          if (graph.plants.length === 0) {
            addRow(0, [prdid, pd(prdid), pm(prdid), '', '', metrics.networkStatus, catName, catDesc]);
          } else {
            graph.plants.forEach(function (plant) {
              var pp = paths.filter(function (p) { return p.plant === plant; });
              var pSt = pp.length > 0 ? 'Complete'
                : (graph.locEdges[plant] || graph.custEdges[plant]) ? 'Partial' : 'No Distribution';
              addRow(0, [prdid, pd(prdid), pm(prdid), plant, ld(plant), pSt, catName, catDesc]);
            });
          }

          // Sheet 2 — Findings (índice 1)
          cats.forEach(function (cat) {
            if (cat === 7) return;
            addRow(1, [snFindingType(cat), prdid, pd(prdid), '', '', '', '', snFindingDesc(cat), snFindingSeverity(cat)]);
          });
          ghosts.forEach(function (loc) {
            addRow(1, ['Ghost Node', prdid, pd(prdid), loc, ld(loc), '', '',
              'Node is fed from a plant and has outgoing connections, but none reach any customer', 'High']);
            ghostCount++;
          });
          deadEnds.forEach(function (loc) {
            addRow(1, ['Dead-End', prdid, pd(prdid), loc, ld(loc), '', '',
              'Node receives product but has no outgoing connections at all', 'High']);
          });
          isolatedPlants.forEach(function (plant) {
            addRow(1, ['Isolated Plant', prdid, pd(prdid), plant, ld(plant), '', '',
              'Plant has no valid path to any customer', 'High']);
          });
          cycles.forEach(function (cycle) {
            addRow(1, ['Network Cycle', prdid, pd(prdid), '', '', '', '',
              'Circular dependency: ' + cycle, 'Critical']);
          });
          if (graph.plants.length > 0 && graph.allCustomers.length === 0) {
            addRow(1, ['No Customers', prdid, pd(prdid), '', '', '', '',
              'Product has production configured but no customers registered in the network', 'High']);
          }
          ltIssues.forEach(function (lt) {
            if (lt.type === 'loc')
              addRow(1, ['Missing Lead Time', prdid, pd(prdid), lt.from, ld(lt.from), lt.to, ld(lt.to),
                'TLEADTIME not defined for transport leg ' + lt.from + ' → ' + lt.to, 'Medium']);
            else if (lt.type === 'cust')
              addRow(1, ['Missing Lead Time', prdid, pd(prdid), lt.from, ld(lt.from), lt.to, '',
                'CLEADTIME not defined for customer delivery ' + lt.from + ' → ' + lt.to, 'Medium']);
            else if (lt.type === 'plant')
              addRow(1, ['Missing Lead Time', prdid, pd(prdid), lt.loc, ld(lt.loc), '', '',
                'PLEADTIME not defined for production at plant ' + lt.loc, 'Medium']);
          });

          // V1 — Location Source arcs vs Location Product
          if (selLocProd) {
            var lpRows = await idbGetByIndex('sn_loc_prod', 'by_prdid', prdid);
            var lpSet = {};
            lpRows.forEach(function (r) { var k = str(r.LOCID); if (k) lpSet[k] = true; });
            var lpReported = {};
            graph.locRawRows.forEach(function (r) {
              var fr = str(r.LOCFR), to = str(r.LOCID);
              if (fr && !lpSet[fr] && !lpReported[fr]) {
                lpReported[fr] = true;
                addRow(1, ['Missing Location Product (Origin)', prdid, pd(prdid), fr, ld(fr), '', '',
                  'Transport arc ' + fr + ' → ' + to + ': origin has no Location Product record for this material', 'High']);
              }
              if (to && !lpSet[to] && !lpReported[to]) {
                lpReported[to] = true;
                addRow(1, ['Missing Location Product (Destination)', prdid, pd(prdid), to, ld(to), '', '',
                  'Transport arc ' + fr + ' → ' + to + ': destination has no Location Product record for this material', 'High']);
              }
            });
            lpRows = null; lpReported = null;
          }

          // V2 — Customer Source arcs vs Customer Product
          if (selCustProd) {
            var cpRows = await idbGetByIndex('sn_cust_prod', 'by_prdid', prdid);
            var cpSet = {};
            cpRows.forEach(function (r) { var k = str(r.CUSTID); if (k) cpSet[k] = true; });
            var cpReported = {};
            graph.custRawRows.forEach(function (r) {
              var cust = str(r.CUSTID);
              if (cust && !cpSet[cust] && !cpReported[cust]) {
                cpReported[cust] = true;
                addRow(1, ['Missing Customer Product', prdid, pd(prdid), str(r.LOCID), ld(str(r.LOCID)), cust, cd(cust),
                  'Customer Source arc exists but customer ' + cust + ' has no Customer Product record for this material', 'High']);
              }
            });
            cpRows = null; cpReported = null;
          }

          // Sheet 3 — Network Metrics (índice 2)
          addRow(2, [prdid, pd(prdid), metrics.plants, metrics.dcs, metrics.customers,
            metrics.paths, metrics.longestPath, metrics.ghosts, metrics.networkStatus]);
          if (metrics.networkStatus === 'Complete') completeCount++;
          totalPaths += metrics.paths || 0;

          // Sheet 4 — Network Resilience (índice 3)
          resData.forEach(function (r) {
            addRow(3, [prdid, pd(prdid), r.custid, cd(r.custid),
              r.pathCount, r.criticalNodes.join('; '), r.category, snResilienceDesc(r)]);
            r.criticalNodes.forEach(function (node) {
              if (!critNodeMap[node]) critNodeMap[node] = { products: {}, customers: {} };
              critNodeMap[node].products[prdid] = true;
              critNodeMap[node].customers[r.custid] = true;
            });
          });

          // Sheet 6 — Network Health Score (índice 5)
          addRow(5, [prdid, pd(prdid), health.score, health.category,
            metrics.plants, metrics.customers, metrics.paths, metrics.ghosts,
            metrics.criticalNodes, metrics.plants === 1 ? 'Yes' : 'No', health.comments]);
          healthSum += health.score || 0;

          // Liberar referencias para GC inmediato
          graph = null; paths = null; ghosts = null; deadEnds = null;
          cats = null; metrics = null; resData = null; health = null;
        }

        await new Promise(function (r) { setTimeout(r, 0); });
        var done = Math.min(i + CHUNK, n);
        if (onProgress) onProgress(50 + Math.round((done / n) * 40));
        if (onStatus) onStatus('Analizando ' + done + '/' + n + ' productos...');
        if (logEl && i > 0 && i % 500 === 0)
          log(logEl, 'info', timer.fmt() + ' Analizados ' + done + '/' + n + ' productos...');
      }

      // V3 / V3b — Purchased inputs (post-loop, requires PSI + Location)
      if (selSourceItem && Object.keys(SN_IDX.psiCompPrds).length > 0) {
        if (onStatus) onStatus('Analizando insumos comprados...');
        if (logEl) log(logEl, 'info', timer.fmt() + ' Analizando insumos comprados (V3/V3b)...');
        var purchasedPrds = Object.keys(SN_IDX.psiCompPrds).filter(function (p) { return !SN_IDX.pshPrds[p]; });
        for (var vi = 0; vi < purchasedPrds.length; vi++) {
          var compPrd = purchasedPrds[vi];
          var compSrcRows = await idbGetByIndex('sn_loc', 'by_prdid', compPrd);
          var supplierArcs = compSrcRows.filter(function (r) {
            var loc = SN_IDX.locLookup[str(r.LOCFR)] || {};
            return str(loc.LOCTYPE) === 'V';
          });
          if (supplierArcs.length === 0) {
            // V3 — purchased input with no supplier arc at all
            addRow(1, ['Purchased Input without Supplier', compPrd, pd(compPrd), '', '', '', '',
              'Component is consumed in production (PSI) with no production source (PSH) and no supplier arc (no Location Source from LOCTYPE=V)', 'High']);
          } else if (selLocProd) {
            // V3b — supplier arcs exist but supplier may lack Location Product
            var suppLpRows = await idbGetByIndex('sn_loc_prod', 'by_prdid', compPrd);
            var suppLpSet = {};
            suppLpRows.forEach(function (r) { var k = str(r.LOCID); if (k) suppLpSet[k] = true; });
            var suppReported = {};
            supplierArcs.forEach(function (arc) {
              var suppLoc = str(arc.LOCFR);
              if (!suppLpSet[suppLoc] && !suppReported[suppLoc]) {
                suppReported[suppLoc] = true;
                addRow(1, ['Supplier Missing Location Product', compPrd, pd(compPrd), suppLoc, ld(suppLoc), '', '',
                  'Supplier ' + suppLoc + ' has a supplier arc for component ' + compPrd + ' but no Location Product record', 'Medium']);
              }
            });
            suppLpRows = null; suppReported = null;
          }
          compSrcRows = null; supplierArcs = null;
          if (vi % 200 === 0 && vi > 0) await new Promise(function (r) { setTimeout(r, 0); });
        }
        if (logEl) log(logEl, 'ok', timer.fmt() + ' V3/V3b: ' + purchasedPrds.length + ' insumos comprados evaluados');
      }

      // Sheet 5 — Critical Nodes (después del loop, índice 4)
      var critCount = 0;
      Object.keys(critNodeMap).sort().forEach(function (loc) {
        var d = critNodeMap[loc];
        var pc = Object.keys(d.products).length;
        var cc = Object.keys(d.customers).length;
        addRow(4, [loc, ld(loc), pc, cc, 'Distribution Center',
          pc > 3 ? 'Critical' : pc > 1 ? 'High' : 'Medium',
          'Single point of failure for ' + pc + ' product(s) and ' + cc + ' customer(s)']);
        critCount++;
      });
      critNodeMap = null;

      // Aplicar anchos de columna calculados al vuelo
      DEFS.forEach(function (def) {
        def.ws.columns.forEach(function (col, ci) {
          col.width = Math.min(Math.max((def.colW[ci] || 10) + 2, 10), 60);
        });
      });

      // Generar buffer y descargar
      if (onProgress) onProgress(95);
      if (onStatus) onStatus('Generando archivo Excel...');
      var buf = await wb.xlsx.writeBuffer();
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'SupplyNetworkAnalysis_' + today + '.xlsx';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);

      return {
        totalProducts: n,
        completeProducts: completeCount,
        totalPaths: totalPaths,
        ghostNodes: ghostCount,
        criticalNodes: critCount,
        avgHealthScore: n > 0 ? Math.round(healthSum / n) : 0
      };
    }

    /* ── Graph construction ── */
    function snBuildLookup(arr, keyField) {
      var lkp = {};
      (arr || []).forEach(function (r) { var k = str(r[keyField]); if (k) lkp[k] = r; });
      return lkp;
    }

    async function snBuildProductGraph(prdid) {
      // Reads edge data from IDB (never held in JS heap during download)
      // Location edges
      var locRows = await idbGetByIndex('sn_loc', 'by_prdid', prdid);
      var locEdges = {}, locLeadTimes = {};
      locRows.forEach(function (r) {
        var fr = str(r.LOCFR), to = str(r.LOCID);
        if (!fr || !to) return;
        if (!locEdges[fr]) locEdges[fr] = [];
        if (locEdges[fr].indexOf(to) < 0) locEdges[fr].push(to);
        locLeadTimes[fr + '||' + to] = str(r.TLEADTIME || '');
      });

      // Customer edges
      var custRows = await idbGetByIndex('sn_cust', 'by_prdid', prdid);
      var custEdges = {}, custLeadTimes = {};
      custRows.forEach(function (r) {
        var fr = str(r.LOCID), to = str(r.CUSTID);
        if (!fr || !to) return;
        if (!custEdges[fr]) custEdges[fr] = [];
        if (custEdges[fr].indexOf(to) < 0) custEdges[fr].push(to);
        custLeadTimes[fr + '||' + to] = str(r.CLEADTIME || '');
      });

      // Plants
      var plantRows = await idbGetByIndex('sn_plant', 'by_prdid', prdid);
      var plantSet = {}, plants = [], plantLeadTimes = {};
      plantRows.forEach(function (r) {
        var l = str(r.LOCID);
        if (l && !plantSet[l]) { plantSet[l] = true; plants.push(l); }
        if (l) plantLeadTimes[l] = str(r.PLEADTIME || '');
      });

      // Build allLocations / allCustomers
      var allLocs = {}, allCusts = {};
      Object.keys(locEdges).forEach(function (fr) {
        allLocs[fr] = true;
        locEdges[fr].forEach(function (to) { allLocs[to] = true; });
      });
      Object.keys(custEdges).forEach(function (fr) {
        allLocs[fr] = true;
        custEdges[fr].forEach(function (cust) { allCusts[cust] = true; });
      });

      return {
        prdid: prdid, plants: plants, plantSet: plantSet,
        locEdges: locEdges, custEdges: custEdges,
        locLeadTimes: locLeadTimes, custLeadTimes: custLeadTimes, plantLeadTimes: plantLeadTimes,
        allLocations: Object.keys(allLocs), allCustomers: Object.keys(allCusts),
        locRawRows: locRows, custRawRows: custRows  // exposed for LP/CP validation
      };
    }

    /* ── Path enumeration (DFS with cycle guard) ── */
    function snFindAllPaths(graph) {
      var paths = [];
      var MAX_DEPTH = 12, MAX_PATHS = 2000;

      graph.plants.forEach(function (plant) {
        var stack = [[plant]];
        while (stack.length > 0 && paths.length < MAX_PATHS) {
          var cur = stack.pop();
          var last = cur[cur.length - 1];
          (graph.custEdges[last] || []).forEach(function (cust) {
            if (paths.length < MAX_PATHS)
              paths.push({ plant: plant, nodes: cur.slice(), customer: cust });
          });
          if (cur.length < MAX_DEPTH) {
            (graph.locEdges[last] || []).forEach(function (next) {
              if (cur.indexOf(next) < 0) stack.push(cur.concat([next]));
            });
          }
        }
      });
      return paths;
    }

    /* ── Network sets: forward (fed from plants) + backward (reaches customer) ── */
    function snComputeNetworkSets(graph) {
      // Forward: nodes reachable from any plant via locEdges
      var fedSet = {};
      graph.plants.forEach(function (p) { fedSet[p] = true; });
      var changed = true;
      while (changed) {
        changed = false;
        Object.keys(graph.locEdges).forEach(function (fr) {
          if (fedSet[fr]) {
            graph.locEdges[fr].forEach(function (to) {
              if (!fedSet[to]) { fedSet[to] = true; changed = true; }
            });
          }
        });
      }
      // Backward: nodes that can reach any customer
      var usefulSet = {};
      Object.keys(graph.custEdges).forEach(function (loc) {
        if (graph.custEdges[loc] && graph.custEdges[loc].length > 0) usefulSet[loc] = true;
      });
      changed = true;
      while (changed) {
        changed = false;
        Object.keys(graph.locEdges).forEach(function (fr) {
          if (!usefulSet[fr] && graph.locEdges[fr].some(function (to) { return usefulSet[to]; })) {
            usefulSet[fr] = true; changed = true;
          }
        });
      }
      return { fedSet: fedSet, usefulSet: usefulSet };
    }

    /* ── Ghost nodes: fed from plant + has outgoing edges + cannot reach any customer ── */
    function snFindGhostNodes(graph, sets) {
      var ghosts = [];
      graph.allLocations.forEach(function (loc) {
        if (graph.plantSet[loc]) return;   // plants handled separately
        if (!sets.fedSet[loc]) return;     // not fed from any plant
        if (sets.usefulSet[loc]) return;   // can reach a customer → not a ghost
        var hasOut = (graph.locEdges[loc] && graph.locEdges[loc].length > 0)
          || (graph.custEdges[loc] && graph.custEdges[loc].length > 0);
        if (hasOut) ghosts.push(loc);
      });
      return ghosts;
    }

    /* ── Dead-end locations: receive product but no outgoing flow at all ── */
    function snFindDeadEnds(graph) {
      var deadEnds = [];
      graph.allLocations.forEach(function (loc) {
        if (graph.plantSet[loc]) return;
        var isReceiver = Object.keys(graph.locEdges).some(function (from) {
          return graph.locEdges[from].indexOf(loc) >= 0;
        });
        if (!isReceiver) return;
        var hasOut = (graph.locEdges[loc] && graph.locEdges[loc].length > 0)
          || (graph.custEdges[loc] && graph.custEdges[loc].length > 0);
        if (!hasOut) deadEnds.push(loc);
      });
      return deadEnds;
    }

    /* ── Isolated plants: plants that cannot reach any customer ── */
    function snFindIsolatedPlants(graph, sets) {
      return graph.plants.filter(function (p) { return !sets.usefulSet[p]; });
    }

    /* ── Cycle detection via DFS ── */
    function snFindCycles(graph) {
      var cycles = [], visited = {}, inStack = {}, stackPath = [];
      var allNodes = graph.plants.concat(graph.allLocations);
      function dfs(node) {
        if (cycles.length >= 3) return;
        visited[node] = true; inStack[node] = true; stackPath.push(node);
        (graph.locEdges[node] || []).forEach(function (next) {
          if (cycles.length >= 3) return;
          if (!visited[next]) { dfs(next); }
          else if (inStack[next]) {
            var idx = stackPath.indexOf(next);
            if (idx >= 0) cycles.push(stackPath.slice(idx).concat([next]).join(' → '));
          }
        });
        stackPath.pop();
        inStack[node] = false;
      }
      allNodes.forEach(function (loc) { if (!visited[loc] && cycles.length < 3) dfs(loc); });
      return cycles;
    }

    /* ── Missing lead times: checks locLeadTimes, custLeadTimes, plantLeadTimes maps ── */
    function snFindMissingLeadTimes(graph) {
      var issues = [];
      Object.keys(graph.locLeadTimes || {}).forEach(function (key) {
        var lt = graph.locLeadTimes[key];
        if (!lt || lt === '0') {
          var p = key.split('||'); issues.push({ type: 'loc', from: p[0], to: p[1] });
        }
      });
      Object.keys(graph.custLeadTimes || {}).forEach(function (key) {
        var lt = graph.custLeadTimes[key];
        if (!lt || lt === '0') {
          var p = key.split('||'); issues.push({ type: 'cust', from: p[0], to: p[1] });
        }
      });
      Object.keys(graph.plantLeadTimes || {}).forEach(function (locid) {
        var lt = graph.plantLeadTimes[locid];
        if (!lt || lt === '0') issues.push({ type: 'plant', loc: locid });
      });
      return issues;
    }

    /* ── Quality category evaluation ── */
    function snEvaluateCategories(graph, paths) {
      var cats = [];
      var hasPlants = graph.plants.length > 0;
      var hasLoc = Object.keys(graph.locEdges).length > 0;
      var hasCust = Object.keys(graph.custEdges).length > 0;

      if (!hasPlants && hasCust) cats.push(5);
      if (hasPlants && !hasLoc && !hasCust) cats.push(1);
      if (hasPlants && hasLoc && !hasCust) cats.push(2);
      if (!hasPlants && hasLoc) cats.push(3);
      if (paths.length > 0) {
        if (paths.some(function (p) { return p.nodes.length === 1; })) cats.push(6);
        cats.push(7);
      }
      if (!cats.length) cats.push(hasPlants ? 1 : 3);
      return cats;
    }

    /* ── Network metrics ── */
    function snComputeMetrics(prdid, graph, paths, ghosts, deadEnds) {
      var dcSet = {};
      graph.allLocations.forEach(function (l) { if (!graph.plantSet[l]) dcSet[l] = true; });

      var longestPath = 0;
      paths.forEach(function (p) { if (p.nodes.length > longestPath) longestPath = p.nodes.length; });

      var nodeCount = {};
      paths.forEach(function (p) {
        p.nodes.forEach(function (n) {
          if (!graph.plantSet[n]) nodeCount[n] = (nodeCount[n] || 0) + 1;
        });
      });
      var threshold = paths.length > 0 ? paths.length * 0.5 : 1;
      var critCount = Object.keys(nodeCount).filter(function (n) { return nodeCount[n] >= threshold; }).length;

      var status = paths.length > 0 ? 'Complete'
        : graph.plants.length > 0 ? 'Incomplete' : 'No Production';

      return {
        prdid: prdid, plants: graph.plants.length, dcs: Object.keys(dcSet).length,
        customers: graph.allCustomers.length, paths: paths.length,
        longestPath: longestPath + 1, ghosts: ghosts.length, deadEnds: deadEnds.length,
        criticalNodes: critCount, networkStatus: status
      };
    }

    /* ── Resilience analysis per customer ── */
    function snAnalyzeResilience(prdid, graph, paths) {
      var custPaths = {};
      paths.forEach(function (p) {
        if (!custPaths[p.customer]) custPaths[p.customer] = [];
        custPaths[p.customer].push(p);
      });
      var result = [];
      Object.keys(custPaths).sort().forEach(function (custid) {
        var cps = custPaths[custid];
        var criticalNodes = [];
        if (cps.length > 0) {
          cps[0].nodes.filter(function (n) { return !graph.plantSet[n]; }).forEach(function (node) {
            if (cps.every(function (p) { return p.nodes.indexOf(node) >= 0; }))
              criticalNodes.push(node);
          });
        }
        var cat = cps.length === 1 ? 'Single Path'
          : criticalNodes.length > 0 ? 'Single Node Dependency' : 'Resilient';
        result.push({
          prdid: prdid, custid: custid, pathCount: cps.length,
          criticalNodes: criticalNodes, category: cat
        });
      });
      return result;
    }

    /* ── Health score (0-100) ── */
    function snComputeHealthScore(metrics, paths, ghosts, deadEnds) {
      var score = 0;
      if (paths.length > 0) score += 30;
      if (metrics.customers > 1) score += 10;
      if (metrics.paths > 1) score += 10;
      if (metrics.plants > 1) score += 10;
      if (ghosts.length > 0) score -= 20;
      if (deadEnds.length > 0) score -= 15;
      var custPC = {};
      paths.forEach(function (p) { custPC[p.customer] = (custPC[p.customer] || 0) + 1; });
      if (Object.keys(custPC).some(function (c) { return custPC[c] === 1; })) score -= 20;
      if (metrics.plants === 1) score -= 15;
      score = Math.max(0, Math.min(100, score));

      var cat = score >= 80 ? 'Healthy Network' : score >= 60 ? 'Acceptable Network'
        : score >= 40 ? 'Weak Network' : 'Critical Network';
      var cmts = [];
      if (paths.length === 0) cmts.push('No valid plant-to-customer paths');
      if (ghosts.length > 0) cmts.push(ghosts.length + ' ghost DC(s)');
      if (deadEnds.length > 0) cmts.push(deadEnds.length + ' dead-end location(s)');
      if (Object.keys(custPC).some(function (c) { return custPC[c] === 1; }))
        cmts.push('Single-path customers detected');
      if (metrics.plants === 1) cmts.push('Single production source');
      return { score: score, category: cat, comments: cmts.join('; ') };
    }

    /* ── Category / finding label helpers ── */
    function snCategoryLabel(cats) {
      var last = cats[cats.length - 1];
      return ({
        1: 'No Distribution From Plant', 2: 'Distribution Without Customer Delivery',
        3: 'Network Disconnected From Production', 4: 'Dead-End Locations',
        5: 'Customer Delivery Without Production', 6: 'Direct Plant Delivery',
        7: 'Complete Logistics Network'
      })[last] || 'Unknown';
    }

    function snCategoryDesc(cats, graph, paths, ghosts, deadEnds) {
      var parts = [];
      if (cats.indexOf(7) >= 0) parts.push('Valid paths from plant to customer exist');
      if (cats.indexOf(6) >= 0) parts.push('Direct plant-to-customer deliveries present');
      if (cats.indexOf(1) >= 0) parts.push('Plant exists but no distribution arcs found');
      if (cats.indexOf(2) >= 0) parts.push('Distribution exists but no customer endpoint');
      if (cats.indexOf(3) >= 0) parts.push('No production plant linked to this network');
      if (cats.indexOf(5) >= 0) parts.push('Customer deliveries exist without production source');
      if (ghosts.length) parts.push(ghosts.length + ' ghost DC(s): ' + ghosts.join(', '));
      if (deadEnds.length) parts.push(deadEnds.length + ' dead-end location(s): ' + deadEnds.join(', '));
      return parts.join('. ');
    }

    function snFindingType(cat) {
      return ({
        1: 'No Distribution From Plant', 2: 'Distribution Without Customer Delivery',
        3: 'Network Disconnected', 4: 'Dead-End Locations',
        5: 'Customer Without Production', 6: 'Direct Plant Delivery'
      })[cat] || 'Unknown';
    }

    function snFindingDesc(cat) {
      return ({
        1: 'Production plant exists but no outgoing distribution arcs are configured for this product',
        2: 'Distribution flows exist between locations but the product never reaches a customer',
        3: 'Distribution arcs exist but none originate from a production plant',
        4: 'Locations receive product but do not forward it to another location or customer',
        5: 'Customers receive product but no production plant source exists',
        6: 'Product is delivered directly from production plant to customer (no intermediate DC)'
      })[cat] || '';
    }

    function snFindingSeverity(cat) {
      return ({ 1: 'High', 2: 'High', 3: 'Critical', 4: 'Medium', 5: 'High', 6: 'Low' })[cat] || 'Medium';
    }

    function snResilienceDesc(r) {
      if (r.category === 'Resilient') return 'Multiple independent paths available';
      if (r.category === 'Single Path') return 'Only one delivery path — any disruption cuts supply';
      return 'All paths pass through critical node(s): ' + r.criticalNodes.join(', ');
    }



