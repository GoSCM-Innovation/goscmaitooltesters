/* ═══════════════════════════════════════════════════════════════
   PRODUCTION HIERARCHY ANALYZER  v2
   Descarga 10 entidades → IDB/memoria → analiza →
   exporta Excel con hojas:
     Resumen, Product, Resource, Resource Location,
     Prod Source Header, Prod Source Item,
     Prod Source Resource, Location, Tipos Excluidos
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

  var PA_PRD = {}, PA_LOC = {}, PA_RES = {}, PA_RES_LOC = {};
  var pshBySid = {}, pshPrdSet = {};

  try {
    progEl.style.width = '0%';
    if (!IDB) IDB = await openDB();
    await Promise.all(['pa_psh','pa_psi','pa_psisub','pa_psr','pa_loc_prod','pa_loc_src'].map(idbClear));

    /* ── PHASE 1: Download entities (0 → 75%) ── */

    setStatusPA('Descargando Production Source Header → IDB...', 2);
    log(logEl, 'info', timer.fmt() + ' [GET] ' + baseOData + ent.psh);
    var nPsh = await fetchAndIndex(baseOData + ent.psh, logEl, paFilter,
      'SOURCEID,PRDID,LOCID,SOURCETYPE,PLEADTIME,OUTPUTCOEFFICIENT',
      function(rows) {
        rows.forEach(function(r) {
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
    log(logEl, 'ok', timer.fmt() + ' PSH: ' + nPsh + ' reg (' + Object.keys(pshBySid).length + ' SOURCEIDs)');
    progEl.style.width = '12%';

    if (ent.psi) {
      setStatusPA('Descargando Production Source Item → IDB...', 12);
      var nPsi = await fetchAndIndex(baseOData + ent.psi, logEl, paFilter,
        'SOURCEID,PRDID,COMPONENTCOEFFICIENT,ISALTITEM',
        function(rows) { return idbBulkPut('pa_psi', rows); });
      log(logEl, 'ok', timer.fmt() + ' PSI: ' + nPsi + ' reg');
    }
    progEl.style.width = '18%';

    if (ent.psiSub) {
      setStatusPA('Descargando Production Source Item Sub → IDB...', 18);
      var nPsiSub = await fetchAndIndex(baseOData + ent.psiSub, logEl, paFilter,
        'SOURCEID,PRDFR,SPRDFR',
        function(rows) { return idbBulkPut('pa_psisub', rows); });
      log(logEl, 'ok', timer.fmt() + ' PSI Sub: ' + nPsiSub + ' reg');
    }
    progEl.style.width = '22%';

    if (ent.psr) {
      setStatusPA('Descargando Production Source Resource → IDB...', 22);
      var nPsr = await fetchAndIndex(baseOData + ent.psr, logEl, paFilter,
        'SOURCEID,RESID',
        function(rows) { return idbBulkPut('pa_psr', rows); });
      log(logEl, 'ok', timer.fmt() + ' PSR: ' + nPsr + ' reg');
    }
    progEl.style.width = '32%';

    if (ent.prd) {
      setStatusPA('Indexando Product...', 32);
      var nPrd = await fetchAndIndex(baseOData + ent.prd, logEl, paFilter,
        'PRDID,PRDDESCR,MATTYPEID',
        function(rows) {
          rows.forEach(function(r) { var k = str(r.PRDID); if (k) PA_PRD[k] = r; });
          return Promise.resolve();
        });
      log(logEl, 'ok', timer.fmt() + ' Product: ' + nPrd + ' reg');
    }
    progEl.style.width = '44%';

    if (ent.loc) {
      setStatusPA('Indexando Location...', 44);
      var nLoc = await fetchAndIndex(baseOData + ent.loc, logEl, paFilter,
        'LOCID,LOCDESCR,LOCTYPE',
        function(rows) {
          rows.forEach(function(r) { var k = str(r.LOCID); if (k) PA_LOC[k] = r; });
          return Promise.resolve();
        });
      log(logEl, 'ok', timer.fmt() + ' Location: ' + nLoc + ' reg');
    }
    progEl.style.width = '54%';

    if (ent.res) {
      setStatusPA('Indexando Resource...', 54);
      var nRes = await fetchAndIndex(baseOData + ent.res, logEl, paFilter,
        'RESID,RESDESCR',
        function(rows) {
          rows.forEach(function(r) { var k = str(r.RESID); if (k) PA_RES[k] = r; });
          return Promise.resolve();
        });
      log(logEl, 'ok', timer.fmt() + ' Resource: ' + nRes + ' reg');
    }
    progEl.style.width = '60%';

    if (ent.resLoc) {
      setStatusPA('Indexando Resource Location...', 60);
      var nResLoc = await fetchAndIndex(baseOData + ent.resLoc, logEl, paFilter,
        'RESID,LOCID',
        function(rows) {
          rows.forEach(function(r) {
            var k = str(r.RESID); if (!k) return;
            if (!PA_RES_LOC[k]) PA_RES_LOC[k] = [];
            PA_RES_LOC[k].push({ LOCID: str(r.LOCID || '') });
          });
          return Promise.resolve();
        });
      log(logEl, 'ok', timer.fmt() + ' Resource Location: ' + nResLoc + ' reg');
    }
    progEl.style.width = '64%';

    if (ent.locPrd) {
      setStatusPA('Descargando Location Product → IDB...', 64);
      var nLp = await fetchAndIndex(baseOData + ent.locPrd, logEl, paFilter,
        'LOCID,PRDID',
        function(rows) { return idbBulkPut('pa_loc_prod', rows); });
      log(logEl, 'ok', timer.fmt() + ' Location Product: ' + nLp + ' reg');
    }
    progEl.style.width = '68%';

    if (ent.locSrc) {
      setStatusPA('Descargando Location Source → IDB...', 68);
      var nLs = await fetchAndIndex(baseOData + ent.locSrc, logEl, paFilter,
        'PRDID,LOCFR,LOCID,TLEADTIME',
        function(rows) { return idbBulkPut('pa_loc_src', rows); });
      log(logEl, 'ok', timer.fmt() + ' Location Source: ' + nLs + ' reg');
    }
    progEl.style.width = '75%';

    /* ── Init mattype config after PA_PRD is ready ── */
    if (Object.keys(PA_PRD).length) mattyeInit(PA_PRD);

    log(logEl, 'ok', timer.fmt() + ' Descarga completa. Iniciando análisis...');
    setStatusPA('Analizando...', 75);

    await paAnalyzeAndExport(
      ent, PA_PRD, PA_LOC, PA_RES, PA_RES_LOC,
      pshBySid, pshPrdSet,
      timer, logEl, setStatusPA, progEl
    );

    progEl.style.width = '100%';
    log(logEl, 'ok', timer.fmt() + ' ¡Excel descargado! Análisis completado en ' + timer.ms() + 'ms.');
    setStatusPA('✓ Completado · ' + timer.ms() + 'ms', 100);
    document.getElementById('paSuccessBanner').classList.remove('hidden');

  } catch(e) {
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

/* ── Fetch ligero de Product master para poblar tipos de material ── */
async function paFetchMattypes() {
  var prdEnt = document.getElementById('selPAProduct').value;
  if (!prdEnt || !CFG || !CFG.url) return;

  var baseOData = CFG.url + '/sap/opu/odata/IBP/' + CFG.service + '/';
  var paFilter  = CFG.pa
    ? (CFG.pver
      ? "PlanningAreaID eq '" + CFG.pa + "' and VersionID eq '" + CFG.pver + "'"
      : "PlanningAreaID eq '" + CFG.pa + "'")
    : '';

  var tmpPrd = {};
  // logEl dummy (off-DOM) para que fetchAndIndex/log no rompan
  var logDummy = document.getElementById('logPA') || document.createElement('div');
  try {
    await fetchAndIndex(baseOData + prdEnt, logDummy, paFilter, 'PRDID,MATTYPEID',
      function(rows) {
        rows.forEach(function(r) { var k = str(r.PRDID); if (k) tmpPrd[k] = r; });
        return Promise.resolve();
      });
    mattyeInit(tmpPrd);
  } catch(e) {
    console.warn('[paFetchMattypes] fetch falló:', e);
  }
}

/* ── Helpers de apertura/cierre de bodies de mattype-panel ── */
function _paOpenMattypeBody(bodyId, arrId) {
  var body = document.getElementById(bodyId);
  var arr  = document.getElementById(arrId);
  if (body) body.style.display = 'block';
  if (arr)  arr.textContent = '▼';
}
function _paCloseMattypeBody(bodyId, arrId) {
  var body = document.getElementById(bodyId);
  var arr  = document.getElementById(arrId);
  if (body) body.style.display = 'none';
  if (arr)  arr.textContent = '▶';
}

/* ── Navegación entre paneles ── */

/* MDT → Exclude */
function paConfirmMapping() {
  // Colapsar mapeo
  var mdtBody = document.getElementById('bodyPAMDT');
  var mdtArr  = document.getElementById('arrPAMDT');
  if (mdtBody) { mdtBody.classList.add('hidden'); if (mdtArr) mdtArr.textContent = '▶'; }

  // Mostrar y expandir panel de exclusión
  var excl = document.getElementById('panelPAExclude');
  if (excl) {
    excl.classList.remove('hidden');
    _paOpenMattypeBody('mattypeExcludeBody', 'mattypeExcludeArr');
    excl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Fetch ligero de tipos de material
  var wrap = document.getElementById('mattypeExcludeWrap');
  if (wrap) wrap.innerHTML = '<p style="color:var(--text2);font-size:12px;margin:8px 0;">⏳ Cargando tipos de material desde SAP IBP…</p>';
  paFetchMattypes().then(function() {
    mattyeRenderExclude();
    _mattyeUpdateExcludeSummary();
    _paUpdateRunSummary();
  });
}

/* Exclude → MDT (volver) */
function paBackToMapping() {
  ['panelPAExclude', 'panelPACategories', 'panelPAExportMode'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  _paCloseMattypeBody('mattypeExcludeBody', 'mattypeExcludeArr');
  _paCloseMattypeBody('mattypeCatBody',     'mattypeCatArr');

  var mdtBody = document.getElementById('bodyPAMDT');
  var mdtArr  = document.getElementById('arrPAMDT');
  if (mdtBody) {
    mdtBody.classList.remove('hidden');
    if (mdtArr) mdtArr.textContent = '▼';
    document.getElementById('panelPAMDT').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/* Exclude → Categories */
function paContinueToCategories() {
  // Colapsar exclusión
  _paCloseMattypeBody('mattypeExcludeBody', 'mattypeExcludeArr');

  // Mostrar y expandir categorización
  var cat = document.getElementById('panelPACategories');
  if (cat) {
    cat.classList.remove('hidden');
    _paOpenMattypeBody('mattypeCatBody', 'mattypeCatArr');
    mattyeRenderCategorize();
    cat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  _paUpdateRunSummary();
}

/* Categories → Exclude (volver) */
function paBackToExclude() {
  // Colapsar categorización
  _paCloseMattypeBody('mattypeCatBody', 'mattypeCatArr');

  // Expandir exclusión
  _paOpenMattypeBody('mattypeExcludeBody', 'mattypeExcludeArr');
  document.getElementById('panelPAExclude').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* Categories → Run */
function paContinueToRun() {
  // Colapsar categorización
  _paCloseMattypeBody('mattypeCatBody', 'mattypeCatArr');

  var run = document.getElementById('panelPAExportMode');
  if (run) {
    run.classList.remove('hidden');
    run.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  _paUpdateRunSummary();
}

/* Run → Categories (volver) */
function paBackToCategories() {
  var run = document.getElementById('panelPAExportMode');
  if (run) run.classList.add('hidden');

  // Expandir categorización
  _paOpenMattypeBody('mattypeCatBody', 'mattypeCatArr');
  document.getElementById('panelPACategories').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _paUpdateRunSummary() {
  var el = document.getElementById('paRunSummary');
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
    if (excl.length) parts.push(exclPrds + ' productos excluidos (' + excl.join(', ') + ')');
    if (catted.length) parts.push(catted.length + ' tipo(s) categorizados');
    el.textContent = parts.join(' · ');
  }
}

function paModeChange() {} // kept for compatibility — no-op

/* ═══════════════════════════════════════════════════════════════
   PA — ANÁLISIS + EXPORTACIÓN EXCEL
   ═══════════════════════════════════════════════════════════════ */
async function paAnalyzeAndExport(
  ent, PA_PRD, PA_LOC, PA_RES, PA_RES_LOC,
  pshBySid, pshPrdSet,
  timer, logEl, setStatusPA, progEl
) {
  /* ── Helpers de lookup ── */
  function pd(id)  { var p = PA_PRD[id] || {}; return str(p.PRDDESCR  || ''); }
  function pm(id)  { var p = PA_PRD[id] || {}; return str(p.MATTYPEID || ''); }
  function ld(id)  { var l = PA_LOC[id]  || {}; return str(l.LOCDESCR  || ''); }
  function lct(id) { var l = PA_LOC[id]  || {}; return str(l.LOCTYPE   || ''); }
  function rd(id)  { var r = PA_RES[id]  || {}; return str(r.RESDESCR  || ''); }
  function yn(b)   { return b ? 'Si' : 'No'; }

  /* ── PHASE A: cargar IDB a memoria ── */
  setStatusPA('Cargando datos desde IndexedDB...', 75);
  var allLocProd = ent.locPrd  ? (await idbGetAll('pa_loc_prod'))  : [];
  var allLocSrc  = ent.locSrc  ? (await idbGetAll('pa_loc_src'))   : [];
  var allPsi     = ent.psi     ? (await idbGetAll('pa_psi'))       : [];
  var allPsiSub  = ent.psiSub  ? (await idbGetAll('pa_psisub'))    : [];
  var allPsr     = ent.psr     ? (await idbGetAll('pa_psr'))       : [];
  log(logEl, 'ok', timer.fmt() + ' IDB cargado — LocProd:' + allLocProd.length +
    ' LocSrc:' + allLocSrc.length + ' PSI:' + allPsi.length);

  /* ── PHASE B: construir índices ── */
  setStatusPA('Construyendo índices...', 77);

  /* PSH */
  var pshByPrdLoc  = {};   // "PRDID|LOCID" → [SOURCEID] SOURCETYPE=P
  var pshSidLocid  = {};   // SOURCEID → { LOCID, PRDID }
  var pshSidHasP   = {};
  var pshPrdSetP   = {};
  Object.keys(pshBySid).forEach(function(sid) {
    var recs    = pshBySid[sid];
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

  /* PSI */
  var psiPrdSet     = new Set();
  var psiBySourceid = {};
  var psiCompByLocPrd = {};  // "LOCID|PRDID(comp)" → true — componente en esta planta
  allPsi.forEach(function(r) {
    var sid = str(r.SOURCEID), prd = str(r.PRDID || '');
    if (prd) psiPrdSet.add(prd);
    if (sid) { if (!psiBySourceid[sid]) psiBySourceid[sid] = []; psiBySourceid[sid].push(r); }
    // Index por planta del SOURCEID
    var info = pshSidLocid[sid] || {};
    if (info.LOCID && prd) psiCompByLocPrd[info.LOCID + '|' + prd] = true;
  });

  /* PSI Sub */
  var psiSubBySprdfr = {};
  allPsiSub.forEach(function(r) {
    var sprdfr = str(r.SPRDFR || ''), prdfr = str(r.PRDFR || '');
    if (sprdfr && prdfr) {
      if (!psiSubBySprdfr[sprdfr]) psiSubBySprdfr[sprdfr] = [];
      if (psiSubBySprdfr[sprdfr].indexOf(prdfr) < 0) psiSubBySprdfr[sprdfr].push(prdfr);
    }
  });

  /* PSR */
  var psrResidSet   = new Set();
  var psrByResidLoc = new Set();
  var psrBySourceid = {};
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

  /* Location Product */
  var locPrdSet     = new Set();  // "LOCID|PRDID"
  var locPrdPrdSet  = new Set();
  allLocProd.forEach(function(r) {
    var loc = str(r.LOCID), prd = str(r.PRDID);
    if (loc && prd) { locPrdSet.add(loc + '|' + prd); locPrdPrdSet.add(prd); }
  });

  /* Location Source */
  var locSrcByPrdLoc    = {};         // "PRDID|LOCID(dest)" → [{LOCFR, TLEADTIME}]
  var locSrcByPrdLocfr  = new Set();  // "PRDID|LOCFR(orig)"
  var locSrcPrdSet      = new Set();
  var locSrcByLocfr     = {};         // LOCFR → [{PRDID, LOCID}]
  var locSrcByLocid     = {};         // LOCID → [{PRDID, LOCFR}]
  allLocSrc.forEach(function(r) {
    var prd = str(r.PRDID), locfr = str(r.LOCFR || ''), locid = str(r.LOCID || ''), tlt = str(r.TLEADTIME || '');
    if (prd) locSrcPrdSet.add(prd);
    if (prd && locid) {
      var k = prd + '|' + locid;
      if (!locSrcByPrdLoc[k]) locSrcByPrdLoc[k] = [];
      locSrcByPrdLoc[k].push({ LOCFR: locfr, TLEADTIME: tlt });
    }
    if (prd && locfr) locSrcByPrdLocfr.add(prd + '|' + locfr);
    if (locfr) {
      if (!locSrcByLocfr[locfr]) locSrcByLocfr[locfr] = [];
      locSrcByLocfr[locfr].push({ PRDID: prd, LOCID: locid });
    }
    if (locid) {
      if (!locSrcByLocid[locid]) locSrcByLocid[locid] = [];
      locSrcByLocid[locid].push({ PRDID: prd, LOCFR: locfr });
    }
  });

  /* Índice LS por PRDID — para check de TLEADTIME */
  var locSrcRowsByPrd = {};
  allLocSrc.forEach(function(r) {
    var prd = str(r.PRDID);
    if (!prd) return;
    if (!locSrcRowsByPrd[prd]) locSrcRowsByPrd[prd] = [];
    locSrcRowsByPrd[prd].push(r);
  });

  /* Resource Location */
  var resLocSet      = new Set();
  var resLocResidSet = new Set();
  Object.keys(PA_RES_LOC).forEach(function(resid) {
    resLocResidSet.add(resid);
    PA_RES_LOC[resid].forEach(function(e) { if (e.LOCID) resLocSet.add(resid + '|' + e.LOCID); });
  });

  /* ── Índices derivados para métricas ── */

  // PSH por producto: PRDID → [SOURCEID]
  var pshSidsByPrd = {};
  // PSH por ubicación: LOCID → [SOURCEID]
  var pshSidsByLoc = {};
  Object.keys(pshBySid).forEach(function(sid) {
    var info = pshSidLocid[sid] || {};
    var prd = info.PRDID, loc = info.LOCID;
    if (prd) { if (!pshSidsByPrd[prd]) pshSidsByPrd[prd] = []; if (pshSidsByPrd[prd].indexOf(sid) < 0) pshSidsByPrd[prd].push(sid); }
    if (loc) { if (!pshSidsByLoc[loc]) pshSidsByLoc[loc] = []; if (pshSidsByLoc[loc].indexOf(sid) < 0) pshSidsByLoc[loc].push(sid); }
  });

  // Plantas por producto (distinct LOCIDs desde PSH SOURCETYPE=P)
  var plantsByPrd = {};
  Object.keys(pshByPrdLoc).forEach(function(key) {
    var prd = key.split('|')[0], loc = key.split('|')[1];
    if (!plantsByPrd[prd]) plantsByPrd[prd] = new Set();
    plantsByPrd[prd].add(loc);
  });

  // PSR recursos por producto (via SOURCEID → planta → PSH por planta → producto)
  var resByPrd  = {};  // PRDID → Set of RESID
  var resByLoc  = {};  // LOCID → Set of RESID (activos en PSR)
  allPsr.forEach(function(r) {
    var sid = str(r.SOURCEID), resid = str(r.RESID || '');
    if (!resid) return;
    var info = pshSidLocid[sid] || {};
    if (info.PRDID) { if (!resByPrd[info.PRDID]) resByPrd[info.PRDID] = new Set(); resByPrd[info.PRDID].add(resid); }
    if (info.LOCID) { if (!resByLoc[info.LOCID]) resByLoc[info.LOCID] = new Set(); resByLoc[info.LOCID].add(resid); }
  });

  // Componentes por producto: PRDID(output) → count de PSI
  var psiCountByPrd = {};
  allPsi.forEach(function(r) {
    var sid = str(r.SOURCEID);
    var info = pshSidLocid[sid] || {};
    if (info.PRDID) psiCountByPrd[info.PRDID] = (psiCountByPrd[info.PRDID] || 0) + 1;
  });

  // Productos que usan un PRDID como componente: comp → Set<output_prd>
  var usedByPrd = {};
  allPsi.forEach(function(r) {
    var comp = str(r.PRDID || '');
    var sid  = str(r.SOURCEID);
    var info = pshSidLocid[sid] || {};
    if (comp && info.PRDID) {
      if (!usedByPrd[comp]) usedByPrd[comp] = new Set();
      usedByPrd[comp].add(info.PRDID);
    }
  });

  // Plantas que consumen un PRDID como componente PSI: comp → Set<LOCID>
  var consumedAtLoc = {};
  allPsi.forEach(function(r) {
    var comp = str(r.PRDID || '');
    var sid  = str(r.SOURCEID);
    var info = pshSidLocid[sid] || {};
    if (comp && info.LOCID) {
      if (!consumedAtLoc[comp]) consumedAtLoc[comp] = new Set();
      consumedAtLoc[comp].add(info.LOCID);
    }
  });

  // Proveedores (LOCFR que abastecen un PRDID como componente PSI)
  // "proveedor" = LOCFR en LocSrc donde el PRDID es componente PSI en LOCID destino
  var vendorsByComp = {};   // PRDID(comp) → Set<LOCFR>
  allLocSrc.forEach(function(r) {
    var prd = str(r.PRDID), locfr = str(r.LOCFR || ''), locid = str(r.LOCID || '');
    if (!prd || !locfr || !locid) return;
    if (psiCompByLocPrd[locid + '|' + prd]) {
      if (!vendorsByComp[prd]) vendorsByComp[prd] = new Set();
      vendorsByComp[prd].add(locfr);
    }
  });

  // Plantas consumidoras cubiertas por LocSrc para un componente
  // cubierta = existe LocSrc con PRDID=comp y LOCID=planta consumidora
  function _coveredPlants(comp) {
    var consuming = consumedAtLoc[comp];
    if (!consuming) return { covered: new Set(), uncovered: new Set() };
    var covered = new Set(), uncovered = new Set();
    consuming.forEach(function(loc) {
      var k = comp + '|' + loc;
      if (locSrcByPrdLoc[k] && locSrcByPrdLoc[k].length > 0) covered.add(loc);
      else uncovered.add(loc);
    });
    return { covered: covered, uncovered: uncovered };
  }

  // Orígenes en red para un PRDID (LOCFR en LocSrc)
  function _originsInNet(prd) {
    var origins = new Set();
    allLocSrc.forEach(function(r) {
      if (str(r.PRDID) === prd && str(r.LOCFR || '')) origins.add(str(r.LOCFR));
    });
    return origins;
  }

  /* ── Mattype CFG ── */
  // Asegurar que MATTYPE_CFG esté inicializado (puede estar vacío si no hay productos)
  if (Object.keys(MATTYPE_CFG).length === 0 && Object.keys(PA_PRD).length) {
    mattyeInit(PA_PRD);
  }

  /* ── Workbook setup ── */
  setStatusPA('Inicializando Excel...', 79);
  var today = new Date().toISOString().slice(0, 10);
  var GOLD  = 'FFF7A800', ORANGE = 'FFE8622A', NAVY = 'FF0B1120';
  var C_RED = 'FFFFCCCC', C_YEL  = 'FFFFFFCC';
  var NA_DASH = '\u2014', NA_FILL = 'FFE5E7EB', NA_FONT = 'FF6B7280';
  var GRP = { control:'FFD1D5DB', ibp:'FFBAE6FD', flag:'FFFDE68A', metric:'FFA7F3D0', detail:'FF99F6E4' };
  var wb    = new StreamingXlsx();

  function makeSheet(name, tabArgb, hdrs, notes, groups) {
    var ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { tabColor: { argb: tabArgb } }
    });
    ws.addRow(hdrs.map(cleanXml));
    ws.getRow(1).eachCell(function(cell, colNum) {
      var grpKey  = groups && groups[colNum - 1];
      var hdrFill = grpKey ? (GRP[grpKey] || GOLD) : GOLD;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hdrFill } };
      cell.font = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'medium', color: { argb: ORANGE } } };
      var rawNote = notes && notes[colNum - 1];
      if (rawNote) {
        var safeNote = cleanXml(rawNote);
        try { if (safeNote) cell.note = safeNote; } catch(e) {}
      }
    });
    ws.getRow(1).height = 22;
    var colW = hdrs.map(function(h) { return h.length; });
    return {
      ws: ws,
      addRow: function(data, fillArgb) {
        var row = ws.addRow(data.map(cleanXml));
        row.eachCell({ includeEmpty: true }, function(cell) {
          if (cell.value === NA_DASH) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NA_FILL } };
            cell.font = { name: 'DM Sans', size: 10, color: { argb: NA_FONT }, italic: true };
            return;
          }
          if (fillArgb) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
          }
        });
        data.forEach(function(v, ci) {
          if (v === NA_DASH) return;
          var len = v != null ? String(v).length : 0;
          if (len > (colW[ci] || 0)) colW[ci] = len;
        });
      },
      finalize: function() {
        ws.columns.forEach(function(col, ci) {
          col.width = Math.min(Math.max((colW[ci] || 10) + 2, 10), 60);
        });
      }
    };
  }

  function statusLabel(fill) {
    return fill === C_RED ? '⛔ Alerta' : fill === C_YEL ? '⚠ Advertencia' : '✅ OK';
  }

  var STATS = {};
  function initStat(name) { STATS[name] = { total: 0, red: 0, yel: 0, ok: 0 }; }
  function track(name, fill) {
    if (!STATS[name]) return;
    STATS[name].total++;
    if (fill === C_RED) STATS[name].red++;
    else if (fill === C_YEL) STATS[name].yel++;
    else STATS[name].ok++;
  }

  function severityToFill(sev) {
    if (sev === 'red')    return C_RED;
    if (sev === 'yellow') return C_YEL;
    return null;
  }

  /* helper: elimina caracteres inválidos para XML 1.0 y espacios extremos.
     SAP IBP devuelve campos CHAR con padding de espacios; ExcelJS 4.x no genera
     xml:space="preserve" correctamente para esos strings → Excel repara sharedStrings.xml. */
  function cleanXml(v) {
    if (v == null) return v;
    if (typeof v !== 'string') return v;
    var s = v.replace(/[\uD800-\uDFFF]/g, '')
             .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, '')
             .trim();
    return s === '' ? null : s;
  }

  /* helper: array → string concatenado */
  function codes(arr) { return Array.from(arr || []).sort().join(', '); }

  /* ── Resumen (se llena al final) ── */
  var S0 = makeSheet('Resumen', 'FF34D399',
    ['#','Hoja','Total registros','Alertas 🔴','Advertencias 🟡','OK ✅','% Consistencia'],
    [
      'Número de hoja en el libro.',
      'Nombre de la hoja analizada.',
      'Total de filas procesadas en esa hoja. Ej: 350 = se analizaron 350 productos.',
      'Registros con problema crítico que bloquea o distorsiona la planificación. Ej: producto sin PSH, BOM vacío, PLEADTIME = 0.',
      'Registros con dato incompleto o sospechoso que conviene revisar. Ej: recurso sin Resource Location, arco sin consumo PSI en destino.',
      'Registros sin hallazgos — todas las validaciones aplicables pasaron correctamente.',
      'Porcentaje de registros OK sobre el total. Fórmula: OK / Total × 100. Ej: 85 de 100 productos OK = 85%.'
    ],
    ['control','control','metric','metric','metric','metric','metric']);

  /* ════════════════════════════════════════════════════════════════
     HOJA 1 — PRODUCT
     ════════════════════════════════════════════════════════════════ */
  if (ent.prd) {
    initStat('Product');
    var S1 = makeSheet('Product', 'FF29ABE2', [
      'Estado','Observacion',
      'PRDID','PRDDESCR','MATTYPEID',
      'En Location Product','En PSH (output)','En PSI (componente)','En Location Source',
      '# Opciones prod.','Opciones prod. (SOURCEIDs)',
      '# Plantas prod.','Plantas prod. (códigos)',
      '# Componentes BOM',
      '# Recursos prod.','Recursos prod. (códigos)',
      '# Proveedores','Proveedores (códigos)',
      '# Plantas cubiertas','Plantas cubiertas (códigos)',
      '# Plantas sin cobertura','Plantas sin cobertura (códigos)',
      '# Productos que lo usan',
      '# Orígenes en red','Orígenes en red (códigos)',
      '# Plantas consumidoras','Plantas consumidoras (códigos)'
    ], [
      'Color de alerta: 🔴 Alerta = problema crítico que bloquea la planificación | 🟡 Advertencia = dato incompleto o sospechoso | ✅ OK = sin hallazgos.',
      'Detalle de cada validación. Si hay hallazgos, describe el problema concreto. Si el estado es OK, lista las validaciones que pasaron. Ej OK: "Habilitado en Location Product | Con PSH, PSI y PSR | Lead time definido en todos los SOURCEIDs".',
      'Código único del producto en SAP IBP (PRDID). Ej: PROD-001, MAT-A.',
      'Descripción del producto según el maestro de materiales. Ej: "Aceite refinado 1L".',
      'Tipo de material SAP asignado a este producto (MATTYPEID). Determina qué validaciones aplican. Ej: FERT = producto terminado, HALB = semielaborado, ROH = materia prima.',
      'Si / No — ¿El producto está registrado en al menos una ubicación en Location Product? Sin esto, IBP ignora el producto en la planificación. Ej: PROD-001 sin Location Product → no entra a ningún plan.',
      'Si / No — ¿El producto aparece como output principal (SOURCETYPE=P) en alguna fuente de producción (PSH)? Sin PSH no hay instrucciones de fabricación. Ej: PROD-001 con PSH en planta P001.',
      'Si / No — ¿Este producto es usado como ingrediente en el BOM de algún otro producto (PSI)? Ej: MAT-A = Sí porque es componente en el BOM de PROD-001.',
      'Si / No — ¿Este producto tiene al menos un arco de transferencia configurado en Location Source? Ej: MAT-A = Sí porque se transfiere de PROV-01 a P001.',
      'Cuántas recetas de producción distintas (SOURCEIDs) tienen a este producto como output principal. Ej: 2 = puede fabricarse de dos maneras diferentes.',
      'Códigos de las fuentes de producción (SOURCEIDs) donde este producto es el output. Ej: SRC-001, SRC-002.',
      'Número de plantas distintas donde se fabrica este producto. Ej: 3 = se produce en P001, P002 y P003.',
      'Códigos de las plantas de producción (LOCID) donde tiene PSH asociado. Ej: P001, P002.',
      'Total de componentes PSI definidos en todos sus BOMs. Ej: 5 = la suma de ingredientes en todas sus recetas de producción es 5.',
      'Número de recursos productivos (máquinas/líneas) asignados a sus recetas vía PSR. Ej: 2 = LINEA-01 y HORNO-A.',
      'Códigos de los recursos (RESID) asignados a sus fuentes de producción. Ej: LINEA-01, HORNO-A.',
      'Número de ubicaciones origen que abastecen este producto como insumo vía Location Source. Ej: 2 = llega desde PROV-01 y PROV-02.',
      'Códigos de las ubicaciones origen (LOCFR) que proveen este producto. Ej: PROV-01, PROV-02.',
      'Número de plantas consumidoras que tienen arco de abastecimiento configurado para este producto. Ej: 2 de 3 plantas cubiertas = OK.',
      'Códigos de las plantas que sí tienen arco de abastecimiento para este producto. Ej: P001, P002.',
      'Número de plantas consumidoras SIN arco de abastecimiento configurado para este producto. Si > 0: falta configurar Location Source. Ej: P003 consume MAT-A pero no tiene arco desde ningún proveedor → 🔴.',
      'Códigos de las plantas sin cobertura de abastecimiento. Ej: P003.',
      'Cuántos otros productos distintos requieren este material como componente en sus BOMs. Ej: 3 = MAT-A es ingrediente en PROD-001, PROD-002 y PROD-003.',
      'Número de nodos origen distintos desde los que este producto puede ser recibido en la red. Ej: 2 = puede llegar desde PROV-01 o desde P002.',
      'Códigos de los nodos origen del producto en la red. Ej: PROV-01, P002.',
      'Número de plantas donde este producto es consumido como ingrediente en algún BOM. Ej: 2 = se usa como componente en P001 y P002.',
      'Códigos de las plantas donde este producto aparece como componente PSI. Ej: P001, P002.'
    ], [
      'control','control',
      'ibp','ibp','ibp',
      'flag','flag','flag','flag',
      'metric','detail',
      'metric','detail',
      'metric',
      'metric','detail',
      'metric','detail',
      'metric','detail',
      'metric','detail',
      'metric',
      'metric','detail',
      'metric','detail'
    ]);

    Object.keys(PA_PRD).sort().forEach(function(prdid) {
      var mattypeid = pm(prdid);
      var cats      = mattypeGetCategories(mattypeid);
      var isExcl    = mattypeIsExcluded(mattypeid);
      if (isExcl) return; // excluidos no se analizan aquí

      var rules           = mattypeGetRules(cats);
      var isUncategorized = cats[0] === 'uncategorized';

      var inLP  = locPrdPrdSet.has(prdid);
      var inPSH = !!pshPrdSetP[prdid];
      var inPSI = psiPrdSet.has(prdid);
      var inLS  = locSrcPrdSet.has(prdid);

      /* Métricas producción */
      var sidsPrd    = pshSidsByPrd[prdid]   || [];
      var plantsSet  = plantsByPrd[prdid]     || new Set();
      var resSet     = resByPrd[prdid]        || new Set();
      var compCount  = psiCountByPrd[prdid]   || 0;

      /* Métricas abastecimiento */
      var vendorSet  = vendorsByComp[prdid]   || new Set();
      var covData    = _coveredPlants(prdid);
      var usedBySet  = usedByPrd[prdid]       || new Set();
      var origins    = _originsInNet(prdid);
      var consLocs   = consumedAtLoc[prdid]   || new Set();

      /* Validaciones según categoría */
      var obs = [];
      var fills = [];

      // Location Product — universal 🔴
      if (!inLP) { obs.push('Sin cobertura en Location Product'); fills.push('red'); }

      // PSH + PSI + PSR como bloque
      var reqPSH = rules.requiresPSH;
      if (reqPSH !== 'none') {
        if (!inPSH) {
          obs.push('Sin fuente de producción propia (PSH)');
          fills.push(reqPSH);
        } else {
          // Si tiene PSH, PSI y PSR son obligatorios al mismo nivel
          var hasPSI = inPSI || compCount > 0;
          var hasPSR = resSet.size > 0;
          if (!hasPSI) { obs.push('PSH sin componentes PSI'); fills.push(reqPSH); }
          if (!hasPSR) { obs.push('PSH sin recursos PSR asignados'); fills.push(reqPSH); }
        }
      }

      // LocSrc: planta PSH debe ser LOCFR
      if (rules.requiresPlantAsOrigin !== 'none' && inPSH) {
        var plantsArr = Array.from(plantsSet);
        var hasPlantAsOrigin = plantsArr.some(function(loc) {
          return locSrcByPrdLocfr.has(prdid + '|' + loc);
        });
        if (!hasPlantAsOrigin) {
          obs.push('Planta productora no es origen en Location Source');
          fills.push(rules.requiresPlantAsOrigin);
        }
      }

      // LocSrc: arco de compra llega a planta consumidora
      if (rules.requiresVendorArc !== 'none') {
        if (covData.uncovered.size > 0) {
          obs.push('Sin arco de abastecimiento hacia: ' + codes(covData.uncovered));
          fills.push(rules.requiresVendorArc);
        } else if (!inLS) {
          obs.push('Sin arco de abastecimiento (no registrado en Location Source)');
          fills.push(rules.requiresVendorArc);
        }
      }

      // LocSrc: algún origen y destino
      if (rules.requiresAnyOriginDest !== 'none') {
        if (!inLS) { obs.push('Sin arcos en Location Source'); fills.push(rules.requiresAnyOriginDest); }
      }

      // PLEADTIME
      if (rules.pleadtimeZero !== 'none' && inPSH) {
        var sidsMissingPlt = sidsPrd.filter(function(sid) {
          var recs = pshBySid[sid] || [];
          return recs.some(function(r) { return !r.PLEADTIME || r.PLEADTIME === '0'; });
        });
        if (sidsMissingPlt.length) {
          obs.push('PLEADTIME ausente o cero en ' + sidsMissingPlt.length + ' SOURCEID(s)');
          fills.push(rules.pleadtimeZero);
        }
      }

      // OUTPUTCOEFFICIENT = 0 en PSH
      if (rules.outputCoeffZero !== 'none' && inPSH) {
        var sidsMissingCoeff = sidsPrd.filter(function(sid) {
          var recs = pshBySid[sid] || [];
          return recs.some(function(r) { return !r.OUTPUTCOEFFICIENT || r.OUTPUTCOEFFICIENT === '0'; });
        });
        if (sidsMissingCoeff.length) {
          obs.push('OUTPUTCOEFFICIENT ausente o cero en ' + sidsMissingCoeff.length + ' SOURCEID(s)');
          fills.push(rules.outputCoeffZero);
        }
      }

      // Solo co-producto: aparece en PSH pero nunca como SOURCETYPE=P
      if (rules.isCoproductOnly !== 'none') {
        if (pshPrdSet[prdid] && !inPSH) {
          obs.push('Configurado solo como co-producto (SOURCETYPE=C) — falta PSH primario');
          fills.push(rules.isCoproductOnly);
        }
      }

      // Tiene PSH cuando no debería (rawmat / trading)
      if (rules.hasPSHUnexpected !== 'none') {
        if (pshPrdSet[prdid]) {
          obs.push('Tiene BOM de fabricación (PSH) — verificar categorización');
          fills.push(rules.hasPSHUnexpected);
        }
      }

      // No consumido como componente en ningún BOM
      if (rules.notConsumedInBOM !== 'none') {
        if (consLocs.size === 0) {
          obs.push('No consumido como componente en ningún BOM');
          fills.push(rules.notConsumedInBOM);
        }
      }

      // TLEADTIME = 0 en todos los arcos de Location Source
      if (rules.tleadtimeZero !== 'none' && inLS) {
        var lsRows = locSrcRowsByPrd[prdid] || [];
        if (lsRows.length > 0) {
          var allZeroTlt = lsRows.every(function(r) {
            return !r.TLEADTIME || str(r.TLEADTIME) === '0';
          });
          if (allZeroTlt) {
            obs.push('TLEADTIME = 0 en todos los arcos de Location Source');
            fills.push(rules.tleadtimeZero);
          }
        }
      }

      var uncatLabel = isUncategorized
        ? 'Sin categoría [' + (mattypeid || 'sin MATTYPEID') + ']'
        : null;

      if (!obs.length) {
        if (isUncategorized) {
          obs.push(uncatLabel + ' — sin hallazgos en modo permisivo');
        } else {
          var okParts = ['Habilitado en Location Product'];
          if (reqPSH !== 'none' && inPSH)                      okParts.push('Con PSH, PSI y PSR');
          if (rules.requiresPlantAsOrigin !== 'none' && inPSH) okParts.push('Planta es origen en Location Source');
          if (rules.requiresVendorArc !== 'none')               okParts.push('Arcos de abastecimiento completos');
          if (rules.requiresAnyOriginDest !== 'none')           okParts.push('Con arcos en Location Source');
          if (rules.pleadtimeZero !== 'none' && inPSH)          okParts.push('PLEADTIME definido en todos los SOURCEIDs');
          if (rules.outputCoeffZero !== 'none' && inPSH)        okParts.push('Coeficiente de salida definido');
          if (rules.isCoproductOnly !== 'none' && inPSH)        okParts.push('PSH con SOURCETYPE=P presente');
          if (rules.hasPSHUnexpected !== 'none')                okParts.push('Sin BOM de fabricación');
          if (rules.notConsumedInBOM !== 'none')                okParts.push('Consumido como componente en BOM');
          if (rules.tleadtimeZero !== 'none' && inLS)           okParts.push('TLEADTIME definido en Location Source');
          obs.push(okParts.join(' | '));
        }
      } else if (isUncategorized) {
        obs.unshift(uncatLabel);
      }

      // Severidad final
      var finalSev = fills.length ? mattypeResolveSeverity(fills.map(function(f){
        if(f==='red') return 'red'; if(f==='yellow') return 'yellow'; return 'none';
      })) : 'none';
      if (isUncategorized && finalSev === 'none') finalSev = 'yellow';
      var fill = severityToFill(finalSev);

      S1.addRow([
        statusLabel(fill), obs.join(' | '),
        prdid, pd(prdid), mattypeid,
        yn(inLP), yn(inPSH), yn(inPSI), yn(inLS),
        sidsPrd.length,        codes(sidsPrd),
        plantsSet.size,        codes(plantsSet),
        compCount,
        resSet.size,           codes(resSet),
        vendorSet.size,        codes(vendorSet),
        covData.covered.size,  codes(covData.covered),
        covData.uncovered.size, codes(covData.uncovered),
        usedBySet.size,
        origins.size,         codes(origins),
        consLocs.size,        codes(consLocs)
      ], fill);
      track('Product', fill);
    });
    S1.finalize();
    setStatusPA('Hoja Product lista...', 82);
    await new Promise(function(r){ setTimeout(r, 0); });
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 2 — LOCATION
     Roles inferidos por comportamiento en los datos
     ════════════════════════════════════════════════════════════════ */
  if (ent.loc) {
    initStat('Location');
    var S9 = makeSheet('Location', 'FF10B981', [
      'Estado','Observacion',
      'LOCID','LOCDESCR','LOCTYPE',
      'Rol(es) inferido(s)',
      /* Planta */
      '# Productos fabricados','Productos fabricados (códigos)',
      '# SOURCEIDs','SOURCEIDs (códigos)',
      '# Recursos asignados','Recursos asignados (códigos)',
      '# Recursos activos PSR','Recursos activos (códigos)',
      '# Recursos ociosos','Recursos ociosos (códigos)',
      '# BOMs sin PSI','SOURCEIDs sin PSI (códigos)',
      '# BOMs sin PSR','SOURCEIDs sin PSR (códigos)',
      '# Componentes externos','# Componentes sin cobertura LocSrc','Componentes sin cobertura (códigos)',
      '# SOURCEIDs sin PLEADTIME','SOURCEIDs sin PLEADTIME (códigos)',
      /* Proveedor */
      '# Productos abastecidos (como proveedor)','Productos abastecidos (códigos)',
      '# Plantas abastecidas','Plantas abastecidas (códigos)',
      '# Arcos sin consumo PSI en destino','Productos sin consumo PSI (códigos)',
      '# Productos sin LocProd en destino','Productos sin LocProd (códigos)',
      /* Nodo transferencia */
      '# Productos transferidos','Productos transferidos (códigos)',
      '# Destinos transferencia','Destinos transferencia (códigos)',
      /* Nodo receptor */
      '# Productos recibidos','Productos recibidos (códigos)',
      '# Orígenes desde los que recibe','Orígenes (códigos)'
    ], [
      'Color de alerta: 🔴 Alerta = problema crítico que bloquea la planificación | 🟡 Advertencia = dato incompleto o sospechoso | ✅ OK = sin hallazgos.',
      'Detalle de cada validación. Ej 🔴: "2 SOURCEID(s) sin PSI | 1 componente sin arco de abastecimiento". Ej ✅: "BOMs con PSI, PSR y lead time | Sin componentes descubiertos".',
      'Código único de la ubicación en SAP IBP (LOCID). Ej: P001, DC-NORTE, PROV-05.',
      'Descripción de la ubicación del maestro de ubicaciones. Ej: "Planta Santiago", "Centro Distribución Norte".',
      'Tipo de ubicación según el campo LOCTYPE de SAP IBP. Ej: 1010 = planta, 1020 = centro distribución. Campo informativo, el rol real se infiere del comportamiento en los datos.',
      'Rol(es) inferidos del comportamiento real en los datos (independiente del LOCTYPE). Posibles: Planta de producción = tiene PSH | Proveedor = abastece componentes PSI en destino | Nodo de transferencia = envía productos sin consumo PSI en destino | Nodo receptor = solo recibe vía Location Source | Nodo de recursos = tiene Resource Location pero sin producción ni transferencias | Sin actividad = existe en el maestro pero no aparece en ningún otro dato.',
      /* Planta */
      'Número de productos distintos que se fabrican en esta planta (tienen PSH con este LOCID como planta). Ej: 5 = fabrica PROD-001, PROD-002, PROD-003, SEMI-A, SEMI-B.',
      'Códigos de los productos fabricados en esta planta. Ej: PROD-001, PROD-002.',
      'Número de fuentes de producción (SOURCEIDs) asociadas a esta planta. Ej: 3 = SRC-001, SRC-002, SRC-003.',
      'Códigos de los SOURCEIDs de producción de esta planta. Ej: SRC-001, SRC-002.',
      'Número de recursos (máquinas/líneas) con Resource Location configurado en esta planta. Ej: 4 = LINEA-01, LINEA-02, HORNO-A, HORNO-B.',
      'Códigos de los recursos asignados a esta planta en Resource Location. Ej: LINEA-01, HORNO-A.',
      'Número de recursos asignados que aparecen en al menos un PSR activo en esta planta. Ej: 3 de 4 asignados están activos.',
      'Códigos de los recursos activos en algún PSR de esta planta. Ej: LINEA-01, LINEA-02, HORNO-A.',
      'Recursos que están en Resource Location para esta planta pero no aparecen en ningún PSR. Posible configuración huérfana. Ej: HORNO-B asignado a P001 pero sin ninguna receta que lo use → 🟡.',
      'Códigos de los recursos ociosos (en Resource Location sin uso en PSR). Ej: HORNO-B.',
      'Número de SOURCEIDs de esta planta que no tienen ningún componente PSI definido (BOMs vacíos). Un BOM vacío impide planificar la compra de insumos. Ej: SRC-003 sin PSI → 🔴.',
      'Códigos de los SOURCEIDs con BOM vacío (sin PSI). Ej: SRC-003.',
      'Número de SOURCEIDs de esta planta que no tienen ningún recurso PSR asignado. Sin recurso, IBP no puede planificar capacidad. Ej: SRC-002 sin PSR → 🔴.',
      'Códigos de los SOURCEIDs sin recursos PSR asignados. Ej: SRC-002.',
      'Total de componentes de tipo insumo (no semielaborados) requeridos por los BOMs de esta planta. Ej: 8 = suma de ingredientes externos en todas las recetas de P001.',
      'Número de insumos externos de esta planta que no tienen arco de abastecimiento en Location Source. Ej: 2 = MAT-A y MAT-B se requieren en P001 pero no hay Location Source que los lleve ahí → 🔴.',
      'Códigos de los insumos externos sin cobertura de abastecimiento hacia esta planta. Ej: MAT-A, MAT-B.',
      'Número de SOURCEIDs de esta planta con PLEADTIME = 0 o no definido. Un lead time cero hace que IBP planifique como si la producción fuera instantánea. Ej: SRC-001 con PLEADTIME=0 → 🔴.',
      'Códigos de los SOURCEIDs con PLEADTIME faltante o cero en esta planta. Ej: SRC-001.',
      /* Proveedor */
      'Número de productos distintos que esta ubicación envía como origen en Location Source hacia plantas que los consumen como PSI. Ej: 3 = PROV-01 abastece MAT-A, MAT-B, MAT-C.',
      'Códigos de los productos abastecidos desde esta ubicación. Ej: MAT-A, MAT-B.',
      'Número de plantas destino a las que esta ubicación envía productos. Ej: 2 = abastece a P001 y P002.',
      'Códigos de las plantas destino abastecidas. Ej: P001, P002.',
      'Productos que se envían desde aquí pero no se consumen como componente PSI en la planta destino. Puede indicar arcos configurados de más o sin uso real. Ej: MAT-X se envía a P001 pero ningún BOM de P001 lo usa → 🟡.',
      'Códigos de los productos enviados sin consumo PSI en la planta destino. Ej: MAT-X.',
      'Productos que se envían a una planta destino donde no tienen Location Product habilitado. IBP no puede planificarlos en esa planta. Ej: MAT-Y llega a P002 pero no tiene Location Product en P002 → 🔴.',
      'Códigos de los productos sin Location Product en la planta destino. Ej: MAT-Y.',
      /* Nodo transferencia */
      'Número de productos que esta ubicación reenvía vía Location Source sin que sean consumidos como PSI en el destino. Ej: DC-NORTE transfiere PROD-001 a DC-SUR sin que DC-SUR lo use como insumo productivo.',
      'Códigos de los productos transferidos sin consumo productivo en destino. Ej: PROD-001.',
      'Número de ubicaciones destino hacia las que esta ubicación transfiere productos. Ej: 2 = reenvía a DC-SUR y DC-ESTE.',
      'Códigos de las ubicaciones destino de transferencia. Ej: DC-SUR, DC-ESTE.',
      /* Nodo receptor */
      'Número de productos que esta ubicación recibe como destino en Location Source. Ej: 4 = recibe PROD-001, PROD-002, MAT-A, MAT-B.',
      'Códigos de los productos recibidos en esta ubicación. Ej: PROD-001, MAT-A.',
      'Número de ubicaciones origen distintas desde las que recibe productos. Ej: 3 = recibe desde P001, P002 y PROV-01.',
      'Códigos de las ubicaciones origen que abastecen a esta ubicación. Ej: P001, PROV-01.'
    ], [
      'control','control',
      'ibp','ibp','ibp','ibp',
      /* Planta */
      'metric','detail','metric','detail',
      'metric','detail','metric','detail','metric','detail',
      'metric','detail','metric','detail',
      'metric','metric','detail',
      'metric','detail',
      /* Proveedor */
      'metric','detail','metric','detail','metric','detail','metric','detail',
      /* Transferencia */
      'metric','detail','metric','detail',
      /* Receptor */
      'metric','detail','metric','detail'
    ]);

    // Unión de todos los locids conocidos
    var allLocIds = new Set();
    Object.keys(PA_LOC).forEach(function(l) { allLocIds.add(l); });
    Object.keys(pshSidsByLoc).forEach(function(l) { allLocIds.add(l); });
    Object.keys(locSrcByLocfr).forEach(function(l) { allLocIds.add(l); });
    Object.keys(locSrcByLocid).forEach(function(l) { allLocIds.add(l); });
    Object.keys(PA_RES_LOC).forEach(function(resid) {
      PA_RES_LOC[resid].forEach(function(e) { if(e.LOCID) allLocIds.add(e.LOCID); });
    });

    Array.from(allLocIds).sort().forEach(function(locid) {
      var locRec = PA_LOC[locid] || {};
      var locdescr = str(locRec.LOCDESCR || '');
      var loctype  = str(locRec.LOCTYPE  || '');

      /* Inferir roles */
      var roles = [];

      // Planta: tiene PSH
      var sidsAtLoc = pshSidsByLoc[locid] || [];
      var isPlanta  = sidsAtLoc.length > 0;
      if (isPlanta) roles.push('Planta de producción');

      // Determinar si LOCFR en LocSrc provee componentes PSI en LOCID destino
      var locfrRows = locSrcByLocfr[locid] || [];
      var isProveedor = false, isTransferencia = false;
      locfrRows.forEach(function(row) {
        if (row.LOCID && row.PRDID) {
          if (psiCompByLocPrd[row.LOCID + '|' + row.PRDID]) isProveedor = true;
          else isTransferencia = true;
        }
      });
      if (isProveedor)     roles.push('Proveedor');
      if (isTransferencia) roles.push('Nodo de transferencia');

      // Receptor: solo LOCID en LocSrc, sin PSH, sin ser LOCFR
      var locidRows   = locSrcByLocid[locid] || [];
      var isReceptor  = locidRows.length > 0 && !isPlanta && locfrRows.length === 0;
      if (isReceptor) roles.push('Nodo receptor');

      // Nodo de recursos: Resource Location sin PSH ni LocSrc
      var hasResLoc = resLocResidSet.size > 0 && Object.keys(PA_RES_LOC).some(function(resid) {
        return PA_RES_LOC[resid].some(function(e){ return e.LOCID === locid; });
      });
      if (hasResLoc && !isPlanta && !isProveedor && !isTransferencia && !isReceptor) {
        roles.push('Nodo de recursos');
      }

      if (!roles.length) roles.push('Sin actividad');

      var rolStr = roles.join(' | ');

      /* ── Métricas Planta ── */
      var plantaPrds    = new Set();
      var plantaSids    = new Set(sidsAtLoc);
      var resAsignados  = new Set(Object.keys(PA_RES_LOC).filter(function(resid){
        return PA_RES_LOC[resid].some(function(e){ return e.LOCID === locid; });
      }));
      var resActivos    = resByLoc[locid] || new Set();
      var resOciosos    = new Set(Array.from(resAsignados).filter(function(r){ return !resActivos.has(r); }));
      var bomssinPSI    = new Set();
      var bomssinPSR    = new Set();
      var compExternos  = 0;
      var compSinCov    = new Set();
      var sidsSinPlt    = new Set();

      sidsAtLoc.forEach(function(sid) {
        var info = pshSidLocid[sid] || {};
        if (info.PRDID) plantaPrds.add(info.PRDID);
        if (!(psiBySourceid[sid] && psiBySourceid[sid].length)) bomssinPSI.add(sid);
        if (!(psrBySourceid[sid] && psrBySourceid[sid].length)) bomssinPSR.add(sid);
        var recs = pshBySid[sid] || [];
        if (recs.some(function(r){ return !r.PLEADTIME || r.PLEADTIME === '0'; })) sidsSinPlt.add(sid);
        // Componentes externos y sin cobertura
        (psiBySourceid[sid] || []).forEach(function(pr) {
          var comp = str(pr.PRDID || '');
          if (!comp) return;
          var isSemi = !!pshByPrdLoc[comp + '|' + locid];
          if (!isSemi) {
            compExternos++;
            var lsRows = locSrcByPrdLoc[comp + '|' + locid] || [];
            if (!lsRows.length) compSinCov.add(comp);
          }
        });
      });

      /* ── Métricas Proveedor ── */
      var prdAbastecidos   = new Set();
      var plantasAbast     = new Set();
      var sinConsumoPSI    = new Set();
      var sinLocProd       = new Set();
      locfrRows.forEach(function(row) {
        if (!row.PRDID || !row.LOCID) return;
        prdAbastecidos.add(row.PRDID);
        plantasAbast.add(row.LOCID);
        if (!psiCompByLocPrd[row.LOCID + '|' + row.PRDID]) sinConsumoPSI.add(row.PRDID);
        if (!locPrdSet.has(row.LOCID + '|' + row.PRDID))    sinLocProd.add(row.PRDID);
      });

      /* ── Métricas Transferencia ── */
      var prdTransferidos = new Set();
      var destTransf      = new Set();
      locfrRows.forEach(function(row) {
        if (!row.PRDID || !row.LOCID) return;
        if (!psiCompByLocPrd[row.LOCID + '|' + row.PRDID]) {
          prdTransferidos.add(row.PRDID);
          destTransf.add(row.LOCID);
        }
      });

      /* ── Métricas Receptor ── */
      var prdRecibidos = new Set();
      var origenes     = new Set();
      locidRows.forEach(function(row) {
        if (row.PRDID) prdRecibidos.add(row.PRDID);
        if (row.LOCFR) origenes.add(row.LOCFR);
      });

      /* ── Validaciones ── */
      var obs   = [];
      var fills = [];

      if (isPlanta) {
        if (bomssinPSI.size)  { obs.push(bomssinPSI.size + ' SOURCEID(s) sin PSI');  fills.push('red');    }
        if (bomssinPSR.size)  { obs.push(bomssinPSR.size + ' SOURCEID(s) sin PSR');  fills.push('red');    }
        if (compSinCov.size)  { obs.push(compSinCov.size + ' componente(s) sin arco de abastecimiento'); fills.push('red'); }
        if (sidsSinPlt.size)  { obs.push(sidsSinPlt.size + ' SOURCEID(s) con PLEADTIME = 0'); fills.push('red'); }
        if (resOciosos.size)  { obs.push(resOciosos.size + ' recurso(s) asignados sin uso en PSR'); fills.push('yellow'); }
      }
      if (isProveedor) {
        if (sinConsumoPSI.size) { obs.push(sinConsumoPSI.size + ' producto(s) abastecidos sin consumo PSI en destino'); fills.push('yellow'); }
        if (sinLocProd.size)    { obs.push(sinLocProd.size + ' producto(s) sin Location Product en planta destino'); fills.push('red'); }
      }
      if (roles[0] === 'Sin actividad') { obs.push('Ubicación en maestro sin actividad en otros datos'); fills.push('info'); }
      if (!obs.length) {
        var okParts = [];
        if (isPlanta)        okParts.push('BOMs con PSI, PSR y lead time | Sin componentes descubiertos | Sin recursos ociosos');
        if (isProveedor)     okParts.push('Abastecimiento con consumo PSI y cobertura LP en destino');
        if (isTransferencia) okParts.push('Nodo de transferencia sin hallazgos');
        if (isReceptor)      okParts.push('Nodo receptor sin hallazgos');
        if (!okParts.length) okParts.push('Ubicación activa sin hallazgos');
        obs.push(okParts.join(' | '));
      }

      var finalSev = fills.length ? mattypeResolveSeverity(fills) : 'none';
      var fill = finalSev === 'red' ? C_RED : finalSev === 'yellow' ? C_YEL : null;

      S9.addRow([
        statusLabel(fill), obs.join(' | '),
        locid, locdescr, loctype, rolStr,
        plantaPrds.size,    codes(plantaPrds),
        plantaSids.size,    codes(plantaSids),
        resAsignados.size,  codes(resAsignados),
        resActivos.size,    codes(resActivos),
        resOciosos.size,    codes(resOciosos),
        bomssinPSI.size,    codes(bomssinPSI),
        bomssinPSR.size,    codes(bomssinPSR),
        compExternos,       compSinCov.size, codes(compSinCov),
        sidsSinPlt.size,    codes(sidsSinPlt),
        prdAbastecidos.size, codes(prdAbastecidos),
        plantasAbast.size,   codes(plantasAbast),
        sinConsumoPSI.size,  codes(sinConsumoPSI),
        sinLocProd.size,     codes(sinLocProd),
        prdTransferidos.size, codes(prdTransferidos),
        destTransf.size,      codes(destTransf),
        prdRecibidos.size,  codes(prdRecibidos),
        origenes.size,      codes(origenes)
      ], fill);
      track('Location', fill);
    });
    S9.finalize();
    setStatusPA('Hoja Location lista...', 84);
    await new Promise(function(r){ setTimeout(r, 0); });
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 3 — RESOURCE
     ════════════════════════════════════════════════════════════════ */
  if (ent.res) {
    initStat('Resource');
    var S2 = makeSheet('Resource', 'FFa78bfa', [
      'Estado','Observacion',
      'RESID','RESDESCR',
      'En PSR','En Resource Location',
      '# Plantas asignadas','Plantas asignadas (códigos)',
      '# Fuentes prod.','Fuentes prod. (SOURCEIDs)',
      '# Productos que fabrica','Productos que fabrica (códigos)'
    ], [
      'Color de alerta: 🔴 Alerta = recurso completamente huérfano (sin PSR ni Resource Location) | 🟡 Advertencia = dato incompleto | ✅ OK = recurso activo y con planta asignada.',
      'Detalle de la validación. Ej 🔴: "Recurso huérfano: sin uso en producción ni planta asignada". Ej 🟡: "Sin uso en producción (no aparece en PSR)". Ej ✅: "En uso en PSR y con planta asignada en Resource Location".',
      'Código único del recurso productivo en SAP IBP (RESID). Ej: LINEA-01, HORNO-A, MAQUINA-03.',
      'Descripción del recurso del maestro de recursos. Ej: "Línea de envasado 1", "Horno túnel A".',
      'Si / No — ¿Este recurso está asignado a al menos una fuente de producción en PSR? Si No, IBP no lo usa para planificar capacidad. Ej: HORNO-B = No → nunca se considera en ninguna receta.',
      'Si / No — ¿Este recurso tiene al menos una planta configurada en Resource Location? Si No, IBP no sabe dónde opera físicamente. Ej: LINEA-01 = No → recurso sin ubicación conocida → 🟡.',
      'Número de plantas distintas donde este recurso tiene configuración en Resource Location. Ej: 2 = LINEA-01 opera en P001 y P002.',
      'Códigos de las plantas (LOCID) donde este recurso está configurado en Resource Location. Ej: P001, P002.',
      'Número de fuentes de producción (SOURCEIDs) a las que está asignado vía PSR. Ej: 3 = participa en SRC-001, SRC-002, SRC-003.',
      'Códigos de los SOURCEIDs a los que está asignado este recurso. Ej: SRC-001, SRC-002.',
      'Número de productos distintos que fabrica a través de sus SOURCEIDs. Ej: 2 = HORNO-A produce PROD-001 y PROD-002.',
      'Códigos de los productos fabricados por las fuentes donde participa este recurso. Ej: PROD-001, PROD-002.'
    ], [
      'control','control',
      'ibp','ibp',
      'flag','flag',
      'metric','detail',
      'metric','detail',
      'metric','detail'
    ]);

    // Índice: RESID → Set<LOCID> (desde Resource Location)
    var resLocsByResid = {};
    Object.keys(PA_RES_LOC).forEach(function(resid) {
      resLocsByResid[resid] = new Set(PA_RES_LOC[resid].map(function(e){ return e.LOCID; }));
    });

    // Índice: RESID → Set<SOURCEID>
    var resSidsByResid = {};
    allPsr.forEach(function(r) {
      var resid = str(r.RESID || ''), sid = str(r.SOURCEID);
      if (!resid) return;
      if (!resSidsByResid[resid]) resSidsByResid[resid] = new Set();
      resSidsByResid[resid].add(sid);
    });

    // Índice: RESID → Set<PRDID>
    var resPrdsByResid = {};
    allPsr.forEach(function(r) {
      var resid = str(r.RESID || ''), sid = str(r.SOURCEID);
      if (!resid) return;
      var info = pshSidLocid[sid] || {};
      if (info.PRDID) {
        if (!resPrdsByResid[resid]) resPrdsByResid[resid] = new Set();
        resPrdsByResid[resid].add(info.PRDID);
      }
    });

    Object.keys(PA_RES).sort().forEach(function(resid) {
      var inPSR = psrResidSet.has(resid);
      var inRL  = resLocResidSet.has(resid);
      var locsSet = resLocsByResid[resid] || new Set();
      var sidsSet = resSidsByResid[resid] || new Set();
      var prdsSet = resPrdsByResid[resid] || new Set();
      var obs = [];
      if (!inPSR && !inRL) obs.push('Recurso huérfano: sin uso en producción ni planta asignada');
      else if (!inPSR)     obs.push('Sin uso en producción (no aparece en PSR)');
      else if (!inRL)      obs.push('Sin planta asignada en Resource Location');
      if (!obs.length)     obs.push('En uso en PSR y con planta asignada en Resource Location');
      var fill = (!inPSR && !inRL) ? C_RED : (!inPSR || !inRL) ? C_YEL : null;
      S2.addRow([
        statusLabel(fill), obs.join(' | '),
        resid, rd(resid),
        yn(inPSR), yn(inRL),
        locsSet.size, codes(locsSet),
        sidsSet.size, codes(sidsSet),
        prdsSet.size, codes(prdsSet)
      ], fill);
      track('Resource', fill);
    });
    S2.finalize();
    setStatusPA('Hoja Resource lista...', 84);
    await new Promise(function(r){ setTimeout(r, 0); });
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 3 — RESOURCE LOCATION
     ════════════════════════════════════════════════════════════════ */
  if (ent.resLoc) {
    initStat('Resource Location');
    var S3 = makeSheet('Resource Location', 'FFFF9F43', [
      'Estado','Observacion',
      'RESID','RESDESCR','LOCID','LOCDESCR',
      'RESID+LOCID usado en PSR'
    ], [
      'Color de alerta: 🟡 Advertencia = recurso asignado a planta pero sin uso en ninguna receta | ✅ OK = recurso activo en PSR para esta planta.',
      'Detalle de la validación. Ej ✅: "Recurso activo en PSR para esta planta". Ej 🟡: "Recurso asignado a planta pero sin uso en PSR para esta planta" — significa que está en el maestro pero IBP nunca lo considera en esa planta.',
      'Código del recurso productivo (RESID). Ej: LINEA-01.',
      'Descripción del recurso del maestro de recursos. Ej: "Línea de envasado 1".',
      'Código de la planta donde está configurado este recurso (LOCID). Ej: P001.',
      'Descripción de la planta del maestro de ubicaciones. Ej: "Planta Santiago".',
      'Si / No — ¿Esta combinación RESID+LOCID aparece en al menos un PSR? Si No, el recurso está en el maestro de esa planta pero no participa en ninguna receta. Ej: HORNO-B en P002 = No → 🟡 configuración sin uso productivo.'
    ], [
      'control','control',
      'ibp','ibp','ibp','ibp',
      'flag'
    ]);
    Object.keys(PA_RES_LOC).sort().forEach(function(resid) {
      PA_RES_LOC[resid].forEach(function(e) {
        var locid = e.LOCID;
        var used  = psrByResidLoc.has(resid + '|' + locid);
        var obs   = used ? 'Recurso activo en PSR para esta planta' : 'Recurso asignado a planta pero sin uso en PSR para esta planta';
        var fill  = used ? null : C_YEL;
        S3.addRow([statusLabel(fill), obs, resid, rd(resid), locid, ld(locid), yn(used)], fill);
        track('Resource Location', fill);
      });
    });
    S3.finalize();
    setStatusPA('Hoja Resource Location lista...', 85);
    await new Promise(function(r){ setTimeout(r, 0); });
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 4 — PRODUCTION SOURCE HEADER
     ════════════════════════════════════════════════════════════════ */
  if (ent.psh) {
    initStat('Prod Source Header');
    var S6 = makeSheet('Prod Source Header', 'FFF7A800', [
      'Estado','Observacion',
      'SOURCEID',
      'PRDID output','PRDDESCR output','MATTYPEID output',
      'LOCID planta','LOCDESCR planta',
      'SOURCETYPE(s)','PLEADTIME','OUTPUTCOEFFICIENT',
      'PRDID+LOCID en Location Product',
      '# Componentes PSI','# Recursos PSR','Recursos PSR (códigos)',
      '# Componentes con alternativa',
      'Tiene PSR'
    ], [
      'Color de alerta: 🔴 Alerta = BOM vacío, PLEADTIME=0, sin Location Product o sin PSR | 🟡 Advertencia = sin SOURCETYPE=P o múltiples fuentes sin cuota | ✅ OK = receta completa.',
      'Detalle de hallazgos. Ej 🔴: "BOM vacío: sin componentes PSI | PLEADTIME = 0 o no definido". Ej 🟡: "Múltiples SOURCEIDs para mismo PRDID+LOCID — verificar cuotas". Ej ✅: "BOM con PSI | Lead time definido | Habilitado en LP | SOURCETYPE=P presente | Recursos PSR asignados".',
      'Identificador único de la fuente de producción (SOURCEID) en SAP IBP. Ej: SRC-001.',
      'Código del producto terminado que produce esta receta (output). Ej: PROD-001.',
      'Descripción del producto output. Ej: "Aceite refinado 1L".',
      'Tipo de material del producto output. Ej: FERT = terminado, HALB = semielaborado.',
      'Código de la planta donde se ejecuta esta producción (LOCID). Ej: P001.',
      'Descripción de la planta de producción. Ej: "Planta Santiago".',
      'Tipo(s) de fuente en esta receta: P = producción primaria (el output principal) | C = co-producto (se obtiene en el mismo proceso). Ej: P/C = esta receta produce PROD-001 como primario y SEMI-X como co-producto.',
      'Lead time de producción en días. Indica cuánto tarda el proceso desde que se lanza la orden hasta tener el producto listo. PLEADTIME = 0 o vacío hace que IBP planifique como producción instantánea → 🔴. Ej: 5 = 5 días de fabricación.',
      'Unidades del producto terminado que se obtienen por corrida de producción. Afecta directamente el cálculo de cuántas corridas se necesitan. Ej: 100 = cada corrida produce 100 unidades.',
      'Si / No — ¿La combinación PRDID+LOCID está habilitada en Location Product? Sin esto, IBP no planifica este producto en esta planta aunque exista la receta. Ej: PROD-001 en P001 = No → receta sin efecto.',
      'Número de componentes (PSI) definidos en el BOM de esta receta. 0 = BOM vacío → IBP no planifica compra de insumos. Ej: 4 = esta receta requiere 4 ingredientes.',
      'Número de recursos productivos (máquinas/líneas) asignados a esta receta vía PSR. 0 = sin capacidad modelada. Ej: 2 = LINEA-01 y HORNO-A.',
      'Códigos de los recursos (RESID) asignados a esta fuente de producción. Ej: LINEA-01, HORNO-A.',
      'Número de componentes PSI marcados como material de reemplazo alternativo (ISALTITEM=X). Ej: 1 = MAT-A-PREMIUM puede reemplazar a MAT-A en esta receta.',
      'Si / No — ¿Esta fuente tiene al menos un recurso asignado en Prod Source Resource? Si No, IBP no puede planificar la capacidad de esta receta. Ej: SRC-003 = No → sin restricción de capacidad modelada → 🔴.'
    ], [
      'control','control',
      'ibp',
      'ibp','ibp','ibp',
      'ibp','ibp',
      'ibp','ibp','ibp',
      'flag',
      'metric','metric','detail',
      'metric',
      'flag'
    ]);
    Object.keys(pshBySid).sort().forEach(function(sid) {
      var recs    = pshBySid[sid];
      var primary = recs.find(function(r){ return r.SOURCETYPE === 'P'; }) || recs[0];
      var outPrd  = primary.PRDID, outLoc = primary.LOCID;
      var plt     = primary.PLEADTIME || '', coeff = primary.OUTPUTCOEFFICIENT || '';
      var stypes  = recs.map(function(r){ return r.SOURCETYPE; })
                        .filter(function(v,i,a){ return a.indexOf(v) === i; }).join('/');
      var inLP    = locPrdSet.has(outLoc + '|' + outPrd);
      var psiRows = psiBySourceid[sid] || [];
      var psrRows = psrBySourceid[sid] || [];
      var hasPSI  = psiRows.length > 0;
      var hasPSR  = psrRows.length > 0;
      var noLt    = !plt || plt === '0';
      var hasP    = pshSidHasP[sid];
      var multi   = (pshByPrdLoc[outPrd + '|' + outLoc] || []).length > 1;

      // Métricas
      var residsSet = new Set(psrRows.map(function(r){ return str(r.RESID || ''); }).filter(Boolean));
      var altCount  = psiRows.filter(function(r){ return str(r.ISALTITEM || '') === 'X'; }).length;

      var obs = [];
      if (!hasPSI) obs.push('BOM vacío: sin componentes PSI');
      if (noLt)    obs.push('PLEADTIME = 0 o no definido');
      if (!inLP)   obs.push('PRDID+LOCID sin cobertura en Location Product');
      if (!hasP)   obs.push('Sin registro SOURCETYPE=P');
      if (!hasPSR) obs.push('Sin recursos PSR asignados');
      if (multi)   obs.push('Múltiples SOURCEIDs para mismo PRDID+LOCID — verificar cuotas');
      if (!obs.length) obs.push('BOM con componentes PSI | Lead time definido | Habilitado en LP | SOURCETYPE=P presente | Recursos PSR asignados');
      var fill = (!hasPSI || noLt || !inLP || !hasPSR) ? C_RED : (!hasP || multi) ? C_YEL : null;
      S6.addRow([
        statusLabel(fill), obs.join(' | '),
        sid,
        outPrd, pd(outPrd), pm(outPrd),
        outLoc, ld(outLoc),
        stypes, plt, coeff,
        yn(inLP),
        psiRows.length, residsSet.size, codes(residsSet),
        altCount,
        yn(hasPSR)
      ], fill);
      track('Prod Source Header', fill);
    });
    S6.finalize();
    setStatusPA('Hoja Prod Source Header lista...', 88);
    await new Promise(function(r){ setTimeout(r, 0); });
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 5 — PRODUCTION SOURCE ITEM
     ════════════════════════════════════════════════════════════════ */
  if (ent.psi) {
    initStat('Prod Source Item');
    var S7 = makeSheet('Prod Source Item', 'FF06B6D4', [
      'Estado','Observacion',
      'SOURCEID',
      'PRDID output','PRDDESCR output','MATTYPEID output',
      'LOCID planta','LOCDESCR planta',
      'PRDID componente','PRDDESCR comp','MATTYPEID comp',
      'COMPONENTCOEFFICIENT','Tipo componente',
      'PRDID comp+LOCID en Location Product',
      'En Location Source (insumo)',
      'LOCFR origen','LOCDESCR origen',
      '# Orígenes comp.','Orígenes comp. (códigos)',
      'Material de reemplazo (ISALTITEM)','Reemplaza a'
    ], [
      'Color de alerta: 🔴 Alerta = coeficiente cero, insumo sin arco de abastecimiento o componente sin Location Product | 🟡 Advertencia = SOURCEID no encontrado o sustituto sin registro Item Sub | ✅ OK = componente bien configurado.',
      'Detalle de hallazgos. Ej 🔴: "Coeficiente = 0 o no definido | Insumo sin arco de abastecimiento en Location Source". Ej ✅: "SOURCEID válido | Coeficiente definido | Con arco de abastecimiento | Habilitado en Location Product".',
      'Fuente de producción (SOURCEID) a la que pertenece este componente. Ej: SRC-001 = este componente es ingrediente de la receta SRC-001.',
      'Código del producto terminado que se fabrica en esta receta (output). Ej: PROD-001.',
      'Descripción del producto output. Ej: "Aceite refinado 1L".',
      'Tipo de material del producto output. Ej: FERT.',
      'Planta donde se fabrica el producto output (LOCID). Ej: P001.',
      'Descripción de la planta de fabricación. Ej: "Planta Santiago".',
      'Código del material que se consume como ingrediente en esta receta (PRDID componente). Ej: MAT-A.',
      'Descripción del componente del maestro de materiales. Ej: "Aceite crudo a granel".',
      'Tipo de material del componente. Ej: ROH = materia prima, HALB = semielaborado.',
      'Unidades del componente consumidas por cada unidad del producto terminado. Si = 0, IBP no planifica la compra de este insumo. Ej: 2.5 = se consumen 2.5 kg de MAT-A por cada unidad de PROD-001 fabricada.',
      'Semielaborado = el componente tiene PSH propio en esta planta y se fabrica antes de usarse (trazabilidad en PSH). Insumo = no se fabrica aquí, debe llegar desde un proveedor u otra planta vía Location Source. Ej: SEMI-B = Semielaborado | MAT-A = Insumo.',
      'Si / No — ¿El componente está habilitado en Location Product para esta planta? Si No, IBP no puede planificar su consumo en esa planta. Ej: MAT-A en P001 = No → componente desconocido para IBP en esa planta → 🔴.',
      'Si / No — ¿Hay al menos un arco en Location Source que traiga este insumo a esta planta? Muestra N/A para semielaborados (se producen localmente, no se transfieren). Ej: MAT-A en P001 = No → no hay ruta de abastecimiento configurada → 🔴.',
      'Código(s) de la(s) ubicación(es) desde donde se transfiere este componente hacia la planta (LOCFR). Ej: PROV-01, PROV-02 si llega desde dos orígenes distintos.',
      'Descripción(es) de la(s) ubicación(es) origen del componente. Ej: "Proveedor Nacional 01".',
      'Número de nodos origen distintos que abastecen este componente hacia esta planta. Ej: 2 = llega desde PROV-01 y PROV-02 (doble fuente, mayor resiliencia).',
      'Códigos de los nodos origen del componente hacia esta planta. Ej: PROV-01, PROV-02.',
      'X = este componente es un material de reemplazo alternativo (ISALTITEM=X). Vacío = componente principal. Ej: MAT-A-PREMIUM con X = puede sustituir a MAT-A cuando no hay stock.',
      'Código del componente principal al que reemplaza este sustituto. Solo aplica cuando ISALTITEM=X. Ej: MAT-A = este sustituto reemplaza a MAT-A.'
    ], [
      'control','control',
      'ibp',
      'ibp','ibp','ibp',
      'ibp','ibp',
      'ibp','ibp','ibp',
      'ibp','metric',
      'flag',
      'flag',
      'detail','detail',
      'metric','detail',
      'ibp','detail'
    ]);

    // ¿Es excluido el componente?
    function _compExclNote(compMt) {
      return (compMt && mattypeIsExcluded(compMt)) ? ' [componente de tipo excluido]' : '';
    }

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
        var compMt = pm(comp);

        var noSrc  = !locid;
        var isSemi = !!(locid && pshByPrdLoc[comp + '|' + locid]);
        var tipo   = noSrc ? 'No determinado' : isSemi ? 'Semielaborado' : 'Insumo';
        var compInLP = locid ? locPrdSet.has(locid + '|' + comp) : false;
        var noCoeff  = !coeff || Number(coeff) === 0;

        var lsRows  = (!isSemi && locid) ? (locSrcByPrdLoc[comp + '|' + locid] || []) : [];
        var inLS    = lsRows.length > 0;
        var locfrVals = inLS ? [...new Set(lsRows.map(function(x){ return x.LOCFR; }))] : [];
        var locfrCodes = locfrVals.join(', ');
        var locfrDescr = locfrVals.map(function(lf){ return ld(lf) || '?'; }).join(', ');

        // Orígenes del componente (todos los LOCFR en LocSrc para este comp en esta planta)
        var originsComp = new Set(lsRows.map(function(x){ return x.LOCFR; }).filter(Boolean));
        // Si semielaborado, orígenes son las plantas que lo producen
        if (isSemi) {
          (pshSidsByPrd[comp] || []).forEach(function(sid2) {
            var l = (pshSidLocid[sid2] || {}).LOCID;
            if (l) originsComp.add(l);
          });
        }

        var replacedBy = '';
        if (isAlt === 'X') {
          var replaced = psiSubBySprdfr[comp] || [];
          replacedBy = replaced.join(', ');
        }

        var obs = [];
        var exclNote = _compExclNote(compMt);
        if (noSrc)    obs.push('SOURCEID no encontrado en PSH');
        if (noCoeff)  obs.push('Coeficiente = 0 o no definido');
        if (isSemi)   obs.push('Semielaborado: trazabilidad en PSH');
        if (!isSemi && !noSrc) {
          if (!inLS)  obs.push('Insumo sin arco de abastecimiento en Location Source');
        }
        if (!compInLP && locid) obs.push('Componente no habilitado en Location Product para esta planta');
        if (isAlt === 'X' && !replacedBy && ent.psiSub) obs.push('Material de reemplazo sin registro en Item Sub');
        if (exclNote) obs.push('Componente de tipo excluido (' + compMt + ') — validado en contexto');
        if (!obs.length) obs.push('SOURCEID válido en PSH | Coeficiente definido | Con arco de abastecimiento en Location Source | Habilitado en Location Product');

        var fill = (noCoeff || (!isSemi && !inLS && !noSrc) || (!compInLP && locid)) ? C_RED
                 : (noSrc || (isAlt === 'X' && !replacedBy && ent.psiSub)) ? C_YEL
                 : null;

        S7.addRow([
          statusLabel(fill), obs.join(' | '),
          sid,
          outPrd, pd(outPrd), pm(outPrd),
          locid, ld(locid),
          comp, pd(comp), compMt,
          coeff, tipo,
          yn(compInLP),
          !isSemi && !noSrc ? yn(inLS) : 'N/A',
          locfrCodes, locfrDescr,
          originsComp.size, codes(originsComp),
          isAlt || '', replacedBy
        ], fill);
        track('Prod Source Item', fill);
      });
      await new Promise(function(r){ setTimeout(r, 0); });
      setStatusPA('Hoja Prod Source Item: ' + Math.min(pii + PSI_CHUNK, allPsi.length) + '/' + allPsi.length + '...',
        88 + Math.round((Math.min(pii + PSI_CHUNK, allPsi.length) / Math.max(allPsi.length, 1)) * 3));
    }
    S7.finalize();
    setStatusPA('Hoja Prod Source Item lista...', 91);
    await new Promise(function(r){ setTimeout(r, 0); });
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 6 — PRODUCTION SOURCE RESOURCE
     ════════════════════════════════════════════════════════════════ */
  if (ent.psr) {
    initStat('Prod Source Resource');
    var S8 = makeSheet('Prod Source Resource', 'FF6C63FF', [
      'Estado','Observacion',
      'SOURCEID',
      'PRDID output','PRDDESCR output','MATTYPEID output',
      'LOCID planta','LOCDESCR planta',
      'RESID','RESDESCR',
      'RESID+LOCID en Resource Location',
      '# Plantas con este recurso asignado','Plantas recurso (códigos)'
    ], [
      'Color de alerta: 🟡 Advertencia = recurso asignado a una receta pero sin Resource Location en esa planta | ✅ OK = asignación válida y consistente.',
      'Detalle de la validación. Ej ✅: "Recurso LINEA-01 asignado en Resource Location para planta P001 | Asociado a SOURCEID SRC-001". Ej 🟡: "Recurso en producción sin asignación en Resource Location para planta P001" — el recurso opera en una receta de P001 pero no figura en el maestro de esa planta.',
      'Fuente de producción (SOURCEID) a la que está asignado este recurso. Ej: SRC-001.',
      'Código del producto que fabrica esta fuente. Ej: PROD-001.',
      'Descripción del producto output. Ej: "Aceite refinado 1L".',
      'Tipo de material del producto output. Ej: FERT.',
      'Planta donde opera esta fuente de producción (LOCID). Ej: P001.',
      'Descripción de la planta. Ej: "Planta Santiago".',
      'Código del recurso asignado a esta fuente de producción (RESID). Ej: LINEA-01.',
      'Descripción del recurso del maestro de recursos. Ej: "Línea de envasado 1".',
      'Si / No — ¿La combinación RESID+LOCID aparece en Resource Location? Si No, el recurso está en la receta pero IBP no lo reconoce como ubicado en esa planta. Ej: LINEA-01 en P001 = No → 🟡 inconsistencia entre PSR y Resource Location.',
      'Número de plantas donde este recurso tiene configuración en Resource Location. Ej: 2 = LINEA-01 tiene Resource Location en P001 y P002.',
      'Códigos de las plantas donde este recurso tiene Resource Location configurado. Ej: P001, P002.'
    ], [
      'control','control',
      'ibp',
      'ibp','ibp','ibp',
      'ibp','ibp',
      'ibp','ibp',
      'flag',
      'metric','detail'
    ]);

    // RESID → plantas asignadas (Resource Location)
    var resLocMapByResid = {};
    Object.keys(PA_RES_LOC).forEach(function(resid) {
      resLocMapByResid[resid] = new Set(PA_RES_LOC[resid].map(function(e){ return e.LOCID; }));
    });

    allPsr.forEach(function(r) {
      var sid    = str(r.SOURCEID);
      var resid  = str(r.RESID || '');
      var info   = pshSidLocid[sid] || {};
      var locid  = info.LOCID || '';
      var outPrd = info.PRDID || '';
      var inRL   = !!(locid && resid && resLocSet.has(resid + '|' + locid));
      var noSrc  = !locid;
      var resPlants = resLocMapByResid[resid] || new Set();
      var obs    = noSrc ? 'SOURCEID no encontrado en PSH'
                 : inRL  ? 'Recurso ' + resid + ' asignado en Resource Location para planta ' + locid + ' | Asociado a SOURCEID ' + sid
                 :          'Recurso en producción sin asignación en Resource Location para planta ' + locid;
      var fill   = noSrc ? C_YEL : inRL ? null : C_YEL;
      S8.addRow([
        statusLabel(fill), obs,
        sid,
        outPrd, pd(outPrd), pm(outPrd),
        locid, ld(locid),
        resid, rd(resid),
        yn(inRL),
        resPlants.size, codes(resPlants)
      ], fill);
      track('Prod Source Resource', fill);
    });
    S8.finalize();
    setStatusPA('Hoja Prod Source Resource lista...', 93);
    await new Promise(function(r){ setTimeout(r, 0); });
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 8 — TIPOS EXCLUIDOS
     ════════════════════════════════════════════════════════════════ */
  var excluidos = Object.keys(MATTYPE_CFG).filter(function(k){ return MATTYPE_CFG[k].excluded; });
  if (excluidos.length) {
    initStat('Tipos Excluidos');
    var SX = makeSheet('Tipos Excluidos', 'FFFF6B6B', [
      'MATTYPEID','# Productos','Aparece como componente PSI en # SOURCEIDs',
      'SOURCEIDs donde es componente (códigos)',
      'Componentes con cobertura LocSrc','Componentes sin cobertura LocSrc',
      'Observacion'
    ], [
      'Código del tipo de material excluido del análisis principal por configuración del usuario. Ej: VERP = embalajes, NLAG = no planificados.',
      'Número de productos del maestro que tienen este tipo de material. Ej: 45 = hay 45 productos de tipo VERP.',
      'Número de fuentes de producción (SOURCEIDs) que usan productos de este tipo como componente PSI. Aunque estén excluidos del análisis principal, se valida su presencia como insumo. Ej: 12 = 12 recetas distintas usan un VERP como ingrediente.',
      'Códigos de los SOURCEIDs donde productos de este tipo excluido aparecen como componente en un BOM. Ej: SRC-001, SRC-005.',
      'Número de combinaciones componente-planta (de este tipo excluido) con arco de abastecimiento configurado en Location Source. Ej: 8 = 8 pares producto-planta tienen ruta de abastecimiento.',
      'Número de combinaciones componente-planta SIN arco de abastecimiento. Si > 0, hay insumos de tipo excluido sin ruta de llegada a la planta que los consume. Ej: 3 = 3 pares sin cobertura → 🟡 aunque el tipo esté excluido del análisis principal.',
      'Detalle: indica si el tipo aparece como componente en BOMs activos y si hay gaps de abastecimiento detectados. Ej: "Excluido del análisis principal. Validado como componente en 12 fuente(s). ⚠️ 3 combinación(es) componente-planta sin arco de abastecimiento".'
    ], [
      'ibp',
      'metric',
      'metric','detail',
      'metric','metric',
      'control'
    ]);

    // Para cada tipo excluido, listar sus productos y dónde aparecen como componente
    excluidos.sort().forEach(function(mt) {
      var cfg = MATTYPE_CFG[mt] || {};

      // Productos de este tipo
      var prdsOfType = Object.keys(PA_PRD).filter(function(p){ return pm(p) === mt; });

      // SOURCEIDs donde estos productos aparecen como componente PSI
      var sidsAsComp = new Set();
      prdsOfType.forEach(function(prd) {
        allPsi.forEach(function(r) {
          if (str(r.PRDID || '') === prd) sidsAsComp.add(str(r.SOURCEID));
        });
      });

      // Cobertura LocSrc para cada producto excluido como componente
      var covCount = 0, noCovCount = 0;
      prdsOfType.forEach(function(prd) {
        var consPlants = consumedAtLoc[prd] || new Set();
        consPlants.forEach(function(loc) {
          var k = prd + '|' + loc;
          if (locSrcByPrdLoc[k] && locSrcByPrdLoc[k].length > 0) covCount++;
          else noCovCount++;
        });
      });

      var obs = sidsAsComp.size
        ? 'Excluido del análisis principal. Validado como componente en ' + sidsAsComp.size + ' fuente(s) de producción.'
        : 'Excluido del análisis principal. No aparece como componente en ninguna fuente de producción.';
      if (noCovCount > 0) obs += ' ⚠️ ' + noCovCount + ' combinación(es) componente-planta sin arco de abastecimiento.';

      SX.addRow([
        mt, cfg.count || 0,
        sidsAsComp.size, codes(sidsAsComp),
        covCount, noCovCount,
        obs
      ], noCovCount > 0 ? C_YEL : null);
      track('Tipos Excluidos', noCovCount > 0 ? C_YEL : null);
    });
    SX.finalize();
    setStatusPA('Hoja Tipos Excluidos lista...', 97);
    await new Promise(function(r){ setTimeout(r, 0); });
  }

  /* ── HOJA 0: RESUMEN ── */
  setStatusPA('Generando Resumen...', 98);
  var sheetDefs = [
    { key: 'Product',              num: 1 },
    { key: 'Location',             num: 2 },
    { key: 'Resource',             num: 3 },
    { key: 'Resource Location',    num: 4 },
    { key: 'Prod Source Header',   num: 5 },
    { key: 'Prod Source Item',     num: 6 },
    { key: 'Prod Source Resource', num: 7 },
    { key: 'Tipos Excluidos',      num: 8 }
  ];
  sheetDefs.forEach(function(d) {
    var s = STATS[d.key]; if (!s) return;
    var pct  = s.total > 0 ? Math.round((s.ok / s.total) * 100) : 100;
    var fill = s.red > 0 ? C_RED : s.yel > 0 ? C_YEL : null;
    S0.addRow([d.num, d.key, s.total, s.red, s.yel, s.ok, pct + '%'], fill);
  });
  S0.finalize();

  /* ── EXPORT ── */
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
