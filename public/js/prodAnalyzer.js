    /* ═══════════════════════════════════════════════════════════════
       PRODUCTION HIERARCHY ANALYZER
       Descarga 8 entidades → IDB/memoria → analiza 10 casos →
       exporta Excel con 4 hojas: Summary, Findings,
       Production Coverage, Purchased Inputs
       ═══════════════════════════════════════════════════════════════ */

    async function doProductionAnalysis() {
      var logEl   = document.getElementById('logPA');
      var progEl  = document.getElementById('progFillPA');
      logEl.innerHTML = '';
      logEl.classList.add('hidden');
      document.getElementById('progBarPA').classList.remove('hidden');
      document.getElementById('progStatusPA').style.cssText =
        'display:flex;font-size:12px;color:var(--text2);margin-top:4px;align-items:center;gap:8px;';
      document.getElementById('btnFetchPA').disabled = true;
      document.getElementById('paSuccessBanner').classList.add('hidden');
      var timer = createTimer();

      function setStatusPA(msg, pct) {
        var el = document.getElementById('progStatusTextPA');
        if (el) { el.style.color = ''; el.textContent = msg; }
        if (pct !== undefined) progEl.style.width = pct + '%';
      }

      // Read entity selectors
      var ent = {
        psh:    document.getElementById('selPAHeader').value,
        psi:    document.getElementById('selPAItem').value,
        psr:    document.getElementById('selPAResource').value,
        prd:    document.getElementById('selPAProduct').value,
        loc:    document.getElementById('selPALocMaster').value,
        res:    document.getElementById('selPAResMaster').value,
        locPrd: document.getElementById('selPALocProd').value,
        locSrc: document.getElementById('selPALocSrc').value
      };

      if (!ent.psh) {
        log(logEl, 'err', timer.fmt() + ' Configura al menos la entidad Production Source Header antes de analizar');
        document.getElementById('btnFetchPA').disabled = false;
        return;
      }

      var baseOData = CFG.url + '/sap/opu/odata/IBP/' + CFG.service + '/';
      var paFilter  = CFG.pa
        ? (CFG.pver
          ? "PlanningAreaID eq '" + CFG.pa + "' and VersionID eq '" + CFG.pver + "'"
          : "PlanningAreaID eq '" + CFG.pa + "'")
        : '';

      // In-memory lookup tables (small masters)
      var PA_PRD = {}, PA_LOC = {}, PA_RES = {};

      // PSH compact summary built during download (avoid re-reading IDB later)
      var pshBySid  = {};   // SOURCEID → [{ PRDID, LOCID, SOURCETYPE, PLEADTIME }]
      var pshPrdSet = {};   // all PSH output PRDIDs → true

      try {
        progEl.style.width = '0%';
        if (!IDB) IDB = await openDB();
        await Promise.all(['pa_psh', 'pa_psi', 'pa_psr', 'pa_loc_prod', 'pa_loc_src'].map(idbClear));

        /* ── PHASE 1: Download 8 entities (0 → 75%) ─────────────────── */

        // PSH — IDB + compact in-memory map
        setStatusPA('Descargando Production Source Header → IDB...', 2);
        log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.psh);
        var nPsh = await fetchAndIndex(baseOData + ent.psh, logEl, paFilter,
          'SOURCEID,PRDID,LOCID,SOURCETYPE,PLEADTIME,OUTPUTCOEFFICIENT',
          function (rows) {
            rows.forEach(function (r) {
              var sid = str(r.SOURCEID); if (!sid) return;
              if (!pshBySid[sid]) pshBySid[sid] = [];
              pshBySid[sid].push({
                PRDID: str(r.PRDID), LOCID: str(r.LOCID),
                SOURCETYPE: str(r.SOURCETYPE), PLEADTIME: str(r.PLEADTIME || '')
              });
              var p = str(r.PRDID); if (p) pshPrdSet[p] = true;
            });
            return idbBulkPut('pa_psh', rows);
          });
        log(logEl, 'ok', timer.fmt() + ' PSH: ' + nPsh + ' reg → IDB (' +
          Object.keys(pshBySid).length + ' SOURCEIDs únicos)');
        progEl.style.width = '12%';

        // PSI
        if (ent.psi) {
          setStatusPA('Descargando Production Source Item → IDB...', 12);
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.psi);
          var nPsi = await fetchAndIndex(baseOData + ent.psi, logEl, paFilter,
            'SOURCEID,PRDID,COMPONENTCOEFFICIENT',
            function (rows) { return idbBulkPut('pa_psi', rows); });
          log(logEl, 'ok', timer.fmt() + ' PSI: ' + nPsi + ' reg → IDB');
        }
        progEl.style.width = '22%';

        // PSR
        if (ent.psr) {
          setStatusPA('Descargando Production Source Resource → IDB...', 22);
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.psr);
          var nPsr = await fetchAndIndex(baseOData + ent.psr, logEl, paFilter,
            'SOURCEID,RESID',
            function (rows) { return idbBulkPut('pa_psr', rows); });
          log(logEl, 'ok', timer.fmt() + ' PSR: ' + nPsr + ' reg → IDB');
        }
        progEl.style.width = '32%';

        // Product master (JS memory)
        if (ent.prd) {
          setStatusPA('Indexando Product (lookup en memoria)...', 32);
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.prd);
          var nPrd = await fetchAndIndex(baseOData + ent.prd, logEl, paFilter,
            'PRDID,PRDDESCR,MATTYPEID',
            function (rows) {
              rows.forEach(function (r) { var k = str(r.PRDID); if (k) PA_PRD[k] = r; });
              return Promise.resolve();
            });
          log(logEl, 'ok', timer.fmt() + ' Product: ' + nPrd + ' reg');
        }
        progEl.style.width = '44%';

        // Location master (JS memory)
        if (ent.loc) {
          setStatusPA('Indexando Location (lookup en memoria)...', 44);
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.loc);
          var nLoc = await fetchAndIndex(baseOData + ent.loc, logEl, paFilter,
            'LOCID,LOCDESCR',
            function (rows) {
              rows.forEach(function (r) { var k = str(r.LOCID); if (k) PA_LOC[k] = r; });
              return Promise.resolve();
            });
          log(logEl, 'ok', timer.fmt() + ' Location: ' + nLoc + ' reg');
        }
        progEl.style.width = '54%';

        // Resource master (JS memory)
        if (ent.res) {
          setStatusPA('Indexando Resource (lookup en memoria)...', 54);
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.res);
          var nRes = await fetchAndIndex(baseOData + ent.res, logEl, paFilter,
            'RESID,RESDESCR',
            function (rows) {
              rows.forEach(function (r) { var k = str(r.RESID); if (k) PA_RES[k] = r; });
              return Promise.resolve();
            });
          log(logEl, 'ok', timer.fmt() + ' Resource: ' + nRes + ' reg');
        }
        progEl.style.width = '60%';

        // Location Product (IDB — tabla grande)
        if (ent.locPrd) {
          setStatusPA('Descargando Location Product → IDB...', 60);
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.locPrd);
          var nLp = await fetchAndIndex(baseOData + ent.locPrd, logEl, paFilter,
            'LOCID,PRDID',
            function (rows) { return idbBulkPut('pa_loc_prod', rows); });
          log(logEl, 'ok', timer.fmt() + ' Location Product: ' + nLp + ' reg → IDB');
        }
        progEl.style.width = '68%';

        // Location Source (IDB — tabla grande)
        if (ent.locSrc) {
          setStatusPA('Descargando Location Source → IDB...', 68);
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.locSrc);
          var nLs = await fetchAndIndex(baseOData + ent.locSrc, logEl, paFilter,
            'PRDID,LOCFR,LOCID,TLEADTIME',
            function (rows) { return idbBulkPut('pa_loc_src', rows); });
          log(logEl, 'ok', timer.fmt() + ' Location Source: ' + nLs + ' reg → IDB');
        }
        progEl.style.width = '75%';

        var totalSids = Object.keys(pshBySid).length;
        log(logEl, 'ok', timer.fmt() + ' Descarga completa. ' + totalSids +
          ' SOURCEIDs. Iniciando análisis...');
        setStatusPA('Analizando ' + totalSids + ' fuentes de producción...', 75);

        /* ── PHASE 2: Analyze + Export (75 → 100%) ───────────────────── */
        await paAnalyzeAndExport(
          ent, PA_PRD, PA_LOC, PA_RES,
          pshBySid, pshPrdSet,
          timer, logEl, setStatusPA, progEl
        );

        progEl.style.width = '100%';
        log(logEl, 'ok', timer.fmt() + ' ¡Excel descargado! Análisis completado en ' + timer.ms() + 'ms.');
        setStatusPA('✓ Completado · ' + timer.ms() + 'ms', 100);
        document.getElementById('paSuccessBanner').classList.remove('hidden');

      } catch (e) {
        log(logEl, 'err', timer.fmt() + ' Error: ' + e.message);
        var errEl = document.getElementById('progStatusTextPA');
        if (errEl) { errEl.style.color = 'var(--red)'; errEl.textContent = 'Error: ' + e.message; }
      }
      document.getElementById('btnFetchPA').disabled = false;
    }

    function togglePALogs() {
      var logEl = document.getElementById('logPA');
      var btn   = document.getElementById('btnTogglePALogs');
      var hidden = logEl.classList.toggle('hidden');
      btn.textContent = hidden ? 'Ver logs técnicos' : 'Ocultar logs';
    }

    /* ═══════════════════════════════════════════════════════════════
       PA — ANÁLISIS + EXPORTACIÓN STREAMING A EXCEL
       ═══════════════════════════════════════════════════════════════ */
    async function paAnalyzeAndExport(
      ent, PA_PRD, PA_LOC, PA_RES,
      pshBySid, pshPrdSet,
      timer, logEl, setStatusPA, progEl
    ) {
      function pd(id) { var p = PA_PRD[id] || {}; return str(p.PRDDESCR  || ''); }
      function pm(id) { var p = PA_PRD[id] || {}; return str(p.MATTYPEID || ''); }
      function ld(id) { var l = PA_LOC[id] || {}; return str(l.LOCDESCR  || ''); }

      /* ── Workbook setup ─────────────────────────────────────────── */
      var wb    = new ExcelJS.Workbook();
      var today = new Date().toISOString().slice(0, 10);
      var GOLD  = 'FFF7A800', ORANGE = 'FFE8622A', NAVY = 'FF0B1120';

      function makeSheet(name, tabArgb, headers) {
        var ws = wb.addWorksheet(name, {
          views: [{ state: 'frozen', ySplit: 1 }],
          properties: { tabColor: { argb: tabArgb } }
        });
        ws.addRow(headers);
        ws.getRow(1).eachCell(function (cell) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
          cell.font = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.border = { bottom: { style: 'medium', color: { argb: ORANGE } } };
        });
        ws.getRow(1).height = 20;
        return { ws: ws, colW: headers.map(function (h) { return h.length; }) };
      }

      function addRow(s, rowData) {
        s.ws.addRow(rowData);
        rowData.forEach(function (v, ci) {
          var len = v != null ? String(v).length : 0;
          if (len > s.colW[ci]) s.colW[ci] = len;
        });
      }

      function finalizeSheet(s) {
        s.ws.columns.forEach(function (col, ci) {
          col.width = Math.min(Math.max((s.colW[ci] || 10) + 2, 10), 60);
        });
      }

      var S0 = makeSheet('Summary',             'FFF7A800',
        ['Indicador', 'Valor', 'Descripción']);
      var S1 = makeSheet('Findings',            'FFFF6B6B',
        ['Caso', 'SOURCEID', 'Producto (Output)', 'Descripción Producto',
         'Planta', 'Descripción Planta',
         'Componente / Recurso', 'Descripción Comp/Res',
         'Severidad', 'Detalle']);
      var S2 = makeSheet('Production Coverage', 'FF29ABE2',
        ['Producto', 'Descripción', 'Tipo Material',
         'Tiene PSH', 'Cantidad PSH', 'Plantas', 'SOURCEIDs']);
      var S3 = makeSheet('Purchased Inputs',    'FFE8622A',
        ['Componente', 'Descripción', 'Tipo Material',
         'Usado en Productos', 'Usado en Plantas',
         'Arcos de Proveedor', 'Lead Times']);

      /* ── Counters ─────────────────────────────────────────────────── */
      var counts = { A: 0, B: 0, C: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0 };
      var findingCount = 0;
      var psiCompUsage = {};   // compId → { prds: {}, locs: {} }

      // Track all products/locations/resources used in composite entities
      var usedPrds = {};  // products seen in PSH, PSI, LocProd, LocSrc
      var usedLocs = {};  // locations seen in PSH, LocProd, LocSrc
      var usedRes  = {};  // resources seen in PSR
      // Per-entity tracking for orphan breakdown
      var inPSH = {}, inPSI = {}, inLocProd = {}, inLocSrc = {};
      var inLocPSH = {}, inLocLocProd = {}, inLocLocSrc = {};
      var inResPSR = {};

      /* ── Main loop: one iteration per SOURCEID ────────────────────── */
      var sourceIds = Object.keys(pshBySid).sort();
      var n = sourceIds.length;
      var CHUNK = 100;

      for (var i = 0; i < n; i += CHUNK) {
        var batch = sourceIds.slice(i, Math.min(i + CHUNK, n));

        for (var bi = 0; bi < batch.length; bi++) {
          var sid   = batch[bi];
          var recs  = pshBySid[sid];

          // Primary record (SOURCETYPE='P') or fallback to first
          var primary = recs.find(function (r) { return r.SOURCETYPE === 'P'; }) || recs[0];
          var outPrd  = primary.PRDID;
          var outLoc  = primary.LOCID;
          var plt     = primary.PLEADTIME;

          // Track usage from PSH
          if (outPrd) { usedPrds[outPrd] = true; inPSH[outPrd] = true; }
          if (outLoc) { usedLocs[outLoc] = true; inLocPSH[outLoc] = true; }
          recs.forEach(function (r) {
            if (r.PRDID) { usedPrds[r.PRDID] = true; inPSH[r.PRDID] = true; }
            if (r.LOCID) { usedLocs[r.LOCID] = true; inLocPSH[r.LOCID] = true; }
          });

          /* Case C🔴 — PLEADTIME ausente o cero */
          if (!plt || plt === '0') {
            counts.C++; findingCount++;
            addRow(S1, ['C', sid, outPrd, pd(outPrd), outLoc, ld(outLoc), '', '',
              'High', 'PLEADTIME no definido o cero en la fuente de producción primaria']);
          }

          /* Case K ℹ️ — co-productos sin registro primario */
          var hasPrimary = recs.some(function (r) { return r.SOURCETYPE === 'P'; });
          var hasCoProd  = recs.some(function (r) { return r.SOURCETYPE === 'C'; });
          if (hasCoProd && !hasPrimary) {
            counts.K++; findingCount++;
            addRow(S1, ['K', sid, outPrd, pd(outPrd), outLoc, ld(outLoc), '', '',
              'Info',
              'SOURCEID tiene co-productos (SOURCETYPE=C) pero ningún registro primario (SOURCETYPE=P)']);
          }

          /* Cases A🔴, B🔴, J ℹ️ — requieren PSI */
          if (ent.psi) {
            var psiRecs = await idbGetByIndex('pa_psi', 'by_sourceid', sid);

            if (!psiRecs.length) {
              /* Case A🔴 — BOM vacío */
              counts.A++; findingCount++;
              addRow(S1, ['A', sid, outPrd, pd(outPrd), outLoc, ld(outLoc), '', '',
                'High', 'Fuente de producción sin ningún componente PSI (BOM vacío)']);
            } else {
              psiRecs.forEach(function (pi) {
                var compId = str(pi.PRDID  || '');
                var coeff  = str(pi.COMPONENTCOEFFICIENT || '');

                // Track usage from PSI
                if (compId) { usedPrds[compId] = true; inPSI[compId] = true; }

                /* Case B🔴 — coeficiente cero o nulo */
                if (coeff === '' || Number(coeff) === 0) {
                  counts.B++; findingCount++;
                  addRow(S1, ['B', sid, outPrd, pd(outPrd), outLoc, ld(outLoc),
                    compId, pd(compId), 'High',
                    'Componente con coeficiente de consumo = 0 o no definido']);
                }

                /* Case J ℹ️ — componente también es output de otra fuente (semi-elaborado) */
                if (compId && pshPrdSet[compId]) {
                  counts.J++;
                  addRow(S1, ['J', sid, outPrd, pd(outPrd), outLoc, ld(outLoc),
                    compId, pd(compId), 'Info',
                    'Componente también aparece como salida de otra fuente de producción (semi-elaborado)']);
                }

                /* Acumular uso para hoja Purchased Inputs */
                if (compId) {
                  if (!psiCompUsage[compId]) psiCompUsage[compId] = { prds: {}, locs: {} };
                  psiCompUsage[compId].prds[outPrd] = true;
                  psiCompUsage[compId].locs[outLoc] = true;
                }
              });
            }
          }

          /* Track usage from PSR */
          if (ent.psr) {
            var psrRecs = await idbGetByIndex('pa_psr', 'by_sourceid', sid);
            psrRecs.forEach(function (pr) {
              var resId = str(pr.RESID || '');
              if (resId) { usedRes[resId] = true; inResPSR[resId] = true; }
            });
          }
        }

        await new Promise(function (r) { setTimeout(r, 0); });
        var done = Math.min(i + CHUNK, n);
        setStatusPA('Analizando ' + done + '/' + n + ' fuentes...', 75 + Math.round((done / n) * 10));
        if (logEl && i > 0 && i % 1000 === 0)
          log(logEl, 'info', timer.fmt() + ' Analizados ' + done + '/' + n + ' SOURCEIDs...');
      }

      /* ── Track usage from Location Product & Location Source (IDB) ── */
      setStatusPA('Indexando uso en Location Product y Location Source...', 86);
      if (ent.locPrd) {
        var lpCursor = await idbGetAll('pa_loc_prod');
        lpCursor.forEach(function (r) {
          var p = str(r.PRDID || ''); if (p) { usedPrds[p] = true; inLocProd[p] = true; }
          var l = str(r.LOCID || ''); if (l) { usedLocs[l] = true; inLocLocProd[l] = true; }
        });
      }
      if (ent.locSrc) {
        var lsCursor = await idbGetAll('pa_loc_src');
        lsCursor.forEach(function (r) {
          var p = str(r.PRDID || ''); if (p) { usedPrds[p] = true; inLocSrc[p] = true; }
          var lf = str(r.LOCFR || ''); if (lf) { usedLocs[lf] = true; inLocLocSrc[lf] = true; }
          var lt = str(r.LOCID || ''); if (lt) { usedLocs[lt] = true; inLocLocSrc[lt] = true; }
        });
      }

      /* ── Cases M, N, O — Orphan master data (post-loop) ─────────── */
      setStatusPA('Detectando datos maestros huérfanos...', 88);

      /* Case M🟡 — Producto en maestro simple sin uso en ningún dato compuesto */
      if (ent.prd) {
        Object.keys(PA_PRD).sort().forEach(function (prdid) {
          if (!usedPrds[prdid]) {
            counts.M++; findingCount++;
            addRow(S1, ['M', '', prdid, pd(prdid), '', '', '', '',
              'Medium', 'Producto existe en maestro de productos pero no aparece en ninguna entidad compuesta (PSH, PSI, Location Product, Location Source)']);
          } else {
            // Per-entity breakdown: report if missing from any specific entity
            var missing = [];
            if (ent.psh  && !inPSH[prdid])     missing.push('PSH');
            if (ent.psi  && !inPSI[prdid])     missing.push('PSI');
            if (ent.locPrd && !inLocProd[prdid]) missing.push('Location Product');
            if (ent.locSrc && !inLocSrc[prdid]) missing.push('Location Source');
            if (missing.length > 0 && missing.length < 4) {
              var present = [];
              if (ent.psh  && inPSH[prdid])      present.push('PSH');
              if (ent.psi  && inPSI[prdid])      present.push('PSI');
              if (ent.locPrd && inLocProd[prdid]) present.push('Location Product');
              if (ent.locSrc && inLocSrc[prdid]) present.push('Location Source');
              findingCount++;
              addRow(S1, ['M', '', prdid, pd(prdid), '', '', '', '',
                'Info', 'Producto aparece en: ' + (present.join(', ') || 'ninguna') + ' — NO aparece en: ' + missing.join(', ')]);
            }
          }
        });
      }

      /* Case N🟡 — Ubicación en maestro simple sin uso en ningún dato compuesto */
      if (ent.loc) {
        Object.keys(PA_LOC).sort().forEach(function (locid) {
          if (!usedLocs[locid]) {
            counts.N++; findingCount++;
            addRow(S1, ['N', '', '', '', locid, ld(locid), '', '',
              'Medium', 'Ubicación existe en maestro de ubicaciones pero no aparece en ninguna entidad compuesta (PSH, Location Product, Location Source)']);
          } else {
            var missing = [];
            if (ent.psh    && !inLocPSH[locid])    missing.push('PSH');
            if (ent.locPrd && !inLocLocProd[locid]) missing.push('Location Product');
            if (ent.locSrc && !inLocLocSrc[locid]) missing.push('Location Source');
            if (missing.length > 0 && missing.length < 3) {
              var present = [];
              if (ent.psh    && inLocPSH[locid])    present.push('PSH');
              if (ent.locPrd && inLocLocProd[locid]) present.push('Location Product');
              if (ent.locSrc && inLocLocSrc[locid]) present.push('Location Source');
              findingCount++;
              addRow(S1, ['N', '', '', '', locid, ld(locid), '', '',
                'Info', 'Ubicación aparece en: ' + (present.join(', ') || 'ninguna') + ' — NO aparece en: ' + missing.join(', ')]);
            }
          }
        });
      }

      /* Case O🟡 — Recurso en maestro simple sin uso en ningún dato compuesto */
      if (ent.res) {
        var rd = function (id) { var r = PA_RES[id] || {}; return str(r.RESDESCR || ''); };
        Object.keys(PA_RES).sort().forEach(function (resid) {
          if (!usedRes[resid]) {
            counts.O++; findingCount++;
            addRow(S1, ['O', '', '', '', '', '', resid, rd(resid),
              'Medium', 'Recurso existe en maestro de recursos pero no aparece en ninguna fuente de producción (PSR)']);
          } else if (ent.psr && !inResPSR[resid]) {
            // Resource used somewhere but not tracked via PSR directly (edge case info)
            findingCount++;
            addRow(S1, ['O', '', '', '', '', '', resid, rd(resid),
              'Info', 'Recurso aparece en maestro pero no está asignado a ningún SOURCEID en PSR']);
          }
        });
      }

      /* ── Case L ℹ️ + Production Coverage (post-loop) ─────────────── */
      setStatusPA('Generando Production Coverage...', 91);

      // Build product → PSH list from pshBySid
      var prdToPsh = {};
      Object.keys(pshBySid).forEach(function (sid) {
        pshBySid[sid].forEach(function (r) {
          if (r.SOURCETYPE !== 'P' || !r.PRDID) return;
          if (!prdToPsh[r.PRDID]) prdToPsh[r.PRDID] = [];
          prdToPsh[r.PRDID].push({ sid: sid, loc: r.LOCID });
        });
      });

      // All products: from master (if loaded) or from PSH outputs
      var allPrdIds = Object.keys(PA_PRD).length > 0
        ? Object.keys(PA_PRD).sort()
        : Object.keys(pshPrdSet).sort();

      allPrdIds.forEach(function (prdid) {
        var recs   = prdToPsh[prdid] || [];
        var hasRec = recs.length > 0;
        var plants = recs.map(function (r) { return r.loc; }).filter(Boolean).join(', ');
        var sids   = recs.map(function (r) { return r.sid; }).filter(Boolean).join(', ');

        /* Case L ℹ️ — producto en maestro sin PSH */
        if (!hasRec && ent.prd) {
          counts.L++;
          addRow(S1, ['L', '', prdid, pd(prdid), '', '', '', '', 'Info',
            'Producto en maestro de productos sin ninguna fuente de producción (PSH) configurada']);
        }

        addRow(S2, [prdid, pd(prdid), pm(prdid),
          hasRec ? 'Sí' : 'No', recs.length, plants, sids]);
      });

      /* ── Purchased Inputs (post-loop) ─────────────────────────────── */
      setStatusPA('Generando Purchased Inputs...', 94);
      var purchasedComps = Object.keys(psiCompUsage)
        .filter(function (c) { return !pshPrdSet[c]; })
        .sort();

      for (var pi = 0; pi < purchasedComps.length; pi++) {
        var compId  = purchasedComps[pi];
        var usage   = psiCompUsage[compId];
        var prdsStr = Object.keys(usage.prds).sort().join(', ');
        var locsStr = Object.keys(usage.locs).sort().join(', ');

        var suppArcs = [], ltList = [];
        if (ent.locSrc) {
          var srcRows = await idbGetByIndex('pa_loc_src', 'by_prdid', compId);
          srcRows.forEach(function (r) {
            var supp = str(r.LOCFR); if (!supp) return;
            suppArcs.push(supp + ' → ' + str(r.LOCID || ''));
            var lt = str(r.TLEADTIME || '');
            if (lt) ltList.push(supp + ':' + lt);
          });
        }

        addRow(S3, [
          compId, pd(compId), pm(compId),
          prdsStr, locsStr,
          suppArcs.join(' | ') || 'Sin arco de proveedor',
          ltList.join(' | ')   || ''
        ]);
      }

      /* ── Summary sheet ────────────────────────────────────────────── */
      var caseInfo = [
        ['A', '🔴 Alto',  'PSH con BOM vacío (sin componentes PSI)'],
        ['B', '🔴 Alto',  'PSI con coeficiente de consumo = 0 o no definido'],
        ['C', '🔴 Alto',  'PSH sin PLEADTIME o con valor cero'],
        ['M', '🟡 Medio', 'Producto en maestro sin uso en ninguna entidad compuesta'],
        ['N', '🟡 Medio', 'Ubicación en maestro sin uso en ninguna entidad compuesta'],
        ['O', '🟡 Medio', 'Recurso en maestro sin uso en ninguna entidad compuesta (PSR)'],
        ['J', 'ℹ️ Info',  'Componente que también es output de otra fuente (semi-elaborado)'],
        ['K', 'ℹ️ Info',  'SOURCEID con co-productos pero sin registro primario (SOURCETYPE=P)'],
        ['L', 'ℹ️ Info',  'Producto en maestro sin fuente de producción configurada']
      ];

      addRow(S0, ['Fecha análisis',               today,                 '']);
      addRow(S0, ['Total SOURCEIDs analizados',    n,                    'Fuentes de producción únicas (PSH)']);
      addRow(S0, ['Productos en cobertura',        allPrdIds.length,     'Productos evaluados en Production Coverage']);
      addRow(S0, ['Insumos comprados detectados',  purchasedComps.length,'Componentes PSI sin fuente de producción propia']);
      addRow(S0, ['Total hallazgos',               findingCount,         'Suma de todos los hallazgos encontrados']);
      addRow(S0, ['', '', '']);
      caseInfo.forEach(function (c) {
        addRow(S0, ['Caso ' + c[0] + ' — ' + c[1], counts[c[0]], c[2]]);
      });

      // Finalizar anchos de columna
      [S0, S1, S2, S3].forEach(finalizeSheet);

      // Generar y descargar
      setStatusPA('Generando archivo Excel...', 97);
      var buf  = await wb.xlsx.writeBuffer();
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href   = url;
      a.download = 'ProductionHierarchyAnalysis_' + today + '.xlsx';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }
