    /* ═══════════════════════════════════════════════════════════════
       SUPPLY NETWORK: STREAMING FETCH + INDEX + ANALYSE + EXPORT
       ═══════════════════════════════════════════════════════════════ */

    /* Fetches all OData pages, calls onPage(results) per page (no accumulation). */
    async function fetchAndIndex(entityUrl, logEl, pverFilter, selectFields, onPage) {
      var PAGE_SIZE = 50000;
      var page = 0, total = 0;
      var filterParam = pverFilter ? '&$filter=' + encodeURIComponent(pverFilter) : '';
      var selectParam = selectFields ? '&$select=' + encodeURIComponent(selectFields) : '';
      var url = entityUrl + '?$format=json&$top=' + PAGE_SIZE + filterParam + selectParam;
      var isNextLink = false;

      while (url) {
        page++;
        if (page === 1) log(logEl, 'info', '  ↳ URL: ' + url);
        else log(logEl, 'info', '  ↳ Pág.' + page + ' → ' + url);
        var data = await (isNextLink ? apiJsonNext(url) : apiJson(url));
        var results = (data.d && data.d.results) ? data.d.results : (data.value || []);
        await onPage(results);   // index/store this page, then let it be GC'd
        total += results.length;

        if (page > 1) log(logEl, 'info', '  ↳ Pág.' + page + ': +' + results.length + ' (acum: ' + total + ')');

        var next = (data.d && data.d.__next) ? data.d.__next : null;
        if (!next && data['@odata.nextLink']) next = data['@odata.nextLink'];
        if (next) {
          url = (next.indexOf('http') === 0) ? next : (CFG.url + next);
          isNextLink = true;
        } else if (results.length === PAGE_SIZE) {
          url = entityUrl + '?$format=json&$top=' + PAGE_SIZE + '&$skip=' + total + filterParam + selectParam;
          isNextLink = false;
          log(logEl, 'warn', '  ↳ Sin __next, fallback $skip=' + total);
        } else { url = null; }
      }
      return total;
    }

    /* ── Helpers de apertura/cierre de panels mattype SN ── */
    function _snOpenMattypeBody(bodyId, arrId) {
      var body = document.getElementById(bodyId);
      var arr  = document.getElementById(arrId);
      if (body) body.style.display = 'block';
      if (arr)  arr.textContent = '▼';
    }
    function _snCloseMattypeBody(bodyId, arrId) {
      var body = document.getElementById(bodyId);
      var arr  = document.getElementById(arrId);
      if (body) body.style.display = 'none';
      if (arr)  arr.textContent = '▶';
    }

    /* MDT → Exclude */
    function doConfirmMapping() {
      var body = document.getElementById('bodySNMDT');
      var arr  = document.getElementById('arrSNMDT');
      if (body && !body.classList.contains('hidden')) {
        body.classList.add('hidden');
        if (arr) arr.textContent = '▶';
      }
      var excl = document.getElementById('panelSNExclude');
      if (excl) {
        excl.classList.remove('hidden');
        _snOpenMattypeBody('snmattypeExcludeBody', 'snmattypeExcludeArr');
        excl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      var wrap = document.getElementById('snmattypeExcludeWrap');
      if (wrap) wrap.innerHTML = '<p style="color:var(--text2);font-size:12px;margin:8px 0;">&#9203; Cargando tipos de material desde SAP IBP\u2026</p>';
      snFetchMattypes().then(function() {
        mattyeRenderExclude('sn');
        _mattyeUpdateExcludeSummary();
        _snUpdateRunSummary();
      });
    }

    /* Exclude → MDT (volver) */
    function doBackToMapping() {
      ['panelSNExclude', 'panelSNCategories', 'panelSNExportMode'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      _snCloseMattypeBody('snmattypeExcludeBody', 'snmattypeExcludeArr');
      _snCloseMattypeBody('snmattypeCatBody',     'snmattypeCatArr');
      var body = document.getElementById('bodySNMDT');
      var arr  = document.getElementById('arrSNMDT');
      if (body) {
        body.classList.remove('hidden');
        if (arr) arr.textContent = '▼';
        document.getElementById('panelSNMDT').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    /* Exclude → Categories */
    function snContinueToCategories() {
      _snCloseMattypeBody('snmattypeExcludeBody', 'snmattypeExcludeArr');
      var cat = document.getElementById('panelSNCategories');
      if (cat) {
        cat.classList.remove('hidden');
        _snOpenMattypeBody('snmattypeCatBody', 'snmattypeCatArr');
        mattyeRenderCategorize('sn');
        cat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      _snUpdateRunSummary();
    }

    /* Categories → Exclude (volver) */
    function snBackToExclude() {
      _snCloseMattypeBody('snmattypeCatBody', 'snmattypeCatArr');
      _snOpenMattypeBody('snmattypeExcludeBody', 'snmattypeExcludeArr');
      document.getElementById('panelSNExclude').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* Categories → Run */
    function snContinueToRun() {
      _snCloseMattypeBody('snmattypeCatBody', 'snmattypeCatArr');
      var run = document.getElementById('panelSNExportMode');
      if (run) {
        run.classList.remove('hidden');
        run.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      _snUpdateRunSummary();
    }

    /* Run → Categories (volver) */
    function snBackToCategories() {
      var run = document.getElementById('panelSNExportMode');
      if (run) run.classList.add('hidden');
      _snOpenMattypeBody('snmattypeCatBody', 'snmattypeCatArr');
      document.getElementById('panelSNCategories').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* Fetch ligero de Product para poblar tipos de material */
    async function snFetchMattypes() {
      var prdEnt = document.getElementById('selSNProduct').value;
      if (!prdEnt || !CFG || !CFG.url) return;
      var baseOData = CFG.url + '/sap/opu/odata/IBP/' + CFG.service + '/';
      var paFilter  = CFG.pa
        ? (CFG.pver
          ? "PlanningAreaID eq '" + CFG.pa + "' and VersionID eq '" + CFG.pver + "'"
          : "PlanningAreaID eq '" + CFG.pa + "'")
        : '';
      var tmpPrd = {};
      var logDummy = document.getElementById('logSN') || document.createElement('div');
      try {
        await fetchAndIndex(baseOData + prdEnt, logDummy, paFilter, 'PRDID,MATTYPEID',
          function(rows) {
            rows.forEach(function(r) { var k = str(r.PRDID); if (k) tmpPrd[k] = r; });
            return Promise.resolve();
          });
        mattyeInit(tmpPrd);
      } catch(e) {
        console.warn('[snFetchMattypes] fetch falló:', e);
      }
    }

    function _snUpdateRunSummary() {
      var el = document.getElementById('snRunSummary');
      if (!el) return;
      var excl    = Object.keys(MATTYPE_CFG).filter(function(k) { return MATTYPE_CFG[k].excluded; });
      var catted  = Object.keys(MATTYPE_CFG).filter(function(k) { return !MATTYPE_CFG[k].excluded && MATTYPE_CFG[k].categories.size > 0; });
      var inclPrds = Object.keys(MATTYPE_CFG).filter(function(k) { return !MATTYPE_CFG[k].excluded; })
        .reduce(function(s,k){ return s + (MATTYPE_CFG[k].count||0); }, 0);
      var exclPrds = excl.reduce(function(s,k){ return s + (MATTYPE_CFG[k].count||0); }, 0);
      if (!excl.length && !catted.length) {
        el.textContent = 'Configuración por defecto — análisis estándar para todos los tipos';
      } else {
        var parts = [];
        parts.push(inclPrds + ' productos incluidos en ' + (Object.keys(MATTYPE_CFG).length - excl.length) + ' tipo(s)');
        if (excl.length)  parts.push(exclPrds + ' productos excluidos (' + excl.join(', ') + ')');
        if (catted.length) parts.push(catted.length + ' tipo(s) categorizados');
        el.textContent = parts.join(' · ');
      }
    }

    async function doAnalyzeAndExport() {
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
            'PRDID,LOCID,PLEADTIME,PRATIO',
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
            'SOURCEID,PRDID,COMPONENTCOEFFICIENT',
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

        // ── PHASE 2+3: Análisis + exportación (50 → 100%) ──────────────
        function onProg(pct) { progEl.style.width = pct + '%'; }
        function onStat(msg) { setStatusSN('info', msg); }
        var summary = await analyzeAndStreamExcel(onProg, onStat, timer, logEl);
        progEl.style.width = '100%';

        var _dur = fmtDuration(timer.ms());
        var _n   = summary.totalProducts.toLocaleString('es-CL');
        log(logEl, 'ok', timer.fmt() + ' Análisis completado. ' + _n + ' productos analizados · Excel descargado · ' + _dur + '.');
        setStatusSN('ok', '&#10003; Análisis completado &mdash; Excel descargado &nbsp;|&nbsp; ' + _n + ' productos &nbsp;&middot;&nbsp; ' + _dur);
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


    /* ══════════════════════════════════════════════════════════════════
       StreamingXlsx — builder XLSX mínimo para browser sin modelo en memoria.
       Genera XML fila a fila (inlineStr); soporta 3 fills + estilo cabecera.
       Requiere JSZip (ya cargado). API compatible con el subconjunto de ExcelJS
       que usa analyzeAndStreamExcel: addWorksheet / addRow / getRow / columns.
       ══════════════════════════════════════════════════════════════════ */
    (function () {
      'use strict';

      function _col(n) {
        var s = '';
        while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
        return s;
      }

      function _xe(v) {
        if (v == null) return '';
        return String(v)
          .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
      }

      // cellXfs indices (ver _styles): 0=normal 1=hdr-gold 2=rojo 3=amarillo 4=na-grey
      // 5=hdr-control 6=hdr-ibp 7=hdr-flag 8=hdr-metric 9=hdr-detail
      var _NORM = 0, _HDR = 1, _RED = 2, _YEL = 3, _NA = 4;
      var HDR_FILL_XF  = { 'FFF7A800': 1, 'FFD1D5DB': 5, 'FFBAE6FD': 6, 'FFFDE68A': 7, 'FFA7F3D0': 8, 'FF99F6E4': 9 };
      var DATA_FILL_XF = { 'FFFFCCCC': 2, 'FFFFFFCC': 3, 'FFE5E7EB': 4 };
      function _si(argb) {
        if (!argb) return _NORM;
        return DATA_FILL_XF[argb] || _NORM;
      }

      // cellSi: array de índices xf por celda; cuando está presente, las celdas
      // sin índice explícito usan _NORM (modo per-celda) en lugar de rowSi.
      function _rowXml(data, rn, rowSi, ht, cellSi) {
        var p = ['<row r="', rn, '"'];
        if (ht) p.push(' ht="', ht, '" customHeight="1"');
        p.push('>');
        for (var ci = 0; ci < data.length; ci++) {
          var v = data[ci], ref = _col(ci + 1) + rn;
          var si = (cellSi && cellSi[ci] != null) ? cellSi[ci] : (cellSi ? _NORM : rowSi);
          var sa = si ? ' s="' + si + '"' : '';
          if (typeof v === 'number' && isFinite(v))
            p.push('<c r="', ref, '" t="n"', sa, '><v>', v, '</v></c>');
          else { var raw = v != null ? String(v) : '';
            if (raw.length > 32767) raw = raw.slice(0, 32750) + '\u2026';
            var txt = _xe(raw);
            if (txt) p.push('<c r="', ref, '" t="inlineStr"', sa, '><is><t>', txt, '</t></is></c>');
            else     p.push('<c r="', ref, '"', sa, '/>');
          }
        }
        p.push('</row>');
        return p.join('');
      }

      /* ── Row proxy: acumula estilos hasta el flush ── */
      function _Row(data, rn, isHdr) {
        this.data = data; this.rowNum = rn; this._h = isHdr; this._fill = null; this._ht = isHdr ? 20 : 0;
        this._cellSi = null;
      }
      _Row.prototype.eachCell = function (optOrCb, maybeCb) {
        var cb = typeof optOrCb === 'function' ? optOrCb : maybeCb;
        if (!cb) return;
        var self = this;
        this.data.forEach(function (val, ci) {
          cb({
            get value() { return val; },
            colNumber: ci + 1,
            set fill(f) {
              if (!f || !f.fgColor) return;
              var argb = f.fgColor.argb;
              if (!self._cellSi) self._cellSi = [];
              var tbl = self._h ? HDR_FILL_XF : DATA_FILL_XF;
              self._cellSi[ci] = tbl[argb] !== undefined ? tbl[argb] : (self._h ? _HDR : _NORM);
            },
            set note(n) {
              if (!n) return;
              if (!self._notes) self._notes = {};
              self._notes[ci] = n;
            },
            set font(_) {}, set alignment(_) {}, set border(_) {}
          }, ci + 1);
        });
      };
      Object.defineProperty(_Row.prototype, 'height', { set: function (v) { this._ht = v; } });

      /* ── Sheet: buffer de 1 fila, escribe XML en cuanto llega la siguiente ── */
      function _Sheet(name, opts) {
        opts = opts || {};
        var vw = (opts.views || [{}])[0] || {};
        var pr = opts.properties || {};
        this.name    = name;
        this._tab    = pr.tabColor ? pr.tabColor.argb : null;
        this._freeze = vw.ySplit || 0;
        this._chunks = [];
        this._colW   = [];
        this._nCols  = 0;
        this._rn     = 0;
        this._pend   = null;
        this._notes  = {};
      }

      _Sheet.prototype._flush = function () {
        if (!this._pend) return;
        var p = this._pend; this._pend = null;
        var si = p._h ? _HDR : _si(p._fill);
        this._chunks.push(_rowXml(p.data, p.rowNum, si, p._ht, p._cellSi));
        if (p._notes) this._notes[p.rowNum] = p._notes;
        var cw = this._colW, nc = this._nCols;
        p.data.forEach(function (v, ci) {
          var l = v != null ? String(v).length : 0;
          if (ci >= nc) nc = ci + 1;
          if (l > (cw[ci] || 0)) cw[ci] = l;
        });
        this._nCols = nc;
      };

      _Sheet.prototype.addRow = function (data) {
        this._flush();
        this._rn++;
        this._pend = new _Row(data, this._rn, this._rn === 1);
        return this._pend;
      };

      _Sheet.prototype.getRow = function (n) {
        if (this._pend && this._pend.rowNum === n) return this._pend;
        return new _Row([], n, false);
      };

      Object.defineProperty(_Sheet.prototype, 'columns', {
        get: function () {
          this._flush();
          var self = this, arr = [];
          for (var i = 0; i < this._nCols; i++) {
            (function (ci) {
              arr.push({ get width() { return (self._colW[ci] || 10) + 2; },
                         set width(w) { self._colW[ci] = Math.max(0, w - 2); } });
            })(i);
          }
          return arr;
        }
      });

      _Sheet.prototype._hasNotes = function () {
        var n = this._notes;
        for (var k in n) { if (Object.prototype.hasOwnProperty.call(n, k)) return true; }
        return false;
      };

      _Sheet.prototype._commentsXml = function () {
        var parts = [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
          '<authors><author>GoSCM</author></authors><commentList>'
        ];
        var notes = this._notes;
        Object.keys(notes).forEach(function (rn) {
          var row = notes[rn];
          Object.keys(row).forEach(function (ci) {
            var ref = _col(parseInt(ci, 10) + 1) + rn;
            parts.push('<comment ref="', ref, '" authorId="0"><text><r><t>',
              _xe(row[ci]), '</t></r></text></comment>');
          });
        });
        parts.push('</commentList></comments>');
        return parts.join('');
      };

      _Sheet.prototype._vmlXml = function () {
        var parts = [
          '<xml xmlns:v="urn:schemas-microsoft-com:vml"',
          ' xmlns:o="urn:schemas-microsoft-com:office:office"',
          ' xmlns:x="urn:schemas-microsoft-com:office:excel">',
          '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>',
          '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202"',
          ' path="m,l,21600r21600,l21600,xe">',
          '<v:stroke joinstyle="miter"/>',
          '<v:path gradientshapeok="t" o:connecttype="rect"/>',
          '</v:shapetype>'
        ];
        var sid = 1025;
        var notes = this._notes;
        Object.keys(notes).forEach(function (rn) {
          var row = notes[rn];
          var rowIdx = parseInt(rn, 10) - 1;
          Object.keys(row).forEach(function (ci) {
            var colIdx = parseInt(ci, 10);
            var lc = colIdx + 1, rc = colIdx + 6;
            var anchor = lc + ', 15, ' + rowIdx + ', 2, ' + rc + ', 15, ' + (rowIdx + 5) + ', 16';
            parts.push(
              '<v:shape id="_x0000_s', sid++, '" type="#_x0000_t202"',
              ' style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:1;visibility:hidden"',
              ' fillcolor="#ffffe1" o:insetmode="auto">',
              '<v:fill color2="#ffffe1"/><v:shadow color="black" obscured="t"/>',
              '<v:path o:connecttype="none"/>',
              '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>',
              '<x:ClientData ObjectType="Note">',
              '<x:MoveWithCells/><x:SizeWithCells/>',
              '<x:Anchor>', anchor, '</x:Anchor>',
              '<x:AutoFill>False</x:AutoFill>',
              '<x:Row>', rowIdx, '</x:Row>',
              '<x:Column>', colIdx, '</x:Column>',
              '</x:ClientData></v:shape>'
            );
          });
        });
        parts.push('</xml>');
        return parts.join('');
      };

      _Sheet.prototype._toXml = function () {
        this._flush();
        var hdr = [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
          ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        ];
        if (this._tab)
          hdr.push('<sheetPr><tabColor rgb="' + this._tab + '"/></sheetPr>');
        if (this._rn > 0 && this._nCols > 0)
          hdr.push('<dimension ref="A1:' + _col(this._nCols) + this._rn + '"/>');
        if (this._freeze)
          hdr.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + this._freeze +
            '" topLeftCell="A' + (this._freeze + 1) +
            '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
        hdr.push('<sheetFormatPr defaultRowHeight="15"/>');
        if (this._nCols > 0) {
          hdr.push('<cols>');
          for (var ci = 0; ci < this._nCols; ci++) {
            var w = Math.min(Math.max((this._colW[ci] || 10) + 2, 10), 60);
            hdr.push('<col min="' + (ci + 1) + '" max="' + (ci + 1) + '" width="' + w + '" customWidth="1"/>');
          }
          hdr.push('</cols>');
        }
        hdr.push('<sheetData>');
        var chunks = this._chunks || [];
        this._chunks = null;   // libera refs → GC puede reclamar los strings de filas
        var footer = ['</sheetData>'];
        if (this._hasNotes()) footer.push('<legacyDrawing r:id="rId2"/>');
        footer.push('</worksheet>');
        return new Blob(hdr.concat(chunks, footer), { type: 'application/xml' });
      };

      /* ── Workbook ── */
      function StreamingXlsx() {
        this._sheets = [];
        var self = this;
        this.xlsx = { writeBuffer: async function () { return self.toBlob(); } };
      }

      StreamingXlsx.prototype.addWorksheet = function (name, opts) {
        var sh = new _Sheet(name, opts || {});
        this._sheets.push(sh);
        return sh;
      };

      StreamingXlsx.prototype._styles = function () {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<fonts count="3">' +
            '<font><sz val="10"/><name val="DM Sans"/></font>' +
            '<font><b/><sz val="10"/><name val="DM Sans"/><color rgb="FF0B1120"/></font>' +
            '<font><i/><sz val="10"/><name val="DM Sans"/><color rgb="FF6B7280"/></font>' +
          '</fonts>' +
          '<fills count="12">' +
            '<fill><patternFill patternType="none"/></fill>' +
            '<fill><patternFill patternType="gray125"/></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFF7A800"/></patternFill></fill>' +
            '<fill><patternFill patternType="none"/></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFFFCCCC"/></patternFill></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFCC"/></patternFill></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/></patternFill></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFD1D5DB"/></patternFill></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFBAE6FD"/></patternFill></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE68A"/></patternFill></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFA7F3D0"/></patternFill></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FF99F6E4"/></patternFill></fill>' +
          '</fills>' +
          '<borders count="2">' +
            '<border><left/><right/><top/><bottom/><diagonal/></border>' +
            '<border><left/><right/><top/><bottom style="medium"><color rgb="FFE8622A"/></bottom><diagonal/></border>' +
          '</borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="10">' +
            '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>' +
            '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="2" fillId="6" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="1" fillId="7" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>' +
            '<xf numFmtId="0" fontId="1" fillId="8" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>' +
            '<xf numFmtId="0" fontId="1" fillId="9" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>' +
            '<xf numFmtId="0" fontId="1" fillId="10" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>' +
            '<xf numFmtId="0" fontId="1" fillId="11" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>' +
          '</cellXfs>' +
          '</styleSheet>';
      };

      StreamingXlsx.prototype.toBlob = async function () {
        var sheets = this._sheets, n = sheets.length, zip = new JSZip();

        // Serializar hojas primero (dispara _flush → captura notas)
        var hasNotes = new Array(n).fill(false);
        for (var i = 0; i < n; i++) {
          zip.file('xl/worksheets/sheet' + (i + 1) + '.xml', sheets[i]._toXml());
          hasNotes[i] = sheets[i]._hasNotes();
          await new Promise(function (r) { setTimeout(r, 0); }); // yield al GC
        }
        var anyNotes = hasNotes.some(Boolean);

        // Content-Types — se construye después de conocer qué hojas tienen notas
        var ct = [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
          '<Default Extension="xml" ContentType="application/xml"/>'
        ];
        if (anyNotes)
          ct.push('<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>');
        ct.push(
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        );
        for (var i = 0; i < n; i++) {
          ct.push('<Override PartName="/xl/worksheets/sheet', (i + 1), '.xml"',
            ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
          if (hasNotes[i])
            ct.push('<Override PartName="/xl/comments', (i + 1), '.xml"',
              ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>');
        }
        ct.push('</Types>');
        zip.file('[Content_Types].xml', ct.join(''));

        zip.file('_rels/.rels',
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"' +
          ' Target="xl/workbook.xml"/></Relationships>');

        var wbx = [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        ];
        for (var i = 0; i < n; i++)
          wbx.push('<sheet name="', _xe(sheets[i].name), '" sheetId="', (i + 1), '" r:id="rId', (i + 2), '"/>');
        wbx.push('</sheets></workbook>');
        zip.file('xl/workbook.xml', wbx.join(''));

        var wr = [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        ];
        for (var i = 0; i < n; i++)
          wr.push('<Relationship Id="rId', (i + 2),
            '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"',
            ' Target="worksheets/sheet', (i + 1), '.xml"/>');
        wr.push('</Relationships>');
        zip.file('xl/_rels/workbook.xml.rels', wr.join(''));

        zip.file('xl/styles.xml', this._styles());

        // Archivos de comentarios y VML para hojas que los tienen
        for (var i = 0; i < n; i++) {
          if (!hasNotes[i]) continue;
          zip.file('xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"' +
            ' Target="../comments' + (i + 1) + '.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing"' +
            ' Target="../drawings/vmlDrawing' + (i + 1) + '.vml"/>' +
            '</Relationships>');
          zip.file('xl/comments' + (i + 1) + '.xml', sheets[i]._commentsXml());
          zip.file('xl/drawings/vmlDrawing' + (i + 1) + '.vml', sheets[i]._vmlXml());
        }

        return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      };

      window.StreamingXlsx = StreamingXlsx;
    })();

    /* ═══════════════════════════════════════════════════════════════
       SUPPLY NETWORK — ANÁLISIS + EXPORTACIÓN STREAMING
       7 grupos de hojas orientados a entidad (con auto-split >900k).
       Las filas se escriben como XML directo — sin modelo de objetos.
       ═══════════════════════════════════════════════════════════════ */
    async function analyzeAndStreamExcel(onProgress, onStatus, timer, logEl) {
      /* ── micro-helpers ── */
      function pd(id)      { var p = SN_IDX.prdLookup[id]  || {}; return str(p.PRDDESCR  || ''); }
      function pm(id)      { var p = SN_IDX.prdLookup[id]  || {}; return str(p.MATTYPEID || ''); }
      function ld(id)      { var l = SN_IDX.locLookup[id]  || {}; return str(l.LOCDESCR  || ''); }
      function locType(id) { var l = SN_IDX.locLookup[id]  || {}; return str(l.LOCTYPE   || ''); }
      function cd(id)      { var c = SN_IDX.custLookup[id] || {}; return str(c.CUSTDESCR || ''); }
      function yn(b)       { return b ? 'Sí' : 'No'; }
      function stLabel(f)  { return f === C_RED ? '\u26d4 Alerta' : f === C_YEL ? '\u26a0 Advertencia' : '\u2705 OK'; }

      /* ── Workbook ── */
      var wb    = new StreamingXlsx();
      var today = new Date().toISOString().slice(0, 10);
      var GOLD  = 'FFF7A800', ORANGE = 'FFE8622A', NAVY = 'FF0B1120';
      var C_RED = 'FFFFCCCC', C_YEL  = 'FFFFFFCC';
      var NA_DASH = '\u2014', NA_FILL = 'FFE5E7EB', NA_FONT = 'FF6B7280';
      var GRP = { control:'FFD1D5DB', ibp:'FFBAE6FD', flag:'FFFDE68A', metric:'FFA7F3D0', detail:'FF99F6E4' };
      var ROW_LIMIT = 900000;

      function cleanXml(v) {
        if (v == null) return v;
        if (typeof v !== 'string') return v;
        var s = v.replace(/[\uD800-\uDFFF]/g, '')
                 .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, '')
                 .trim();
        return s === '' ? null : s;
      }

      /* ── STATS (para Resumen) ── */
      var STATS = {};
      function initStat(name) { STATS[name] = { total: 0, red: 0, yel: 0, ok: 0 }; }

      /* ── Factory: grupo de hojas con auto-split, notas y grupos de color ── */
      function makeGroup(baseName, tabArgb, headers, notes, groups) {
        initStat(baseName);
        var sheetIdx = 0, allSheets = [], cur = null;

        function newSheet() {
          sheetIdx++;
          var name = sheetIdx === 1 ? baseName : baseName + ' (' + sheetIdx + ')';
          var ws = wb.addWorksheet(name, {
            views: [{ state: 'frozen', ySplit: 1 }],
            properties: { tabColor: { argb: tabArgb } }
          });
          var colW = headers.map(function (h) { return h.length; });
          cur = { ws: ws, rowCount: 0, colW: colW };
          allSheets.push(cur);
          ws.addRow(headers);
          ws.getRow(1).eachCell(function (cell, colNum) {
            var grpKey  = groups && groups[colNum - 1];
            var hdrFill = grpKey ? (GRP[grpKey] || GOLD) : GOLD;
            cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: hdrFill } };
            cell.font  = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = { bottom: { style: 'medium', color: { argb: ORANGE } } };
            var rawNote = notes && notes[colNum - 1];
            if (rawNote) { var safeNote = cleanXml(rawNote); try { if (safeNote) cell.note = safeNote; } catch(e) {} }
          });
          ws.getRow(1).height = 22;
        }
        newSheet();

        return {
          addRow: function (data, fill) {
            if (cur.rowCount >= ROW_LIMIT) newSheet();
            cur.rowCount++;
            var row = cur.ws.addRow(data.map(cleanXml));
            row.eachCell({ includeEmpty: true }, function (cell) {
              if (cell.value === NA_DASH) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NA_FILL } };
                cell.font = { name: 'DM Sans', size: 10, color: { argb: NA_FONT }, italic: true };
                return;
              }
              if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
            });
            data.forEach(function (v, ci) {
              if (v === NA_DASH) return;
              var len = v != null ? String(v).length : 0;
              if (len > cur.colW[ci]) cur.colW[ci] = len;
            });
            var s = STATS[baseName];
            if (s) { s.total++; if (fill === C_RED) s.red++; else if (fill === C_YEL) s.yel++; else s.ok++; }
          },
          checkSplit: function (margin) { if (cur.rowCount >= ROW_LIMIT - (margin || 0)) newSheet(); },
          finalize: function () {
            allSheets.forEach(function (sh) {
              sh.ws.columns.forEach(function (col, ci) {
                col.width = Math.min(Math.max((sh.colW[ci] || 10) + 2, 10), 60);
              });
            });
          }
        };
      }

      /* ── Hoja Resumen (se llena al final) ── */
      var s0hdr = ['#', 'Hoja', 'Total registros', 'Alertas 🔴', 'Advertencias 🟡', 'OK ✅', '% Consistencia'];
      var s0ws = wb.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 1 }], properties: { tabColor: { argb: 'FF34D399' } } });
      s0ws.addRow(s0hdr);
      s0ws.getRow(1).eachCell(function (cell) {
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
        cell.font  = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = { bottom: { style: 'medium', color: { argb: ORANGE } } };
      });
      s0ws.getRow(1).height = 20;
      var s0colW = s0hdr.map(function (h) { return h.length; });

      /* ── Crear grupos de hojas ── */
      var gPrd = makeGroup('Product', 'FF29ABE2', [
        'Estado','Observacion',
        'PRDID','PRDDESCR','MATTYPEID',
        'En PSH?','En PSI?','En Location Source?','En Customer Source?','En Location Product?','En Customer Product?','Solo en maestro?',
        'Estado de la Red','# Plantas','# DCs','# Clientes','# Rutas completas','Ruta mas larga','# Ghost Nodes','# Dead Ends',
        'Health Score','Categoria de salud','Detalle Calculo Health Score',
        '# Origenes (LOCFR)','Origenes (codigos)','# Destinos (LOCID)','Destinos (codigos)',
        '# Clientes en CustSrc','Clientes (codigos)','Multi-sourced?','TLT promedio (dias)','CLT promedio (dias)',
        '# Plantas aisladas'
      ],[
        'Color: \u26d4 Alerta = problema critico | \u26a0 Advertencia = dato incompleto | \u2705 OK = sin hallazgos.',
        'Detalle de validaciones. En estado OK lista las que pasaron.',
        'Codigo unico del producto (PRDID).',
        'Descripcion del producto segun maestro.',
        'Tipo de material SAP (MATTYPEID). Determina reglas de validacion por categoria.',
        'Si/No — tiene fuente de produccion (PSH) activa. Sin PSH = no se fabrica internamente.',
        'Si/No — aparece como componente en BOM de algun otro producto (PSI).',
        'Si/No — tiene arcos de transferencia entre ubicaciones (Location Source).',
        'Si/No — tiene arcos de entrega a cliente (Customer Source).',
        'Si/No — habilitado en al menos una ubicacion (Location Product). Sin esto IBP ignora el producto.',
        'Si/No — habilitado para al menos un cliente (Customer Product).',
        'Si/No — solo existe en el maestro, sin actividad en ninguna entidad de red.',
        'Estado logistico: Red Completa = tiene ruta de planta a cliente | Sin Entrega = tiene produccion pero no llega a cliente | Huerfano = sin actividad de red.',
        'Numero de plantas productoras (nodos con PSH) desde las que este producto puede originarse.',
        'Numero de centros de distribucion intermedios en la red del producto.',
        'Numero de clientes alcanzables a traves de rutas completas.',
        'Cantidad de rutas completas de planta a cliente. 0 = no llega a ningun cliente.',
        'Numero de saltos de la ruta mas larga de planta a cliente.',
        'Ubicaciones que reciben producto pero cuyas salidas no llegan a ningun cliente.',
        'Ubicaciones que reciben producto pero no tienen ninguna salida configurada.',
        'Puntaje de salud 0-100 calculado en base a completitud de rutas, anomalias y lead times.',
        'Clasificacion del puntaje: Healthy (\u226580) | Acceptable (\u226560) | Weak (\u226540) | Critical (<40).',
        'Desglose paso a paso del calculo: bonificaciones (+) y penalizaciones (-) que determinan el score final.',
        'Cantidad de ubicaciones origen distintas (LOCFR) en Location Source para este producto.',
        'Codigos de las ubicaciones origen separados por coma.',
        'Cantidad de ubicaciones destino distintas (LOCID) en Location Source para este producto.',
        'Codigos de las ubicaciones destino separados por coma.',
        'Cantidad de clientes distintos declarados en Customer Source para este producto.',
        'Codigos de los clientes en Customer Source separados por coma.',
        'Si/No — alguna ubicacion destino recibe este producto desde mas de un origen simultaneamente (multi-sourcing).',
        'Promedio de TLEADTIME (dias) para todos los arcos de Location Source de este producto. \u2014 si no hay arcos con lead time definido.',
        'Promedio de CLEADTIME (dias) para todos los arcos de Customer Source de este producto. \u2014 si no hay arcos con lead time definido.',
        'Cantidad de plantas que producen este producto pero no tienen ninguna ruta hasta algun cliente.'
      ],[
        'control','control',
        'ibp','ibp','ibp',
        'flag','flag','flag','flag','flag','flag','flag',
        'metric','metric','metric','metric','metric','metric','metric','metric',
        'metric','metric','metric',
        'detail','detail','detail','detail',
        'detail','detail','detail','detail','detail',
        'detail'
      ]);

      var gLoc = makeGroup('Location', 'FF06B6D4', [
        'Estado','Observacion',
        'LOCID','LOCDESCR','LOCTYPE','Rol inferido',
        'En PSH?','En Location Source?','En Customer Source?','En Location Product?','Solo en maestro?',
        '# Productos manejados','# Como origen (LOCFR)','# Como destino (LOCID)','# Clientes servidos',
        'Es nodo critico?','# Productos impactados','# Clientes impactados','Nivel de riesgo'
      ],[
        'Color: \u26d4 Alerta | \u26a0 Advertencia | \u2705 OK.',
        'Detalle de validaciones. En estado OK lista las que pasaron.',
        'Codigo unico de la ubicacion (LOCID).',
        'Descripcion de la ubicacion segun maestro.',
        'Tipo de ubicacion SAP (LOCTYPE). Informativo; el rol real se infiere del comportamiento en los datos.',
        'Rol inferido del comportamiento en los datos: Planta con Entrega = PSH + CustSrc | Planta = solo PSH | DC con Entrega Directa = LocSrc + CustSrc | DC = solo LocSrc | Punto de Entrega = solo CustSrc | Sin rol activo = sin presencia en red.',
        'Si/No — tiene al menos una fuente de produccion (PSH) en esta ubicacion.',
        'Si/No — aparece como origen o destino en Location Source.',
        'Si/No — aparece como ubicacion de entrega en Customer Source.',
        'Si/No — habilitada en Location Product. Sin esto IBP no planifica en esta ubicacion.',
        'Si/No — solo en maestro, sin actividad en red.',
        'Total de productos distintos que pasan por esta ubicacion (como origen o destino en LocSrc).',
        'Productos para los que esta ubicacion actua como origen (LOCFR) en Location Source.',
        'Productos para los que esta ubicacion actua como destino (LOCID) en Location Source.',
        'Clientes que pueden ser abastecidos desde esta ubicacion via Customer Source.',
        'Si/No — su eliminacion cortaria rutas de multiples productos a clientes.',
        'Numero de productos cuyas rutas pasan por este nodo critico.',
        'Numero de clientes cuyo abastecimiento depende de este nodo.',
        'Critical (\u22654 productos) | High (2\u20133) | Medium (1).'
      ],[
        'control','control',
        'ibp','ibp','ibp','ibp',
        'flag','flag','flag','flag','flag',
        'metric','metric','metric','metric',
        'metric','metric','metric','metric'
      ]);

      var gCust = makeGroup('Customer', 'FF10B981', [
        'Estado','Observacion',
        'CUSTID','CUSTDESCR',
        'En Customer Source?','En Customer Product?','Solo en maestro?',
        '# Productos recibidos','# Ubicaciones proveedoras','# Paths que llegan','Resiliencia predominante'
      ],[
        'Color: \u26d4 Alerta | \u26a0 Advertencia | \u2705 OK.',
        'Detalle de validaciones. En estado OK lista las que pasaron.',
        'Codigo unico del cliente (CUSTID).',
        'Descripcion del cliente segun maestro.',
        'Si/No — tiene al menos un arco de entrega configurado (Customer Source).',
        'Si/No — habilitado en Customer Product. Sin esto IBP ignora el cliente en planificacion.',
        'Si/No — solo en maestro, sin arcos de entrega.',
        'Numero de productos distintos que este cliente puede recibir segun Customer Source.',
        'Numero de ubicaciones desde las que se despacha al cliente.',
        'Total de rutas completas de planta a este cliente sumadas para todos sus productos.',
        'Single Path = algún producto llega solo por una ruta | Single Node Dependency = hay un nodo unico que si falla corta el abastecimiento | Resilient = todos los productos tienen rutas alternativas.'
      ],[
        'control','control',
        'ibp','ibp',
        'flag','flag','flag',
        'metric','metric','metric','metric'
      ]);

      var gLS = makeGroup('Location Source', 'FFF7A800', [
        'Estado','Observacion',
        'PRDID','PRDDESCR','MATTYPEID','LOCFR','LOCFR Descripcion','LOCID','LOCID Descripcion','TLEADTIME',
        'LOCFR+PRDID en Location Product?','LOCID+PRDID en Location Product?','PRDID en PSH?',
        'Arco en ruta completa?','Arco inverso?','Lead Time Status','SPOF arco?'
      ],[
        'Color: \u26d4 Alerta | \u26a0 Advertencia | \u2705 OK.',
        'Detalle de validaciones. En estado OK lista las que pasaron.',
        'Producto transferido en este arco.',
        'Descripcion del producto.',
        'Tipo de material del producto (MATTYPEID).',
        'Ubicacion de origen (LOCFR) del arco de transferencia.',
        'Descripcion de la ubicacion origen.',
        'Ubicacion de destino (LOCID) del arco de transferencia.',
        'Descripcion de la ubicacion destino.',
        'Lead time de transferencia en dias. 0 o vacio = \u26a0 Advertencia.',
        'Si/No — el origen esta habilitado para este producto en Location Product.',
        'Si/No — el destino esta habilitado para este producto en Location Product.',
        'Si/No — el producto tiene produccion propia (PSH) en alguna planta.',
        'Si/No — este arco pertenece a al menos una ruta completa que llega a un cliente.',
        'Si/No — existe un arco configurado en la direccion opuesta (LOCID->LOCFR) para el mismo producto.',
        'OK = lead time > 0 | Zero = TLEADTIME = 0 | Missing = sin valor.',
        'Si/No — SPOF: este LOCID tiene un unico LOCFR para este producto. Si falla el origen, el destino queda sin abastecimiento.'
      ],[
        'control','control',
        'ibp','ibp','ibp','ibp','ibp','ibp','ibp','ibp',
        'flag','flag','flag',
        'metric','metric','metric','metric'
      ]);

      var gCS = makeGroup('Customer Source', 'FFE8622A', [
        'Estado','Observacion',
        'PRDID','PRDDESCR','MATTYPEID','LOCID','LOCID Descripcion','CUSTID','CUSTID Descripcion','CLEADTIME',
        'LOCID+PRDID en Location Product?','CUSTID+PRDID en Customer Product?','PRDID en PSH?',
        'Entrega alcanzable desde produccion?','Lead Time Status'
      ],[
        'Color: \u26d4 Alerta | \u26a0 Advertencia | \u2705 OK.',
        'Detalle de validaciones. En estado OK lista las que pasaron.',
        'Producto entregado al cliente en este arco.',
        'Descripcion del producto.',
        'Tipo de material del producto (MATTYPEID).',
        'Ubicacion de despacho (LOCID) desde la que sale el producto al cliente.',
        'Descripcion de la ubicacion de despacho.',
        'Cliente receptor (CUSTID).',
        'Descripcion del cliente.',
        'Lead time de entrega al cliente en dias. 0 o vacio = \u26a0 Advertencia.',
        'Si/No — la ubicacion de despacho esta habilitada para este producto en Location Product.',
        'Si/No — el cliente esta habilitado para este producto en Customer Product.',
        'Si/No — el producto tiene produccion propia (PSH) en alguna planta de la red.',
        'Si/No — existe una ruta completa de produccion hasta esta entrega al cliente.',
        'OK = lead time > 0 | Zero = CLEADTIME = 0 | Missing = sin valor.'
      ],[
        'control','control',
        'ibp','ibp','ibp','ibp','ibp','ibp','ibp','ibp',
        'flag','flag','flag',
        'metric','metric'
      ]);


      /* ════════════════════════════════════════════════════════════════
         FASE 2 — Pre-índices globales (cursor IDB, sin acumular arrays)
         ════════════════════════════════════════════════════════════════ */
      if (onStatus) onStatus('Construyendo índices globales...');
      if (logEl) log(logEl, 'info', timer.fmt() + ' Fase 2: pre-índices...');

      var locProdSet  = new Set();   // "LOCID|PRDID"
      var custProdSet = new Set();   // "CUSTID|PRDID"
      var lsArcSet    = new Set();   // "PRDID|LOCFR|LOCID" — para detección de arco inverso
      var prdInLocSrc = {}, prdInCustSrc = {};
      var locInLocSrc = {}, locInCustSrc = {}, locInPSH = {}, locInLocProd = {};
      var custInCustSrc = {}, custInCustProd = {};
      var prdInLocProd = {}, prdInCustProd = {};

      /* Índices para nuevas columnas */
      var locSrcPrdIdx  = {};  // PRDID → { origins:{}, dests:{}, tltSum, tltCount }
      var custSrcPrdIdx = {};  // PRDID → { custs:{}, cltSum, cltCount }
      var originsPerDest = {}; // "PRDID|LOCID" → count of LOCFR (SPOF check)

      /* Contadores de arcos por ubicación (para hoja Location) */
      var locStatsSrc = {};
      function ensureLS(l) {
        if (!locStatsSrc[l]) locStatsSrc[l] = { asOriginPrds: {}, asDestPrds: {}, custServed: {} };
      }
      /* Contadores por cliente (para hoja Customer) */
      var custStatsSrc = {};

      await idbCursorEach('sn_loc', function (r) {
        var p = str(r.PRDID), fr = str(r.LOCFR), to = str(r.LOCID), tlt = str(r.TLEADTIME || '');
        if (p)  prdInLocSrc[p] = true;
        if (fr) { locInLocSrc[fr] = true; ensureLS(fr); if (p) locStatsSrc[fr].asOriginPrds[p] = true; }
        if (to) { locInLocSrc[to] = true; ensureLS(to); if (p) locStatsSrc[to].asDestPrds[p]   = true; }
        if (p && fr && to) lsArcSet.add(p + '|' + fr + '|' + to);
        if (p) {
          if (!locSrcPrdIdx[p]) locSrcPrdIdx[p] = { origins: {}, dests: {}, tltSum: 0, tltCount: 0 };
          if (fr) locSrcPrdIdx[p].origins[fr] = true;
          if (to) {
            locSrcPrdIdx[p].dests[to] = true;
            var od = p + '|' + to;
            originsPerDest[od] = (originsPerDest[od] || 0) + 1;
          }
          var tltNum = parseFloat(tlt);
          if (tltNum > 0) { locSrcPrdIdx[p].tltSum += tltNum; locSrcPrdIdx[p].tltCount++; }
        }
      });

      await idbCursorEach('sn_cust', function (r) {
        var p = str(r.PRDID), loc = str(r.LOCID), c = str(r.CUSTID), clt = str(r.CLEADTIME || '');
        if (p)   prdInCustSrc[p] = true;
        if (loc) { locInCustSrc[loc] = true; ensureLS(loc); if (c) locStatsSrc[loc].custServed[c] = true; }
        if (c)   {
          custInCustSrc[c] = true;
          if (!custStatsSrc[c]) custStatsSrc[c] = { prds: {}, locs: {} };
          if (p)   custStatsSrc[c].prds[p]   = true;
          if (loc) custStatsSrc[c].locs[loc] = true;
        }
        if (p && c) {
          if (!custSrcPrdIdx[p]) custSrcPrdIdx[p] = { custs: {}, cltSum: 0, cltCount: 0 };
          custSrcPrdIdx[p].custs[c] = true;
          var cltNum = parseFloat(clt);
          if (cltNum > 0) { custSrcPrdIdx[p].cltSum += cltNum; custSrcPrdIdx[p].cltCount++; }
        }
      });

      await idbCursorEach('sn_plant', function (r) {
        var loc = str(r.LOCID); if (loc) locInPSH[loc] = true;
      });

      await idbCursorEach('sn_loc_prod', function (r) {
        var loc = str(r.LOCID), p = str(r.PRDID);
        if (loc && p) { locProdSet.add(loc + '|' + p); prdInLocProd[p] = true; locInLocProd[loc] = true; }
      });

      await idbCursorEach('sn_cust_prod', function (r) {
        var c = str(r.CUSTID), p = str(r.PRDID);
        if (c && p) { custProdSet.add(c + '|' + p); prdInCustProd[p] = true; custInCustProd[c] = true; }
      });

      if (onProgress) onProgress(57);
      if (logEl) log(logEl, 'ok', timer.fmt() + ' Pre-índices: LocProd=' + locProdSet.size + ' CustProd=' + custProdSet.size);

      /* KPI: promedios globales TLT y CLT (calculados sobre los índices ya populados) */
      var _kpiTltTotal = 0, _kpiTltN = 0, _kpiCltTotal = 0, _kpiCltN = 0;
      Object.keys(locSrcPrdIdx).forEach(function(p) { _kpiTltTotal += locSrcPrdIdx[p].tltSum; _kpiTltN += locSrcPrdIdx[p].tltCount; });
      Object.keys(custSrcPrdIdx).forEach(function(p) { _kpiCltTotal += custSrcPrdIdx[p].cltSum; _kpiCltN += custSrcPrdIdx[p].cltCount; });
      var kpi_avgTlt = _kpiTltN > 0 ? parseFloat((_kpiTltTotal / _kpiTltN).toFixed(1)) : null;
      var kpi_avgClt = _kpiCltN > 0 ? parseFloat((_kpiCltTotal / _kpiCltN).toFixed(1)) : null;

      /* ════════════════════════════════════════════════════════════════
         FASE 3 — Loop de productos (CHUNK=50, yield entre batches)
         ════════════════════════════════════════════════════════════════ */
      /* Universo: allPrds (LocSrc/CustSrc/PSH) + psiCompPrds + prdLookup */
      var allPrdObj = Object.assign({}, SN_IDX.allPrds, SN_IDX.psiCompPrds);
      Object.keys(SN_IDX.prdLookup).forEach(function (p) { allPrdObj[p] = true; });
      var products = Object.keys(allPrdObj).sort();
      var n = products.length;

      /* Acumuladores del loop */
      var locStats   = {};    // locid → { isGhost, isDeadEnd, isIsolated, inCycle, cycleDescs, isCritical, ... }
      var custStats  = {};    // custid → { pathCount, prdCount, single, dep, resilient }
      var critNodeMap = {};
      var cycleLocSet = {};
      var arcInCompletePath = {};  // "LS|FR|TO|PRD" o "CS|LOC|CUST|PRD"

      var completeCount = 0, totalPaths = 0, ghostCount = 0, healthSum = 0;
      var CHUNK = 50;

      for (var i = 0; i < n; i += CHUNK) {
        var batch = products.slice(i, Math.min(i + CHUNK, n));

        for (var bi = 0; bi < batch.length; bi++) {
          var prdid = batch[bi];
          var inPSH = !!SN_IDX.pshPrds[prdid];
          var inPSI = !!SN_IDX.psiCompPrds[prdid];
          var inLS  = !!prdInLocSrc[prdid];
          var inCS  = !!prdInCustSrc[prdid];
          var inLP  = !!prdInLocProd[prdid];
          var inCP  = !!prdInCustProd[prdid];
          var onlyMaster = !inPSH && !inPSI && !inLS && !inCS && !inLP && !inCP;

          if (typeof mattypeIsExcluded === 'function' && mattypeIsExcluded(pm(prdid))) continue;

          var graph     = await snBuildProductGraph(prdid);
          var paths     = snFindAllPaths(graph);
          var sets      = snComputeNetworkSets(graph);
          var ghosts    = snFindGhostNodes(graph, sets);
          var deadEnds  = snFindDeadEnds(graph);
          var isoPlants = snFindIsolatedPlants(graph, sets);
          var cycles    = snFindCycles(graph);
          var ltIssues  = snFindMissingLeadTimes(graph);
          var metrics   = snComputeMetrics(prdid, graph, paths, ghosts, deadEnds);
          var resData   = snAnalyzeResilience(prdid, graph, paths);
          var health    = snComputeHealthScore(metrics, paths, ghosts, deadEnds);

          /* ── Estado de la Red ── */
          var networkStatus;
          if (onlyMaster) {
            networkStatus = 'Huérfano';
          } else if (inPSH) {
            networkStatus = paths.length > 0 ? 'Red Completa'
              : inCS ? 'Distribución sin ruta completa'
              : inLS ? 'Sin Entrega a Cliente'
              : 'Sin Distribución';
          } else if (inPSI) {
            if (!inLS) { networkStatus = 'Sin Abastecimiento'; }
            else {
              var reachesPlant = graph.allLocations.some(function (l) { return locInPSH[l]; });
              networkStatus = reachesPlant ? 'Abastecimiento Completo' : 'Abastecimiento Parcial';
            }
          } else {
            networkStatus = (inLS && inCS) ? 'Solo Distribución + Entrega'
              : inLS ? 'Solo Distribución'
              : inCS ? 'Solo Entrega'
              : 'Sin arcos de red';
          }

          /* ── Observaciones ── */
          var obs = [];
          if (paths._truncated)  obs.push('Paths truncados (>50.000, red muy compleja)');
          cycles.forEach(function (c)   { obs.push('Ciclo: ' + c); });
          ghosts.forEach(function (l)   { obs.push('Ghost node: ' + l); });
          deadEnds.forEach(function (l) { obs.push('Dead-end: ' + l); });
          isoPlants.forEach(function(l) { obs.push('Planta aislada: ' + l); });
          ltIssues.forEach(function (lt) {
            if (lt.type === 'plant') obs.push('PLEADTIME faltante: ' + lt.loc);
            else if (lt.type === 'loc')  obs.push('TLEADTIME faltante: ' + lt.from + '->' + lt.to);
            else                         obs.push('CLEADTIME faltante: ' + lt.from + '->' + lt.to);
          });
          if (!inLP && (inPSH || inLS)) obs.push('Sin Location Product');
          if (!inCP && inCS)            obs.push('Sin Customer Product');
          if (health.score < 60)        obs.push('Health score bajo: ' + health.score + '/100 (' + health.category + ')');

          /* ── Semáforo Product ── */
          var RED_ST  = { 'Hu\u00e9rfano': 1, 'Sin Distribuci\u00f3n': 1, 'Sin Abastecimiento': 1, 'Sin Entrega a Cliente': 1 };
          var YEL_ST  = { 'Abastecimiento Parcial': 1, 'Solo Distribuci\u00f3n': 1, 'Solo Entrega': 1,
                          'Distribuci\u00f3n sin ruta completa': 1, 'Solo Distribuci\u00f3n + Entrega': 1, 'Sin arcos de red': 1 };
          var pFill = (RED_ST[networkStatus] || cycles.length > 0) ? C_RED
            : (YEL_ST[networkStatus] || health.score < 60 || (!inLP && (inPSH || inLS)) || (!inCP && inCS)) ? C_YEL
            : null;

          var pObs;
          if (!obs.length) {
            var okParts = ['Red completa sin anomalias'];
            if (inLP)                      okParts.push('Habilitado en Location Product');
            if (inCP && inCS)              okParts.push('Habilitado en Customer Product');
            if (ltIssues.length === 0)     okParts.push('Lead times definidos');
            if (metrics.paths > 0)         okParts.push(metrics.paths + ' ruta(s) a cliente');
            pObs = okParts.join(' | ');
          } else {
            pObs = obs.join(' | ');
          }

          var _lsPrd = locSrcPrdIdx[prdid]  || { origins: {}, dests: {}, tltSum: 0, tltCount: 0 };
          var _csPrd = custSrcPrdIdx[prdid] || { custs: {}, cltSum: 0, cltCount: 0 };
          var _numOrigins = Object.keys(_lsPrd.origins).length;
          var _origCodes  = _numOrigins ? Object.keys(_lsPrd.origins).join(', ') : NA_DASH;
          var _numDests   = Object.keys(_lsPrd.dests).length;
          var _destCodes  = _numDests   ? Object.keys(_lsPrd.dests).join(', ')   : NA_DASH;
          var _numCustCS  = Object.keys(_csPrd.custs).length;
          var _custCodes  = _numCustCS  ? Object.keys(_csPrd.custs).join(', ')   : NA_DASH;
          var _isMulti    = Object.keys(_lsPrd.dests).some(function(to) { return (originsPerDest[prdid + '|' + to] || 0) > 1; });
          var _tltAvg     = _lsPrd.tltCount > 0 ? parseFloat((_lsPrd.tltSum / _lsPrd.tltCount).toFixed(1)) : NA_DASH;
          var _cltAvg     = _csPrd.cltCount > 0 ? parseFloat((_csPrd.cltSum / _csPrd.cltCount).toFixed(1)) : NA_DASH;
          var _nIsoPlants = isoPlants.length;

          gPrd.addRow([
            stLabel(pFill), pObs,
            prdid, pd(prdid), pm(prdid),
            yn(inPSH), yn(inPSI), yn(inLS), yn(inCS), yn(inLP), yn(inCP), yn(onlyMaster),
            networkStatus, metrics.plants, metrics.dcs, metrics.customers,
            metrics.paths, metrics.longestPath, metrics.ghosts, metrics.deadEnds,
            health.score, health.category, health.detail,
            _numOrigins || NA_DASH, _origCodes, _numDests || NA_DASH, _destCodes,
            _numCustCS  || NA_DASH, _custCodes, yn(_isMulti), _tltAvg, _cltAvg,
            _nIsoPlants > 0 ? _nIsoPlants : NA_DASH
          ], pFill);

          if (paths.length > 0) completeCount++;
          totalPaths += paths.length;
          healthSum  += health.score || 0;
          ghostCount += ghosts.length;

          /* ── Acumular locStats (topología) ── */
          ghosts.forEach(function (l)    { if (!locStats[l]) locStats[l] = {}; locStats[l].isGhost    = true; });
          deadEnds.forEach(function (l)  { if (!locStats[l]) locStats[l] = {}; locStats[l].isDeadEnd  = true; });
          isoPlants.forEach(function (l) { if (!locStats[l]) locStats[l] = {}; locStats[l].isIsolated = true; });
          cycles.forEach(function (cStr) {
            cStr.split(' → ').forEach(function (loc) {
              if (!loc) return;
              cycleLocSet[loc] = true;
              if (!locStats[loc]) locStats[loc] = {};
              locStats[loc].inCycle = true;
              if (!locStats[loc].cycleDescs) locStats[loc].cycleDescs = [];
              if (locStats[loc].cycleDescs.length < 3 && locStats[loc].cycleDescs.indexOf(cStr) < 0)
                locStats[loc].cycleDescs.push(cStr);
            });
          });

          /* ── Acumular custStats + critNodeMap ── */
          resData.forEach(function (r) {
            if (!custStats[r.custid]) custStats[r.custid] = { pathCount: 0, prdCount: 0, single: 0, dep: 0, resilient: 0 };
            custStats[r.custid].pathCount += r.pathCount;
            custStats[r.custid].prdCount++;
            if (r.category === 'Single Path')                custStats[r.custid].single++;
            else if (r.category === 'Single Node Dependency') custStats[r.custid].dep++;
            else                                              custStats[r.custid].resilient++;
            r.criticalNodes.forEach(function (node) {
              if (!critNodeMap[node]) critNodeMap[node] = { products: {}, customers: {} };
              critNodeMap[node].products[prdid]     = true;
              critNodeMap[node].customers[r.custid] = true;
            });
          });

          /* ── Acumular arcInCompletePath ── */
          paths.forEach(function (p) {
            if (!p.customer) return;
            for (var k = 0; k < p.nodes.length - 1; k++)
              arcInCompletePath['LS|' + p.nodes[k] + '|' + p.nodes[k + 1] + '|' + prdid] = true;
            arcInCompletePath['CS|' + p.nodes[p.nodes.length - 1] + '|' + p.customer + '|' + prdid] = true;
          });

          /* Liberar para GC inmediato */
          graph = null; paths = null; ghosts = null; deadEnds = null;
          cycles = null; ltIssues = null; metrics = null; resData = null; health = null;
        }

        await new Promise(function (r) { setTimeout(r, 0); });
        var done = Math.min(i + CHUNK, n);
        if (onProgress) onProgress(57 + Math.round((done / n) * 28));
        if (onStatus)   onStatus('Analizando ' + done + '/' + n + ' productos...');
        if (logEl && i > 0 && i % 500 === 0)
          log(logEl, 'info', timer.fmt() + ' Analizados ' + done + '/' + n + '...');
      }

      var kpi_pctComplete = n > 0 ? Math.round(completeCount / n * 100) : 0;
      var kpi_avgHealth   = n > 0 ? Math.round(healthSum   / n)        : 0;

      /* ════════════════════════════════════════════════════════════════
         FASE 4 — Hoja Location
         ════════════════════════════════════════════════════════════════ */
      if (onStatus) onStatus('Escribiendo hoja Location...');

      /* Integrar critNodeMap en locStats */
      Object.keys(critNodeMap).forEach(function (loc) {
        if (!locStats[loc]) locStats[loc] = {};
        var d = critNodeMap[loc];
        locStats[loc].isCritical        = true;
        locStats[loc].productsImpacted  = Object.keys(d.products).length;
        locStats[loc].customersImpacted = Object.keys(d.customers).length;
        locStats[loc].riskLevel = locStats[loc].productsImpacted > 3 ? 'Critical'
          : locStats[loc].productsImpacted > 1 ? 'High' : 'Medium';
      });
      critNodeMap = null;

      var allLocObj = Object.assign({}, SN_IDX.locLookup, locInLocSrc, locInCustSrc, locInPSH, locInLocProd);
      Object.keys(allLocObj).sort().forEach(function (locid) {
        var inPSHL   = !!locInPSH[locid];
        var inLSL    = !!locInLocSrc[locid];
        var inCSL    = !!locInCustSrc[locid];
        var inLPL    = !!locInLocProd[locid];
        var onlyMstL = !inPSHL && !inLSL && !inCSL && !inLPL;

        var lSt  = locStats[locid]    || {};
        var lSrc = locStatsSrc[locid] || { asOriginPrds: {}, asDestPrds: {}, custServed: {} };

        var numPrd    = Object.keys(Object.assign({}, lSrc.asOriginPrds, lSrc.asDestPrds)).length;
        var numOrigin = Object.keys(lSrc.asOriginPrds).length;
        var numDest   = Object.keys(lSrc.asDestPrds).length;
        var numCust   = Object.keys(lSrc.custServed).length;

        var lobs = [];
        if (lSt.isGhost)    lobs.push('Ghost node (alimentado sin salida util)');
        if (lSt.isDeadEnd)  lobs.push('Dead-end (recibe pero no reenvía)');
        if (lSt.isIsolated) lobs.push('Planta aislada (sin ruta a ningun cliente)');
        if (lSt.inCycle && lSt.cycleDescs) lobs.push('Participa en ciclo: ' + lSt.cycleDescs[0]);
        if (!inLPL && (inLSL || inPSHL))   lobs.push('Sin Location Product');
        if (lSt.isCritical) lobs.push('Nodo critico: ' + lSt.productsImpacted + ' prod, ' + lSt.customersImpacted + ' clientes');

        var lFill = (lSt.isGhost || lSt.isDeadEnd || lSt.isIsolated || lSt.inCycle || (!inLPL && (inLSL || inPSHL))) ? C_RED
          : (onlyMstL || lSt.isCritical) ? C_YEL : null;

        var lObsStr;
        if (!lobs.length) {
          var lOkParts = ['Sin anomalias topologicas'];
          if (inLPL)         lOkParts.push('Habilitado en Location Product');
          if (numCust > 0)   lOkParts.push(numCust + ' cliente(s) servido(s)');
          if (numOrigin > 0) lOkParts.push('Activo como origen para ' + numOrigin + ' producto(s)');
          lObsStr = lOkParts.join(' | ');
        } else { lObsStr = lobs.join(' | '); }

        var _locRole = (inPSHL && inCSL) ? 'Planta con Entrega'
          : inPSHL ? 'Planta'
          : (inLSL && inCSL) ? 'DC con Entrega Directa'
          : inLSL ? 'DC'
          : inCSL ? 'Punto de Entrega'
          : 'Sin rol activo';

        gLoc.addRow([
          stLabel(lFill), lObsStr,
          locid, ld(locid), locType(locid), _locRole,
          yn(inPSHL), yn(inLSL), yn(inCSL), yn(inLPL), yn(onlyMstL),
          numPrd, numOrigin, numDest, numCust,
          yn(!!lSt.isCritical), lSt.productsImpacted || '', lSt.customersImpacted || '', lSt.riskLevel || ''
        ], lFill);
      });
      locStats = null; locStatsSrc = null;
      if (onProgress) onProgress(88);

      /* ════════════════════════════════════════════════════════════════
         FASE 5 — Hoja Customer
         ════════════════════════════════════════════════════════════════ */
      if (onStatus) onStatus('Escribiendo hoja Customer...');

      var allCustObj = Object.assign({}, SN_IDX.custLookup, custInCustSrc, custInCustProd);
      Object.keys(allCustObj).sort().forEach(function (custid) {
        var inCS2  = !!custInCustSrc[custid];
        var inCP2  = !!custInCustProd[custid];
        var onlyM2 = !inCS2 && !inCP2;

        var cSrc = custStatsSrc[custid] || { prds: {}, locs: {} };
        var cSt  = custStats[custid]    || { pathCount: 0, prdCount: 0, single: 0, dep: 0, resilient: 0 };

        var numPrd2 = Object.keys(cSrc.prds).length;
        var numLoc2 = Object.keys(cSrc.locs).length;
        var domRes  = cSt.single > 0 ? 'Single Path'
          : cSt.dep > 0 ? 'Single Node Dependency'
          : cSt.prdCount > 0 ? 'Resilient' : '-';

        var cobs = [];
        if (onlyM2)               cobs.push('Solo en maestro, sin uso en red');
        if (!inCP2 && inCS2)      cobs.push('Sin Customer Product');
        if (cSt.single > 0)       cobs.push(cSt.single + ' producto(s) con unica ruta');
        if (cSt.dep > 0)          cobs.push(cSt.dep + ' producto(s) con nodo critico unico');
        if (!onlyM2 && numPrd2 === 0) cobs.push('Sin productos alcanzables desde produccion');

        var cFill = (onlyM2 || (!onlyM2 && numPrd2 === 0)) ? C_RED
          : (!inCP2 && inCS2 || cSt.single > 0) ? C_YEL : null;

        var cObsStr;
        if (!cobs.length) {
          var cOkParts = ['Abastecido con rutas resilientes'];
          if (inCP2)           cOkParts.push('Habilitado en Customer Product');
          if (numPrd2 > 0)     cOkParts.push(numPrd2 + ' producto(s) alcanzables');
          if (cSt.pathCount > 0) cOkParts.push(cSt.pathCount + ' ruta(s) configuradas');
          cObsStr = cOkParts.join(' | ');
        } else { cObsStr = cobs.join(' | '); }

        gCust.addRow([
          stLabel(cFill), cObsStr,
          custid, cd(custid),
          yn(inCS2), yn(inCP2), yn(onlyM2),
          numPrd2, numLoc2, cSt.pathCount, domRes
        ], cFill);
      });
      var kpi_totalCusts = Object.keys(custStats).length;
      var kpi_resilCusts = 0;
      Object.keys(custStats).forEach(function(cid) {
        var cs = custStats[cid];
        if (cs.prdCount > 0 && cs.single === 0 && cs.dep === 0) kpi_resilCusts++;
      });
      var kpi_pctResil = kpi_totalCusts > 0 ? Math.round(kpi_resilCusts / kpi_totalCusts * 100) : 0;
      custStats = null; custStatsSrc = null;
      if (onProgress) onProgress(91);

      /* ════════════════════════════════════════════════════════════════
         FASE 6 — Hoja Location Source (cursor IDB, sin acumular array)
         ════════════════════════════════════════════════════════════════ */
      if (onStatus) onStatus('Escribiendo hoja Location Source...');
      var lsSeenArcs = new Set();  // para detectar duplicados en esta pasada

      await idbCursorEach('sn_loc', function (r) {
        var p  = str(r.PRDID), fr = str(r.LOCFR), to = str(r.LOCID), tlt = str(r.TLEADTIME || '');
        if (!p || !fr || !to) return;
        if (typeof mattypeIsExcluded === 'function' && mattypeIsExcluded(pm(p))) return;

        var arcKey   = p + '|' + fr + '|' + to;
        var isDup    = lsSeenArcs.has(arcKey);
        lsSeenArcs.add(arcKey);
        var isInv    = lsArcSet.has(p + '|' + to + '|' + fr);
        var inLPFr   = locProdSet.has(fr + '|' + p);
        var inLPTo   = locProdSet.has(to + '|' + p);
        var pInPSH   = !!SN_IDX.pshPrds[p];
        var inPath   = !!arcInCompletePath['LS|' + fr + '|' + to + '|' + p];
        var ltNum    = parseFloat(tlt);
        var ltSt     = !tlt ? 'Missing' : (ltNum === 0 ? 'Zero' : 'OK');

        var lsObs = [];
        if (!inLPFr) lsObs.push('Sin Location Product en origen (' + fr + ')');
        if (!inLPTo) lsObs.push('Sin Location Product en destino (' + to + ')');
        if (isDup)   lsObs.push('Arco duplicado en el dataset');
        if (isInv)   lsObs.push('Existe arco inverso (' + to + '->' + fr + ')');
        if (ltSt !== 'OK') lsObs.push('TLEADTIME ' + ltSt.toLowerCase());

        var lsFill = (!inLPFr || !inLPTo || isDup) ? C_RED
          : (isInv || ltSt !== 'OK') ? C_YEL : null;

        var lsObsStr = lsObs.length
          ? lsObs.join(' | ')
          : 'Arco valido | Location Product en origen y destino | TLEADTIME definido' + (inPath ? ' | En ruta completa' : '');

        var isSpof = (originsPerDest[p + '|' + to] || 0) === 1;
        gLS.addRow([
          stLabel(lsFill), lsObsStr,
          p, pd(p), pm(p), fr, ld(fr), to, ld(to), tlt,
          yn(inLPFr), yn(inLPTo), yn(pInPSH),
          yn(inPath), yn(isInv), ltSt, yn(isSpof)
        ], lsFill);
      });
      lsSeenArcs = null; lsArcSet = null; originsPerDest = null;
      if (onProgress) onProgress(94);

      /* ════════════════════════════════════════════════════════════════
         FASE 7 — Hoja Customer Source (cursor IDB)
         ════════════════════════════════════════════════════════════════ */
      if (onStatus) onStatus('Escribiendo hoja Customer Source...');

      await idbCursorEach('sn_cust', function (r) {
        var p   = str(r.PRDID), loc = str(r.LOCID), c = str(r.CUSTID), clt = str(r.CLEADTIME || '');
        if (!p || !loc || !c) return;
        if (typeof mattypeIsExcluded === 'function' && mattypeIsExcluded(pm(p))) return;

        var inLPLoc  = locProdSet.has(loc + '|' + p);
        var inCPCust = custProdSet.has(c + '|' + p);
        var pInPSH2  = !!SN_IDX.pshPrds[p];
        var inPath2  = !!arcInCompletePath['CS|' + loc + '|' + c + '|' + p];
        var ltNum2   = parseFloat(clt);
        var ltSt2    = !clt ? 'Missing' : (ltNum2 === 0 ? 'Zero' : 'OK');

        var csObs = [];
        if (!inLPLoc)               csObs.push('Sin Location Product en ubicacion (' + loc + ')');
        if (!inCPCust)              csObs.push('Sin Customer Product para cliente (' + c + ')');
        if (!inPath2 && pInPSH2)    csObs.push('Entrega no alcanzable desde produccion');
        if (ltSt2 !== 'OK')         csObs.push('CLEADTIME ' + ltSt2.toLowerCase());

        var csFill = (!inLPLoc || !inCPCust) ? C_RED
          : (ltSt2 !== 'OK' || (!inPath2 && pInPSH2)) ? C_YEL : null;

        var csObsStr = csObs.length
          ? csObs.join(' | ')
          : 'Entrega alcanzable | Location Product y Customer Product configurados | CLEADTIME definido';

        gCS.addRow([
          stLabel(csFill), csObsStr,
          p, pd(p), pm(p), loc, ld(loc), c, cd(c), clt,
          yn(inLPLoc), yn(inCPCust), yn(pInPSH2),
          yn(inPath2), ltSt2
        ], csFill);
      });
      arcInCompletePath = null; locProdSet = null; custProdSet = null;
      if (onProgress) onProgress(96);

      /* ════════════════════════════════════════════════════════════════
         FASE 7c — Hoja Tipos Excluidos
         ════════════════════════════════════════════════════════════════ */
      if (onStatus) onStatus('Escribiendo hoja Tipos Excluidos...');
      var exclHdr = ['MATTYPEID','Descripcion (cat.)','Categoria IBP','# Productos','Estado'];
      var exclWs = wb.addWorksheet('Tipos Excluidos', {
        views: [{ state: 'frozen', ySplit: 1 }],
        properties: { tabColor: { argb: 'FFa78bfa' } }
      });
      exclWs.addRow(exclHdr);
      exclWs.getRow(1).eachCell(function (cell) {
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
        cell.font  = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { bottom: { style: 'medium', color: { argb: ORANGE } } };
      });
      exclWs.getRow(1).height = 22;
      var exclColW = exclHdr.map(function(h) { return h.length; });

      var CAT_LABELS = { finished: 'Producto Terminado', semi: 'Semiterminado', rawmat: 'Mat. Prima / Insumo', trading: 'Mercadería' };
      var exclEntries = Object.keys(MATTYPE_CFG).filter(function(k) { return MATTYPE_CFG[k].excluded; });
      if (exclEntries.length === 0) {
        var noExclRow = exclWs.addRow(['(ninguno)', 'No se excluyeron tipos de material en este análisis.', '', '', '']);
        noExclRow.eachCell(function(cell) { cell.font = { italic: true, name: 'DM Sans', size: 10, color: { argb: NA_FONT } }; });
      } else {
        exclEntries.forEach(function(k) {
          var cfg = MATTYPE_CFG[k];
          var cats = cfg.categories && cfg.categories.size > 0 ? Array.from(cfg.categories).map(function(c) { return CAT_LABELS[c] || c; }).join(', ') : '—';
          var row = [k, cats, 'Excluido', cfg.count || 0, 'Excluido del análisis'];
          var exRow = exclWs.addRow(row);
          exRow.eachCell(function(cell) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_YEL } }; });
          row.forEach(function(v, ci) { var len = v != null ? String(v).length : 0; if (len > exclColW[ci]) exclColW[ci] = len; });
        });
      }
      exclWs.columns.forEach(function(col, ci) { col.width = Math.min(Math.max((exclColW[ci] || 10) + 2, 10), 40); });

      /* ════════════════════════════════════════════════════════════════
         FASE 8 — Hoja Resumen + column widths + export
         ════════════════════════════════════════════════════════════════ */
      if (onStatus) onStatus('Generando Resumen...');

      [{ key: 'Product', num: 1 }, { key: 'Location', num: 2 }, { key: 'Customer', num: 3 },
       { key: 'Location Source', num: 4 }, { key: 'Customer Source', num: 5 }
      ].forEach(function (d) {
        var s = STATS[d.key]; if (!s) return;
        var pct  = s.total > 0 ? Math.round((s.ok / s.total) * 100) : 100;
        var row  = [d.num, d.key, s.total, s.red, s.yel, s.ok, pct + '%'];
        var fill  = s.red > 0 ? C_RED : s.yel > 0 ? C_YEL : null;
        var exRow = s0ws.addRow(row);
        if (fill) exRow.eachCell(function (cell) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }; });
        row.forEach(function (v, ci) { var len = v != null ? String(v).length : 0; if (len > s0colW[ci]) s0colW[ci] = len; });
      });

      /* ── KPIs en Resumen ── */
      s0ws.addRow([]);  // separador
      var kpiHdrRow = s0ws.addRow(['KPI', 'Valor', '', '', '', '', '']);
      kpiHdrRow.eachCell(function(cell) {
        if (!cell.value) return;
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRP.metric } };
        cell.font  = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
      });
      var kpiRows = [
        ['Productos analizados', n],
        ['Productos con ruta completa (planta a cliente)', completeCount + ' (' + kpi_pctComplete + '%)'],
        ['Ghost nodes totales detectados', ghostCount],
        ['Health Score promedio', kpi_avgHealth],
        ['TLT promedio global (dias)', kpi_avgTlt != null ? kpi_avgTlt : NA_DASH],
        ['CLT promedio global (dias)', kpi_avgClt != null ? kpi_avgClt : NA_DASH],
        ['Clientes con rutas resilientes', kpi_totalCusts > 0 ? kpi_resilCusts + ' de ' + kpi_totalCusts + ' (' + kpi_pctResil + '%)' : NA_DASH],
        ['Tipos de material excluidos', exclEntries.length > 0 ? exclEntries.join(', ') : '(ninguno)']
      ];
      kpiRows.forEach(function(r) {
        var kr = s0ws.addRow([r[0], r[1], '', '', '', '', '']);
        var len0 = r[0] ? String(r[0]).length : 0, len1 = r[1] != null ? String(r[1]).length : 0;
        if (len0 > s0colW[0]) s0colW[0] = len0;
        if (len1 > s0colW[1]) s0colW[1] = len1;
      });

      [gPrd, gLoc, gCust, gLS, gCS].forEach(function (g) { g.finalize(); });

      s0ws.columns.forEach(function (col, ci) { col.width = Math.min(Math.max((s0colW[ci] || 10) + 2, 10), 60); });
      if (onProgress) onProgress(97);
      if (onStatus)   onStatus('Generando archivo Excel...');
      var buf  = await wb.xlsx.writeBuffer();
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var dlUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = dlUrl; a.download = 'SupplyNetworkAnalysis_' + today + '.xlsx';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(dlUrl);

      return {
        totalProducts: n, completeProducts: completeCount, totalPaths: totalPaths,
        ghostNodes: ghostCount, avgHealthScore: n > 0 ? Math.round(healthSum / n) : 0
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

    /* ── Path enumeration (DFS with cycle guard) ──
       MAX_PATHS_PRD = 50 000 por producto como safety valve contra redes
       combinatorialmente explosivas. Si se alcanza, paths._truncated = true
       y se indica en la columna Observaciones del producto. ── */
    function snFindAllPaths(graph) {
      var paths = [];
      var MAX_DEPTH = 12, MAX_PATHS_PRD = 50000;

      graph.plants.forEach(function (plant) {
        var stack = [[plant]];
        while (stack.length > 0 && paths.length < MAX_PATHS_PRD) {
          var cur  = stack.pop();
          var last = cur[cur.length - 1];
          (graph.custEdges[last] || []).forEach(function (cust) {
            if (paths.length < MAX_PATHS_PRD)
              paths.push({ plant: plant, nodes: cur.slice(), customer: cust });
          });
          if (cur.length < MAX_DEPTH) {
            (graph.locEdges[last] || []).forEach(function (next) {
              if (cur.indexOf(next) < 0) stack.push(cur.concat([next]));
            });
          }
        }
      });
      paths._truncated = paths.length >= MAX_PATHS_PRD;
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
      var steps = ['Base: 0'];
      if (paths.length > 0) { score += 30; steps.push('+30 ruta completa planta-cliente'); }
      else { steps.push('+0 sin rutas completas'); }
      if (metrics.customers > 1) { score += 10; steps.push('+10 multiples clientes (' + metrics.customers + ')'); }
      if (metrics.paths > 1) { score += 10; steps.push('+10 multiples rutas (' + metrics.paths + ')'); }
      if (metrics.plants > 1) { score += 10; steps.push('+10 multiples plantas (' + metrics.plants + ')'); }
      if (ghosts.length > 0) { score -= 20; steps.push('-20 ghost nodes (' + ghosts.length + ')'); }
      if (deadEnds.length > 0) { score -= 15; steps.push('-15 dead ends (' + deadEnds.length + ')'); }
      var custPC = {};
      paths.forEach(function (p) { custPC[p.customer] = (custPC[p.customer] || 0) + 1; });
      var hasSinglePath = Object.keys(custPC).some(function (c) { return custPC[c] === 1; });
      if (hasSinglePath) { score -= 20; steps.push('-20 cliente(s) con unica ruta'); }
      if (metrics.plants === 1) { score -= 15; steps.push('-15 fuente unica de produccion'); }
      score = Math.max(0, Math.min(100, score));

      var cat = score >= 80 ? 'Healthy' : score >= 60 ? 'Acceptable'
        : score >= 40 ? 'Weak' : 'Critical';
      var cmts = [];
      if (paths.length === 0) cmts.push('No valid plant-to-customer paths');
      if (ghosts.length > 0) cmts.push(ghosts.length + ' ghost DC(s)');
      if (deadEnds.length > 0) cmts.push(deadEnds.length + ' dead-end location(s)');
      if (hasSinglePath) cmts.push('Single-path customers detected');
      if (metrics.plants === 1) cmts.push('Single production source');
      var detail = steps.join(' | ') + ' = ' + score;
      return { score: score, category: cat, comments: cmts.join('; '), detail: detail };
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



