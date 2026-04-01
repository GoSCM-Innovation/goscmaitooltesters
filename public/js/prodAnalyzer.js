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
        locSrc: document.getElementById('selPALocSrc').value,
        resLoc: document.getElementById('selPAResLoc').value
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
      var PA_PRD = {}, PA_LOC = {}, PA_RES = {}, PA_RES_LOC = {}; // PA_RES_LOC: RESID → [{ LOCID }]

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
            'LOCID,LOCDESCR,LOCTYPE',
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

        // Resource Location master (JS memory) — clave: RESID + LOCID
        if (ent.resLoc) {
          setStatusPA('Indexando Resource Location (lookup en memoria)...', 60);
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.resLoc);
          var nResLoc = await fetchAndIndex(baseOData + ent.resLoc, logEl, paFilter,
            'RESID,LOCID',
            function (rows) {
              rows.forEach(function (r) {
                var k = str(r.RESID); if (!k) return;
                if (!PA_RES_LOC[k]) PA_RES_LOC[k] = [];
                PA_RES_LOC[k].push({ LOCID: str(r.LOCID || '') });
              });
              return Promise.resolve();
            });
          log(logEl, 'ok', timer.fmt() + ' Resource Location: ' + nResLoc + ' reg');
        }
        progEl.style.width = '64%';

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
          ent, PA_PRD, PA_LOC, PA_RES, PA_RES_LOC,
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
       PA — ANÁLISIS + EXPORTACIÓN: 9 HOJAS POR ENTIDAD
       ═══════════════════════════════════════════════════════════════ */
    async function paAnalyzeAndExport(
      ent, PA_PRD, PA_LOC, PA_RES, PA_RES_LOC,
      pshBySid, pshPrdSet,
      timer, logEl, setStatusPA, progEl
    ) {
      function pd(id) { var p = PA_PRD[id] || {}; return str(p.PRDDESCR  || ''); }
      function pm(id) { var p = PA_PRD[id] || {}; return str(p.MATTYPEID || ''); }
      function lct(id){ var l = PA_LOC[id]  || {}; return str(l.LOCTYPE   || ''); }
      function yn(b)  { return b ? 'Sí' : 'No'; }

      /* ── PHASE A: leer todas las tablas IDB a memoria ───────────────── */
      setStatusPA('Cargando datos desde IndexedDB...', 75);
      var allLocProd = ent.locPrd ? (await idbGetAll('pa_loc_prod')) : [];
      var allLocSrc  = ent.locSrc ? (await idbGetAll('pa_loc_src'))  : [];
      var allPsi     = ent.psi    ? (await idbGetAll('pa_psi'))      : [];
      var allPsr     = ent.psr    ? (await idbGetAll('pa_psr'))      : [];
      log(logEl, 'ok', timer.fmt() + ' IDB cargado — LocProd:' + allLocProd.length +
        ' LocSrc:' + allLocSrc.length + ' PSI:' + allPsi.length + ' PSR:' + allPsr.length);

      /* ── PHASE B: construir índices cruzados ────────────────────────── */
      setStatusPA('Construyendo índices cruzados...', 77);

      // PSH → índices desde pshBySid (ya en memoria)
      var pshByPrdLoc  = {};   // "PRDID|LOCID" → [SOURCEID]  solo SOURCETYPE=P
      var pshSidLocid  = {};   // SOURCEID → { LOCID, PRDID } del registro P principal
      var pshSidHasP   = {};   // SOURCEID → bool
      var pshPrdSetP   = {};   // PRDID → true  (solo outputs SOURCETYPE=P)
      Object.keys(pshBySid).forEach(function(sid) {
        var recs = pshBySid[sid];
        var primary = recs.find(function(r){ return r.SOURCETYPE === 'P'; }) || recs[0];
        pshSidLocid[sid] = { LOCID: primary.LOCID, PRDID: primary.PRDID };
        pshSidHasP[sid]  = recs.some(function(r){ return r.SOURCETYPE === 'P'; });
        recs.forEach(function(r) {
          if (r.SOURCETYPE !== 'P' || !r.PRDID || !r.LOCID) return;
          var k = r.PRDID + '|' + r.LOCID;
          if (!pshByPrdLoc[k]) pshByPrdLoc[k] = [];
          pshByPrdLoc[k].push(sid);
          pshPrdSetP[r.PRDID] = true;
        });
      });

      // Location Product
      var locPrdSet    = new Set();   // "LOCID|PRDID"
      var locPrdPrdSet = new Set();   // todos los PRDID en LocProd
      allLocProd.forEach(function(r) {
        var loc = str(r.LOCID), prd = str(r.PRDID);
        if (loc && prd) { locPrdSet.add(loc + '|' + prd); locPrdPrdSet.add(prd); }
      });

      // Location Source
      var locSrcByPrdLoc   = {};         // "PRDID|LOCID(dest)" → [{LOCFR,TLEADTIME}]
      var locSrcByPrdLocfr = new Set();  // "PRDID|LOCFR(orig)"
      var locSrcPrdSet     = new Set();  // todos los PRDID en LocSrc
      allLocSrc.forEach(function(r) {
        var prd = str(r.PRDID), locfr = str(r.LOCFR || ''), locid = str(r.LOCID || ''), tlt = str(r.TLEADTIME || '');
        if (prd) locSrcPrdSet.add(prd);
        if (prd && locid) {
          var k = prd + '|' + locid;
          if (!locSrcByPrdLoc[k]) locSrcByPrdLoc[k] = [];
          locSrcByPrdLoc[k].push({ LOCFR: locfr, TLEADTIME: tlt });
        }
        if (prd && locfr) locSrcByPrdLocfr.add(prd + '|' + locfr);
      });

      // PSI
      var psiPrdSet     = new Set();  // todos los componentes PRDID en PSI
      var psiBySourceid = {};         // SOURCEID → [rows]
      allPsi.forEach(function(r) {
        var sid = str(r.SOURCEID), prd = str(r.PRDID || '');
        if (prd) psiPrdSet.add(prd);
        if (sid) { if (!psiBySourceid[sid]) psiBySourceid[sid] = []; psiBySourceid[sid].push(r); }
      });

      // PSR
      var psrResidSet   = new Set();   // todos los RESID en PSR
      var psrByResidLoc = new Set();   // "RESID|LOCID"
      var psrBySourceid = {};          // SOURCEID → [rows]
      allPsr.forEach(function(r) {
        var sid = str(r.SOURCEID), resid = str(r.RESID || '');
        if (resid) psrResidSet.add(resid);
        if (sid) {
          if (!psrBySourceid[sid]) psrBySourceid[sid] = [];
          psrBySourceid[sid].push(r);
          if (pshSidLocid[sid] && pshSidLocid[sid].LOCID && resid)
            psrByResidLoc.add(resid + '|' + pshSidLocid[sid].LOCID);
        }
      });

      // Resource Location
      var resLocSet      = new Set();   // "RESID|LOCID"
      var resLocResidSet = new Set();   // todos los RESID en ResLoc
      Object.keys(PA_RES_LOC).forEach(function(resid) {
        resLocResidSet.add(resid);
        PA_RES_LOC[resid].forEach(function(e) { if (e.LOCID) resLocSet.add(resid + '|' + e.LOCID); });
      });

      /* ── Workbook setup ─────────────────────────────────────────────── */
      setStatusPA('Inicializando workbook...', 79);
      var wb    = new ExcelJS.Workbook();
      var today = new Date().toISOString().slice(0, 10);
      var GOLD  = 'FFF7A800', ORANGE = 'FFE8622A', NAVY = 'FF0B1120';
      var C_RED = 'FFFFCCCC', C_YEL  = 'FFFFFFCC';

      function makeSheet(name, tabArgb, headers) {
        var ws = wb.addWorksheet(name, {
          views: [{ state: 'frozen', ySplit: 1 }],
          properties: { tabColor: { argb: tabArgb } }
        });
        ws.addRow(headers);
        ws.getRow(1).eachCell(function(cell) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
          cell.font = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.border = { bottom: { style: 'medium', color: { argb: ORANGE } } };
        });
        ws.getRow(1).height = 22;
        return { ws: ws, colW: headers.map(function(h) { return h.length; }) };
      }

      function addRow(s, data, fillArgb) {
        var row = s.ws.addRow(data);
        if (fillArgb) {
          row.eachCell({ includeEmpty: true }, function(cell) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
          });
        }
        data.forEach(function(v, ci) {
          var len = v != null ? String(v).length : 0;
          if (len > (s.colW[ci] || 0)) s.colW[ci] = len;
        });
      }

      function finalizeSheet(s) {
        s.ws.columns.forEach(function(col, ci) {
          col.width = Math.min(Math.max((s.colW[ci] || 10) + 2, 10), 60);
        });
      }

      // Stats por hoja para el Resumen
      var STATS = {};
      function initStat(name) { STATS[name] = { total: 0, red: 0, yel: 0, ok: 0 }; }
      function track(name, fill) {
        if (!STATS[name]) return;
        STATS[name].total++;
        if      (fill === C_RED) STATS[name].red++;
        else if (fill === C_YEL) STATS[name].yel++;
        else                     STATS[name].ok++;
      }

      // Hoja Resumen — se llena al final
      var S0 = makeSheet('Resumen', 'FF34D399',
        ['#', 'Hoja', 'Total registros', 'Alertas 🔴', 'Advertencias 🟡', 'OK ✅', '% Consistencia']);

      /* ── HOJA 1: PRODUCT ────────────────────────────────────────────── */
      if (ent.prd) {
        initStat('Product');
        var S1 = makeSheet('Product', 'FF29ABE2',
          ['PRDID', 'PRDDESCR', 'MATTYPEID',
           'En PSH (output)', 'En PSI (componente)',
           'En Location Product', 'En Location Source',
           'Observación']);
        Object.keys(PA_PRD).sort().forEach(function(prdid) {
          var inPSH = !!pshPrdSetP[prdid];
          var inPSI = psiPrdSet.has(prdid);
          var inLP  = locPrdPrdSet.has(prdid);
          var inLS  = locSrcPrdSet.has(prdid);
          var obs = [];
          if (!inLP)           obs.push('Sin cobertura logística (no está en Location Product)');
          if (!inPSH && !inLS) obs.push('Sin fuente de producción ni arco de abastecimiento');
          else if (!inPSH)     obs.push('Sin fuente de producción propia (no está en PSH)');
          if (!inPSH && inPSI) obs.push('Solo actúa como componente (PSI)');
          if (!obs.length)     obs.push('OK');
          var fill = (!inLP || (!inPSH && !inLS)) ? C_RED : (!inPSH || !inLS) ? C_YEL : null;
          addRow(S1, [prdid, pd(prdid), pm(prdid), yn(inPSH), yn(inPSI), yn(inLP), yn(inLS), obs.join(' | ')], fill);
          track('Product', fill);
        });
        finalizeSheet(S1);
        setStatusPA('Hoja Product lista...', 82);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 2: RESOURCE ───────────────────────────────────────────── */
      if (ent.res) {
        initStat('Resource');
        var S2 = makeSheet('Resource', 'FFa78bfa',
          ['RESID', 'RESDESCR',
           'En PSR', 'En Resource Location',
           'Observación']);
        Object.keys(PA_RES).sort().forEach(function(resid) {
          var inPSR = psrResidSet.has(resid);
          var inRL  = resLocResidSet.has(resid);
          var obs = [];
          if (!inPSR && !inRL) obs.push('Recurso huérfano: sin uso en producción ni planta asignada');
          else if (!inPSR)     obs.push('Sin uso en producción (no aparece en PSR)');
          else if (!inRL)      obs.push('Sin planta asignada en Resource Location');
          if (!obs.length)     obs.push('OK');
          var fill = (!inPSR && !inRL) ? C_RED : (!inPSR || !inRL) ? C_YEL : null;
          addRow(S2, [resid, str((PA_RES[resid] || {}).RESDESCR || ''), yn(inPSR), yn(inRL), obs.join(' | ')], fill);
          track('Resource', fill);
        });
        finalizeSheet(S2);
        setStatusPA('Hoja Resource lista...', 84);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 3: RESOURCE LOCATION ──────────────────────────────────── */
      if (ent.resLoc) {
        initStat('Resource Location');
        var S3 = makeSheet('Resource Location', 'FFFF9F43',
          ['RESID', 'LOCID',
           'RESID+LOCID usado en PSR',
           'Observación']);
        Object.keys(PA_RES_LOC).sort().forEach(function(resid) {
          PA_RES_LOC[resid].forEach(function(e) {
            var locid = e.LOCID;
            var used  = psrByResidLoc.has(resid + '|' + locid);
            var obs   = used ? 'OK' : 'Recurso asignado a planta pero no utilizado en PSR para esta planta';
            var fill  = used ? null : C_YEL;
            addRow(S3, [resid, locid, yn(used), obs], fill);
            track('Resource Location', fill);
          });
        });
        finalizeSheet(S3);
        setStatusPA('Hoja Resource Location lista...', 85);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 4: LOCATION PRODUCT ───────────────────────────────────── */
      if (ent.locPrd) {
        initStat('Location Product');
        var S4 = makeSheet('Location Product', 'FF10B981',
          ['LOCID', 'PRDID',
           'PRDID+LOCID en PSH',
           'PRDID+LOCID en Location Source (destino / origen / ambos / ninguno)',
           'Observación']);
        allLocProd.forEach(function(r) {
          var locid = str(r.LOCID), prdid = str(r.PRDID);
          if (!locid || !prdid) return;
          var inPSH    = !!pshByPrdLoc[prdid + '|' + locid];
          var inLSdest = locSrcByPrdLoc.hasOwnProperty(prdid + '|' + locid);
          var inLSorig = locSrcByPrdLocfr.has(prdid + '|' + locid);
          var lsVal = (inLSdest && inLSorig) ? 'Destino y Origen'
                    : inLSdest               ? 'Destino'
                    : inLSorig               ? 'Origen'
                    :                          'Ninguno';
          var obs = [];
          if (!inPSH && lsVal === 'Ninguno') obs.push('Sin fuente de producción ni arco de abastecimiento');
          else if (!inPSH)                   obs.push('Sin fuente de producción en esta planta');
          if (!obs.length)                   obs.push('OK');
          var fill = (!inPSH && lsVal === 'Ninguno') ? C_RED : !inPSH ? C_YEL : null;
          addRow(S4, [locid, prdid, yn(inPSH), lsVal, obs.join(' | ')], fill);
          track('Location Product', fill);
        });
        finalizeSheet(S4);
        setStatusPA('Hoja Location Product lista...', 87);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 5: LOCATION SOURCE ────────────────────────────────────── */
      if (ent.locSrc) {
        initStat('Location Source');
        var S5 = makeSheet('Location Source', 'FFE8622A',
          ['PRDID', 'LOCFR', 'LOCID', 'TLEADTIME',
           'LOCID+PRDID en Location Product',
           'LOCFR+PRDID en Location Product',
           'Observación']);
        allLocSrc.forEach(function(r) {
          var prd = str(r.PRDID), locfr = str(r.LOCFR || ''), locid = str(r.LOCID || ''), tlt = str(r.TLEADTIME || '');
          var destInLP  = locPrdSet.has(locid + '|' + prd);
          var origInLP  = locPrdSet.has(locfr + '|' + prd);
          var locfrType = lct(locfr);
          var noLt      = !tlt || tlt === '0';
          var obs = [];
          if (!destInLP)                              obs.push('Destino no habilitado en Location Product');
          if (!origInLP)                              obs.push('Origen no habilitado en Location Product');
          if (locfrType.toUpperCase() === 'V')        obs.push('Proveedor externo (LOCTYPE=V)');
          else if (locfrType)                         obs.push('Origen interno (LOCTYPE=' + locfrType + ')');
          if (noLt)                                   obs.push('Lead time no configurado');
          if (!obs.length)                            obs.push('OK');
          var fill = !destInLP ? C_RED : (noLt || !origInLP) ? C_YEL : null;
          addRow(S5, [prd, locfr, locid, tlt, yn(destInLP), yn(origInLP), obs.join(' | ')], fill);
          track('Location Source', fill);
        });
        finalizeSheet(S5);
        setStatusPA('Hoja Location Source lista...', 89);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 6: PRODUCTION SOURCE HEADER ──────────────────────────── */
      if (ent.psh) {
        initStat('Prod Source Header');
        var S6 = makeSheet('Prod Source Header', 'FFF7A800',
          ['SOURCEID', 'PRDID output', 'LOCID planta', 'SOURCETYPE(s)', 'PLEADTIME', 'OUTPUTCOEFFICIENT',
           'PRDID+LOCID en Location Product',
           'Tiene ítems PSI (BOM)',
           'Tiene recursos PSR',
           'Observación']);
        Object.keys(pshBySid).sort().forEach(function(sid) {
          var recs    = pshBySid[sid];
          var primary = recs.find(function(r){ return r.SOURCETYPE === 'P'; }) || recs[0];
          var outPrd  = primary.PRDID, outLoc = primary.LOCID;
          var plt     = primary.PLEADTIME || '', coeff = primary.OUTPUTCOEFFICIENT || '';
          var stypes  = recs.map(function(r){ return r.SOURCETYPE; })
                            .filter(function(v,i,a){ return a.indexOf(v) === i; }).join('/');
          var inLP    = locPrdSet.has(outLoc + '|' + outPrd);
          var hasPSI  = !!psiBySourceid[sid];
          var hasPSR  = !!psrBySourceid[sid];
          var noLt    = !plt || plt === '0';
          var hasP    = pshSidHasP[sid];
          var multi   = (pshByPrdLoc[outPrd + '|' + outLoc] || []).length > 1;
          var obs = [];
          if (!hasPSI) obs.push('BOM vacío: sin componentes en PSI');
          if (noLt)    obs.push('PLEADTIME = 0 o no definido');
          if (!inLP)   obs.push('PRDID+LOCID sin cobertura en Location Product');
          if (!hasP)   obs.push('Sin registro SOURCETYPE=P');
          if (multi)   obs.push('Múltiples fuentes (>1 SOURCEID) para mismo PRDID+LOCID — verificar cuotas');
          if (!obs.length) obs.push('OK');
          var fill = (!hasPSI || noLt || !inLP) ? C_RED : (!hasP || multi) ? C_YEL : null;
          addRow(S6, [sid, outPrd, outLoc, stypes, plt, coeff,
            yn(inLP), yn(hasPSI), yn(hasPSR), obs.join(' | ')], fill);
          track('Prod Source Header', fill);
        });
        finalizeSheet(S6);
        setStatusPA('Hoja Prod Source Header lista...', 91);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 7: PRODUCTION SOURCE ITEM ────────────────────────────── */
      if (ent.psi) {
        initStat('Prod Source Item');
        var S7 = makeSheet('Prod Source Item', 'FF06B6D4',
          ['SOURCEID', 'PRDID output', 'LOCID planta', 'PRDID componente', 'COMPONENTCOEFFICIENT',
           'Tipo componente',
           'PRDID comp+LOCID en Location Product',
           'En Location Source (insumo)',
           'LOCFR origen', 'LOCTYPE origen',
           'LOCFR+PRDID en Location Product',
           'Observación']);
        var PSI_CHUNK = 300;
        for (var pii = 0; pii < allPsi.length; pii += PSI_CHUNK) {
          allPsi.slice(pii, pii + PSI_CHUNK).forEach(function(r) {
            var sid    = str(r.SOURCEID);
            var comp   = str(r.PRDID || '');
            var coeff  = str(r.COMPONENTCOEFFICIENT || '');
            var info   = pshSidLocid[sid] || {};
            var locid  = info.LOCID || '';
            var outPrd = info.PRDID || '';
            var noSrc  = !locid;
            var isSemi = !!(locid && pshByPrdLoc[comp + '|' + locid]);
            var tipo   = noSrc ? 'No determinado' : isSemi ? 'Semielaborado' : 'Insumo';
            var compInLP = locid ? locPrdSet.has(locid + '|' + comp) : false;
            var noCoeff  = !coeff || Number(coeff) === 0;
            var lsRows   = (!isSemi && locid) ? (locSrcByPrdLoc[comp + '|' + locid] || []) : [];
            var inLS     = lsRows.length > 0;
            var locfrVal  = inLS ? lsRows.map(function(x){ return x.LOCFR; }).join(', ')
                          : isSemi ? 'N/A' : '';
            var locfrType = inLS ? lsRows.map(function(x){ return lct(x.LOCFR) || '?'; }).join(', ')
                          : isSemi ? 'N/A' : '';
            var locfrInLP = inLS ? yn(lsRows.some(function(x){ return locPrdSet.has(x.LOCFR + '|' + comp); }))
                          : isSemi ? 'N/A' : '';
            var obs = [];
            if (noSrc)    obs.push('SOURCEID no encontrado en PSH — planta no determinada');
            if (noCoeff)  obs.push('Coeficiente = 0 o no definido');
            if (isSemi)   obs.push('Semielaborado: trazabilidad disponible en PSH');
            if (!isSemi && !noSrc) {
              if (!inLS)  obs.push('Insumo sin arco de abastecimiento en Location Source');
              else {
                var allV     = lsRows.every(function(x){ return (lct(x.LOCFR)||'').toUpperCase() === 'V'; });
                var someNotV = lsRows.some(function(x){ return (lct(x.LOCFR)||'').toUpperCase() !== 'V'; });
                if (allV)     obs.push('Insumo con proveedor externo (LOCTYPE=V)');
                if (someNotV) obs.push('Insumo con origen de tipo no-V — revisar LOCTYPE');
              }
            }
            if (!compInLP && locid) obs.push('Componente no habilitado en Location Product para esta planta');
            if (!obs.length) obs.push('OK');
            var fill = (noCoeff || (!isSemi && !inLS && !noSrc) || (!compInLP && locid)) ? C_RED
                     : (noSrc || (!isSemi && inLS && lsRows.some(function(x){ return (lct(x.LOCFR)||'').toUpperCase() !== 'V'; }))) ? C_YEL
                     : null;
            addRow(S7, [sid, outPrd, locid, comp, coeff, tipo, yn(compInLP),
              !isSemi && !noSrc ? yn(inLS) : 'N/A',
              locfrVal, locfrType, locfrInLP, obs.join(' | ')], fill);
            track('Prod Source Item', fill);
          });
          await new Promise(function(r){ setTimeout(r, 0); });
          setStatusPA('Hoja Prod Source Item: ' + Math.min(pii + PSI_CHUNK, allPsi.length) + '/' + allPsi.length + '...',
            91 + Math.round((Math.min(pii + PSI_CHUNK, allPsi.length) / Math.max(allPsi.length, 1)) * 4));
        }
        finalizeSheet(S7);
        setStatusPA('Hoja Prod Source Item lista...', 95);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 8: PRODUCTION SOURCE RESOURCE ────────────────────────── */
      if (ent.psr) {
        initStat('Prod Source Resource');
        var S8 = makeSheet('Prod Source Resource', 'FF6C63FF',
          ['SOURCEID', 'PRDID output', 'LOCID planta', 'RESID',
           'RESID+LOCID en Resource Location',
           'Observación']);
        allPsr.forEach(function(r) {
          var sid    = str(r.SOURCEID);
          var resid  = str(r.RESID || '');
          var info   = pshSidLocid[sid] || {};
          var locid  = info.LOCID || '';
          var outPrd = info.PRDID || '';
          var inRL   = !!(locid && resid && resLocSet.has(resid + '|' + locid));
          var noSrc  = !locid;
          var obs    = noSrc ? 'SOURCEID no encontrado en PSH — planta no determinada'
                     : inRL  ? 'OK'
                     :         'Recurso utilizado en producción sin asignación en Resource Location para planta ' + locid;
          var fill   = noSrc ? C_YEL : inRL ? null : C_YEL;
          addRow(S8, [sid, outPrd, locid, resid, yn(inRL), obs], fill);
          track('Prod Source Resource', fill);
        });
        finalizeSheet(S8);
        setStatusPA('Hoja Prod Source Resource lista...', 97);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 0: RESUMEN (llenar ahora que tenemos todos los stats) ─── */
      setStatusPA('Generando Resumen...', 98);
      var sheetDefs = [
        { key: 'Product',              num: 1 },
        { key: 'Resource',             num: 2 },
        { key: 'Resource Location',    num: 3 },
        { key: 'Location Product',     num: 4 },
        { key: 'Location Source',      num: 5 },
        { key: 'Prod Source Header',   num: 6 },
        { key: 'Prod Source Item',     num: 7 },
        { key: 'Prod Source Resource', num: 8 }
      ];
      sheetDefs.forEach(function(d) {
        var s = STATS[d.key]; if (!s) return;
        var pct  = s.total > 0 ? Math.round((s.ok / s.total) * 100) : 100;
        var fill = s.red > 0 ? C_RED : s.yel > 0 ? C_YEL : null;
        addRow(S0, [d.num, d.key, s.total, s.red, s.yel, s.ok, pct + '%'], fill);
      });
      finalizeSheet(S0);

      /* ── EXPORT ─────────────────────────────────────────────────────── */
      setStatusPA('Generando archivo Excel...', 99);
      var buf  = await wb.xlsx.writeBuffer();
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href   = url;
      a.download = 'ProductionHierarchyAnalysis_' + today + '.xlsx';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }
