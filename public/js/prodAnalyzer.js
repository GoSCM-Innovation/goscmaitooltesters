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
        psiSub: document.getElementById('selPAItemSub').value,
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
        await Promise.all(['pa_psh', 'pa_psi', 'pa_psisub', 'pa_psr', 'pa_loc_prod', 'pa_loc_src'].map(idbClear));

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
                SOURCETYPE: str(r.SOURCETYPE),
                PLEADTIME: r.PLEADTIME != null ? str(r.PLEADTIME) : '',
                OUTPUTCOEFFICIENT: r.OUTPUTCOEFFICIENT != null ? str(r.OUTPUTCOEFFICIENT) : ''
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
            'SOURCEID,PRDID,COMPONENTCOEFFICIENT,ISALTITEM',
            function (rows) { return idbBulkPut('pa_psi', rows); });
          log(logEl, 'ok', timer.fmt() + ' PSI: ' + nPsi + ' reg → IDB');
        }
        progEl.style.width = '18%';

        // PSI Sub
        if (ent.psiSub) {
          setStatusPA('Descargando Production Source Item Sub → IDB...', 18);
          log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.psiSub);
          var nPsiSub = await fetchAndIndex(baseOData + ent.psiSub, logEl, paFilter,
            'SOURCEID,PRDFR,SPRDFR',
            function (rows) { return idbBulkPut('pa_psisub', rows); });
          log(logEl, 'ok', timer.fmt() + ' PSI Sub: ' + nPsiSub + ' reg → IDB');
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
        var modeEl     = document.querySelector('input[name="paExportMode"]:checked');
        var exportMode = modeEl ? modeEl.value : 'light';
        await paAnalyzeAndExport(
          ent, PA_PRD, PA_LOC, PA_RES, PA_RES_LOC,
          pshBySid, pshPrdSet,
          timer, logEl, setStatusPA, progEl, exportMode
        );

        progEl.style.width = '100%';
        var modeLabel = exportMode === 'light' ? 'ZIP (7 CSVs)' : 'Excel (7 hojas)';
        log(logEl, 'ok', timer.fmt() + ' ¡' + modeLabel + ' descargado! Análisis completado en ' + timer.ms() + 'ms.');
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

    function paConfirmMapping() {
      var body = document.getElementById('bodyPAMDT');
      var arr  = document.getElementById('arrPAMDT');
      if (body && !body.classList.contains('hidden')) {
        body.classList.add('hidden');
        if (arr) arr.textContent = '▶';
      }
      var panel = document.getElementById('panelPAExportMode');
      if (panel) {
        panel.classList.remove('hidden');
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function paBackToMapping() {
      var panel = document.getElementById('panelPAExportMode');
      if (panel) panel.classList.add('hidden');
      var body = document.getElementById('bodyPAMDT');
      var arr  = document.getElementById('arrPAMDT');
      if (body) {
        body.classList.remove('hidden');
        if (arr) arr.textContent = '▼';
        document.getElementById('panelPAMDT').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function paModeChange() {
      var light = document.getElementById('modeLightPA').checked;
      var cardL = document.getElementById('cardLightPA');
      var cardH = document.getElementById('cardHeavyPA');
      if (cardL) cardL.style.borderColor = light ? 'var(--accent)' : 'var(--border,#1e2d45)';
      if (cardH) cardH.style.borderColor = light ? 'var(--border,#1e2d45)' : 'var(--cyan)';
    }

    /* ═══════════════════════════════════════════════════════════════
       PA — ANÁLISIS + EXPORTACIÓN: 9 HOJAS POR ENTIDAD
       ═══════════════════════════════════════════════════════════════ */
    async function paAnalyzeAndExport(
      ent, PA_PRD, PA_LOC, PA_RES, PA_RES_LOC,
      pshBySid, pshPrdSet,
      timer, logEl, setStatusPA, progEl, mode
    ) {
      var isCSV = (mode === 'light');
      function pd(id) { var p = PA_PRD[id] || {}; return str(p.PRDDESCR  || ''); }
      function pm(id) { var p = PA_PRD[id] || {}; return str(p.MATTYPEID || ''); }
      function lct(id){ var l = PA_LOC[id]  || {}; return str(l.LOCTYPE   || ''); }
      function yn(b)  { return b ? (isCSV ? 'Si' : 'Si') : 'No'; }

      /* ── PHASE A: leer todas las tablas IDB a memoria ───────────────── */
      setStatusPA('Cargando datos desde IndexedDB...', 75);
      var allLocProd = ent.locPrd  ? (await idbGetAll('pa_loc_prod'))  : [];
      var allLocSrc  = ent.locSrc  ? (await idbGetAll('pa_loc_src'))   : [];
      var allPsi     = ent.psi     ? (await idbGetAll('pa_psi'))       : [];
      var allPsiSub  = ent.psiSub  ? (await idbGetAll('pa_psisub'))    : [];
      var allPsr     = ent.psr     ? (await idbGetAll('pa_psr'))       : [];
      log(logEl, 'ok', timer.fmt() + ' IDB cargado — LocProd:' + allLocProd.length +
        ' LocSrc:' + allLocSrc.length + ' PSI:' + allPsi.length +
        ' PSISub:' + allPsiSub.length + ' PSR:' + allPsr.length);

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

      // PSI Sub — índice SPRDFR → [PRDFR] para lookup de materiales reemplazados
      var psiSubBySprdfr = {};  // SPRDFR → [PRDFR] (qué materiales reemplaza)
      allPsiSub.forEach(function(r) {
        var sprdfr = str(r.SPRDFR || ''), prdfr = str(r.PRDFR || '');
        if (sprdfr && prdfr) {
          if (!psiSubBySprdfr[sprdfr]) psiSubBySprdfr[sprdfr] = [];
          if (psiSubBySprdfr[sprdfr].indexOf(prdfr) < 0) psiSubBySprdfr[sprdfr].push(prdfr);
        }
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

      /* ── Workbook / CSV setup ───────────────────────────────────────── */
      setStatusPA('Inicializando exportacion...', 79);
      var today = new Date().toISOString().slice(0, 10);
      var GOLD  = 'FFF7A800', ORANGE = 'FFE8622A', NAVY = 'FF0B1120';
      var C_RED = 'FFFFCCCC', C_YEL  = 'FFFFFFCC';
      var wb    = isCSV ? null : new ExcelJS.Workbook();

      // CSV helpers — sin tildes ni emojis
      function csvStr(v) {
        return String(v == null ? '' : v)
          .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
          .replace(/[áàäâã]/gi, 'a').replace(/[éèëê]/gi, 'e')
          .replace(/[íìïî]/gi, 'i').replace(/[óòöôõ]/gi, 'o')
          .replace(/[úùüû]/gi, 'u').replace(/[ñ]/gi, 'n')
          .replace(/[\u0080-\u00BF\u00D7\u00F7\u0100-\uFFFF]/g, '');
      }
      function csvEsc(v) {
        var s = csvStr(v);
        if (s.indexOf(';') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
          s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      }

      // Fabrica unificada: devuelve objeto con addRow / finalize / getLines
      function makeGroup(name, tabArgb, hdrsExcel, hdrsCSV) {
        if (isCSV) {
          var hdr = (hdrsCSV || hdrsExcel).map(csvStr);
          var lines = [hdr.map(csvEsc).join(';')];
          return {
            addRow:   function(data) { lines.push(data.map(csvEsc).join(';')); },
            finalize: function() {},
            getLines: function() { return lines; }
          };
        }
        var ws = wb.addWorksheet(name, {
          views: [{ state: 'frozen', ySplit: 1 }],
          properties: { tabColor: { argb: tabArgb } }
        });
        ws.addRow(hdrsExcel);
        ws.getRow(1).eachCell(function(cell) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
          cell.font = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.border = { bottom: { style: 'medium', color: { argb: ORANGE } } };
        });
        ws.getRow(1).height = 22;
        var colW = hdrsExcel.map(function(h) { return h.length; });
        return {
          addRow: function(data, fillArgb) {
            var row = ws.addRow(data);
            if (fillArgb) {
              row.eachCell({ includeEmpty: true }, function(cell) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
              });
            }
            data.forEach(function(v, ci) {
              var len = v != null ? String(v).length : 0;
              if (len > (colW[ci] || 0)) colW[ci] = len;
            });
          },
          finalize: function() {
            ws.columns.forEach(function(col, ci) {
              col.width = Math.min(Math.max((colW[ci] || 10) + 2, 10), 60);
            });
          },
          getLines: function() { return []; }
        };
      }

      function statusLabel(fill) {
        if (isCSV) return fill === C_RED ? 'Alerta' : fill === C_YEL ? 'Advertencia' : 'OK';
        return fill === C_RED ? '🔴 Alerta' : fill === C_YEL ? '🟡 Advertencia' : '✅ OK';
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
      var S0 = makeGroup('Resumen', 'FF34D399',
        ['#', 'Hoja', 'Total registros', 'Alertas 🔴', 'Advertencias 🟡', 'OK ✅', '% Consistencia'],
        ['#', 'Hoja', 'Total registros', 'Alertas', 'Advertencias', 'OK', '% Consistencia']);

      /* ── HOJA 1: PRODUCT ────────────────────────────────────────────── */
      if (ent.prd) {
        initStat('Product');
        var S1 = makeGroup('Product', 'FF29ABE2',
          ['Estado', 'PRDID', 'PRDDESCR', 'MATTYPEID',
           'En PSH (output)', 'En PSI (componente)',
           'En Location Product', 'En Location Source',
           'Observacion'],
          ['Estado', 'PRDID', 'PRDDESCR', 'MATTYPEID',
           'En PSH (output)', 'En PSI (componente)',
           'En Location Product', 'En Location Source',
           'Observacion']);
        Object.keys(PA_PRD).sort().forEach(function(prdid) {
          var inPSH = !!pshPrdSetP[prdid];
          var inPSI = psiPrdSet.has(prdid);
          var inLP  = locPrdPrdSet.has(prdid);
          var inLS  = locSrcPrdSet.has(prdid);
          var obs = [];
          if (!inLP)           obs.push('Sin cobertura logistica (no esta en Location Product)');
          if (!inPSH && !inLS) obs.push('Sin fuente de produccion ni arco de abastecimiento');
          else if (!inPSH)     obs.push('Sin fuente de produccion propia (no esta en PSH)');
          if (!inPSH && inPSI) obs.push('Solo actua como componente (PSI)');
          if (!obs.length)     obs.push('OK');
          var fill = (!inLP || (!inPSH && !inLS)) ? C_RED : (!inPSH || !inLS) ? C_YEL : null;
          S1.addRow([statusLabel(fill), prdid, pd(prdid), pm(prdid), yn(inPSH), yn(inPSI), yn(inLP), yn(inLS), obs.join(' | ')], fill);
          track('Product', fill);
        });
        S1.finalize();
        setStatusPA('Hoja Product lista...', 82);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 2: RESOURCE ───────────────────────────────────────────── */
      if (ent.res) {
        initStat('Resource');
        var S2 = makeGroup('Resource', 'FFa78bfa',
          ['Estado', 'RESID', 'RESDESCR', 'En PSR', 'En Resource Location', 'Observacion'],
          ['Estado', 'RESID', 'RESDESCR', 'En PSR', 'En Resource Location', 'Observacion']);
        Object.keys(PA_RES).sort().forEach(function(resid) {
          var inPSR = psrResidSet.has(resid);
          var inRL  = resLocResidSet.has(resid);
          var obs = [];
          if (!inPSR && !inRL) obs.push('Recurso huerfano: sin uso en produccion ni planta asignada');
          else if (!inPSR)     obs.push('Sin uso en produccion (no aparece en PSR)');
          else if (!inRL)      obs.push('Sin planta asignada en Resource Location');
          if (!obs.length)     obs.push('OK');
          var fill = (!inPSR && !inRL) ? C_RED : (!inPSR || !inRL) ? C_YEL : null;
          S2.addRow([statusLabel(fill), resid, str((PA_RES[resid] || {}).RESDESCR || ''), yn(inPSR), yn(inRL), obs.join(' | ')], fill);
          track('Resource', fill);
        });
        S2.finalize();
        setStatusPA('Hoja Resource lista...', 84);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 3: RESOURCE LOCATION ──────────────────────────────────── */
      if (ent.resLoc) {
        initStat('Resource Location');
        var S3 = makeGroup('Resource Location', 'FFFF9F43',
          ['Estado', 'RESID', 'LOCID', 'RESID+LOCID usado en PSR', 'Observacion'],
          ['Estado', 'RESID', 'LOCID', 'RESID+LOCID usado en PSR', 'Observacion']);
        Object.keys(PA_RES_LOC).sort().forEach(function(resid) {
          PA_RES_LOC[resid].forEach(function(e) {
            var locid = e.LOCID;
            var used  = psrByResidLoc.has(resid + '|' + locid);
            var obs   = used ? 'OK' : 'Recurso asignado a planta pero no utilizado en PSR para esta planta';
            var fill  = used ? null : C_YEL;
            S3.addRow([statusLabel(fill), resid, locid, yn(used), obs], fill);
            track('Resource Location', fill);
          });
        });
        S3.finalize();
        setStatusPA('Hoja Resource Location lista...', 85);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 4: PRODUCTION SOURCE HEADER ──────────────────────────── */
      if (ent.psh) {
        initStat('Prod Source Header');
        var S6 = makeGroup('Prod Source Header', 'FFF7A800',
          ['Estado', 'SOURCEID', 'PRDID output', 'LOCID planta', 'SOURCETYPE(s)', 'PLEADTIME', 'OUTPUTCOEFFICIENT',
           'PRDID+LOCID en Location Product', 'Tiene items PSI (BOM)', 'Tiene recursos PSR', 'Observacion'],
          ['Estado', 'SOURCEID', 'PRDID output', 'LOCID planta', 'SOURCETYPE(s)', 'PLEADTIME', 'OUTPUTCOEFFICIENT',
           'PRDID+LOCID en Location Product', 'Tiene items PSI (BOM)', 'Tiene recursos PSR', 'Observacion']);
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
          if (!hasPSI) obs.push('BOM vacio: sin componentes en PSI');
          if (noLt)    obs.push('PLEADTIME = 0 o no definido');
          if (!inLP)   obs.push('PRDID+LOCID sin cobertura en Location Product');
          if (!hasP)   obs.push('Sin registro SOURCETYPE=P');
          if (multi)   obs.push('Multiples fuentes (>1 SOURCEID) para mismo PRDID+LOCID - verificar cuotas');
          if (!obs.length) obs.push('OK');
          var fill = (!hasPSI || noLt || !inLP) ? C_RED : (!hasP || multi) ? C_YEL : null;
          S6.addRow([statusLabel(fill), sid, outPrd, outLoc, stypes, plt, coeff,
            yn(inLP), yn(hasPSI), yn(hasPSR), obs.join(' | ')], fill);
          track('Prod Source Header', fill);
        });
        S6.finalize();
        setStatusPA('Hoja Prod Source Header lista...', 91);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 7: PRODUCTION SOURCE ITEM ────────────────────────────── */
      if (ent.psi) {
        initStat('Prod Source Item');
        var S7 = makeGroup('Prod Source Item', 'FF06B6D4',
          ['Estado', 'SOURCEID', 'PRDID output', 'LOCID planta', 'PRDID componente', 'COMPONENTCOEFFICIENT',
           'Tipo componente', 'PRDID comp+LOCID en Location Product',
           'En Location Source (insumo)', 'LOCFR origen', 'LOCTYPE origen',
           'LOCFR+PRDID en Location Product', 'Material de reemplazo (ISALTITEM)', 'Reemplaza a',
           'Observacion'],
          ['Estado', 'SOURCEID', 'PRDID output', 'LOCID planta', 'PRDID componente', 'COMPONENTCOEFFICIENT',
           'Tipo componente', 'PRDID comp+LOCID en Location Product',
           'En Location Source (insumo)', 'LOCFR origen', 'LOCTYPE origen',
           'LOCFR+PRDID en Location Product', 'Material de reemplazo (ISALTITEM)', 'Reemplaza a',
           'Observacion']);
        var PSI_CHUNK = 300;
        for (var pii = 0; pii < allPsi.length; pii += PSI_CHUNK) {
          allPsi.slice(pii, pii + PSI_CHUNK).forEach(function(r) {
            var sid    = str(r.SOURCEID);
            var comp   = str(r.PRDID || '');
            var coeff  = str(r.COMPONENTCOEFFICIENT || '');
            var isAlt  = str(r.ISALTITEM || '');
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
            // Materiales reemplazados (solo si ISALTITEM=X)
            var replacedBy = '';
            if (isAlt === 'X') {
              var replaced = psiSubBySprdfr[comp] || [];
              replacedBy = replaced.join(', ');
            }
            var obs = [];
            if (noSrc)    obs.push('SOURCEID no encontrado en PSH - planta no determinada');
            if (noCoeff)  obs.push('Coeficiente = 0 o no definido');
            if (isSemi)   obs.push('Semielaborado: trazabilidad disponible en PSH');
            if (!isSemi && !noSrc) {
              if (!inLS)  obs.push('Insumo sin arco de abastecimiento en Location Source');
              else {
                var allV     = lsRows.every(function(x){ return (lct(x.LOCFR)||'').toUpperCase() === 'V'; });
                var someNotV = lsRows.some(function(x){ return (lct(x.LOCFR)||'').toUpperCase() !== 'V'; });
                if (allV)     obs.push('Insumo con proveedor externo (LOCTYPE=V)');
                if (someNotV) obs.push('Insumo con origen de tipo no-V - revisar LOCTYPE');
              }
            }
            if (!compInLP && locid) obs.push('Componente no habilitado en Location Product para esta planta');
            if (isAlt === 'X' && !replacedBy && ent.psiSub) obs.push('Material de reemplazo sin registro en Item Sub');
            if (!obs.length) obs.push('OK');
            var fill = (noCoeff || (!isSemi && !inLS && !noSrc) || (!compInLP && locid)) ? C_RED
                     : (noSrc || (!isSemi && inLS && lsRows.some(function(x){ return (lct(x.LOCFR)||'').toUpperCase() !== 'V'; }))
                        || (isAlt === 'X' && !replacedBy && ent.psiSub)) ? C_YEL
                     : null;
            S7.addRow([statusLabel(fill), sid, outPrd, locid, comp, coeff, tipo, yn(compInLP),
              !isSemi && !noSrc ? yn(inLS) : 'N/A',
              locfrVal, locfrType, locfrInLP, isAlt || '', replacedBy, obs.join(' | ')], fill);
            track('Prod Source Item', fill);
          });
          await new Promise(function(r){ setTimeout(r, 0); });
          setStatusPA('Hoja Prod Source Item: ' + Math.min(pii + PSI_CHUNK, allPsi.length) + '/' + allPsi.length + '...',
            91 + Math.round((Math.min(pii + PSI_CHUNK, allPsi.length) / Math.max(allPsi.length, 1)) * 4));
        }
        S7.finalize();
        setStatusPA('Hoja Prod Source Item lista...', 95);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 8: PRODUCTION SOURCE RESOURCE ────────────────────────── */
      if (ent.psr) {
        initStat('Prod Source Resource');
        var S8 = makeGroup('Prod Source Resource', 'FF6C63FF',
          ['Estado', 'SOURCEID', 'PRDID output', 'LOCID planta', 'RESID',
           'RESID+LOCID en Resource Location', 'Observacion'],
          ['Estado', 'SOURCEID', 'PRDID output', 'LOCID planta', 'RESID',
           'RESID+LOCID en Resource Location', 'Observacion']);
        allPsr.forEach(function(r) {
          var sid    = str(r.SOURCEID);
          var resid  = str(r.RESID || '');
          var info   = pshSidLocid[sid] || {};
          var locid  = info.LOCID || '';
          var outPrd = info.PRDID || '';
          var inRL   = !!(locid && resid && resLocSet.has(resid + '|' + locid));
          var noSrc  = !locid;
          var obs    = noSrc ? 'SOURCEID no encontrado en PSH - planta no determinada'
                     : inRL  ? 'OK'
                     :         'Recurso utilizado en produccion sin asignacion en Resource Location para planta ' + locid;
          var fill   = noSrc ? C_YEL : inRL ? null : C_YEL;
          S8.addRow([statusLabel(fill), sid, outPrd, locid, resid, yn(inRL), obs], fill);
          track('Prod Source Resource', fill);
        });
        S8.finalize();
        setStatusPA('Hoja Prod Source Resource lista...', 97);
        await new Promise(function(r){ setTimeout(r, 0); });
      }

      /* ── HOJA 0: RESUMEN (llenar ahora que tenemos todos los stats) ─── */
      setStatusPA('Generando Resumen...', 98);
      var sheetDefs = [
        { key: 'Product',              num: 1 },
        { key: 'Resource',             num: 2 },
        { key: 'Resource Location',    num: 3 },
        { key: 'Prod Source Header',   num: 4 },
        { key: 'Prod Source Item',     num: 5 },
        { key: 'Prod Source Resource', num: 6 }
      ];
      sheetDefs.forEach(function(d) {
        var s = STATS[d.key]; if (!s) return;
        var pct  = s.total > 0 ? Math.round((s.ok / s.total) * 100) : 100;
        var fill = s.red > 0 ? C_RED : s.yel > 0 ? C_YEL : null;
        S0.addRow([d.num, d.key, s.total, s.red, s.yel, s.ok, pct + '%'], fill);
      });
      S0.finalize();

      /* ── EXPORT ─────────────────────────────────────────────────────── */
      if (isCSV) {
        setStatusPA('Comprimiendo CSVs...', 99);
        var zip = new JSZip();
        zip.file('00_Resumen.csv',              S0.getLines().join('\r\n'));
        zip.file('01_Product.csv',              S1 ? S1.getLines().join('\r\n') : '');
        zip.file('02_Resource.csv',             S2 ? S2.getLines().join('\r\n') : '');
        zip.file('03_Resource_Location.csv',    S3 ? S3.getLines().join('\r\n') : '');
        zip.file('04_Prod_Source_Header.csv',   S6 ? S6.getLines().join('\r\n') : '');
        zip.file('05_Prod_Source_Item.csv',     S7 ? S7.getLines().join('\r\n') : '');
        zip.file('06_Prod_Source_Resource.csv', S8 ? S8.getLines().join('\r\n') : '');
        var content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        var url = URL.createObjectURL(content);
        var a = document.createElement('a');
        a.href = url; a.download = 'ProductionHierarchyAnalysis_' + today + '.zip';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
      } else {
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
    }
