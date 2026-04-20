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
  var wb    = new ExcelJS.Workbook();

  function makeSheet(name, tabArgb, hdrs, notes, groups) {
    var ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { tabColor: { argb: tabArgb } }
    });
    ws.addRow(hdrs);
    ws.getRow(1).eachCell(function(cell, colNum) {
      var grpKey  = groups && groups[colNum - 1];
      var hdrFill = grpKey ? (GRP[grpKey] || GOLD) : GOLD;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hdrFill } };
      cell.font = { bold: true, name: 'DM Sans', size: 10, color: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'medium', color: { argb: ORANGE } } };
      var note = notes && notes[colNum - 1];
      if (note) {
        try { cell.note = { texts: [{ text: note }], margins: { insetmode: 'auto' } }; } catch(e) {}
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
    return fill === C_RED ? '🔴 Alerta' : fill === C_YEL ? '🟡 Advertencia' : '✅ OK';
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

  /* helper: elimina caracteres inválidos para XML 1.0 (evita corrupción en sharedStrings.xlsx) */
  function cleanXml(v) {
    if (v == null) return v;
    if (typeof v !== 'string') return v;
    return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '');
  }

  /* helper: array → string concatenado */
  function codes(arr) { return Array.from(arr || []).sort().join(', '); }

  /* ── Resumen (se llena al final) ── */
  var S0 = makeSheet('Resumen', 'FF34D399',
    ['#','Hoja','Total registros','Alertas 🔴','Advertencias 🟡','OK ✅','% Consistencia'],
    [
      'Número de hoja en el libro.',
      'Nombre de la hoja analizada.',
      'Total de filas procesadas en esa hoja.',
      'Registros con problema crítico que requiere corrección inmediata.',
      'Registros con dato para revisar o que puede impactar la planificación.',
      'Registros sin observaciones — datos consistentes.',
      'Porcentaje de registros OK sobre el total. Fórmula: OK / Total × 100.'
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
      'Color de alerta: 🔴 Alerta = problema crítico | 🟡 Advertencia = revisar | ✅ OK = sin observaciones.',
      'Resumen de todos los hallazgos detectados para este producto.',
      'Código único del producto en SAP IBP (PRDID).',
      'Descripción del producto del maestro de materiales.',
      'Tipo de material SAP (MATTYPEID). Determina las reglas de validación aplicadas.',
      'Si / No — ¿El producto está habilitado en al menos una ubicación en Location Product? Requerido para que el motor de planificación lo considere.',
      'Si / No — ¿El producto aparece como output (SOURCETYPE=P) en alguna fuente de producción (PSH)?',
      'Si / No — ¿El producto aparece como componente en algún BOM (PSI)?',
      'Si / No — ¿El producto tiene al menos un arco de transferencia en Location Source?',
      'Cantidad de SOURCEIDs donde este producto es el output principal.',
      'Códigos de los SOURCEIDs donde este producto es producido.',
      'Cantidad de plantas distintas donde se fabrica este producto.',
      'Códigos de las plantas de producción (LOCID) donde tiene PSH.',
      'Total de componentes PSI definidos en todos los BOMs de este producto.',
      'Cantidad de recursos productivos (PSR) asignados a sus fuentes de producción.',
      'Códigos de los recursos (RESID) asignados a sus fuentes.',
      'Cantidad de ubicaciones origen que lo abastecen como insumo vía Location Source.',
      'Códigos de las ubicaciones de origen (LOCFR) que lo proveen.',
      'Cantidad de plantas consumidoras con arco de abastecimiento configurado (cobertura OK).',
      'Códigos de las plantas cubiertas con arco de abastecimiento.',
      'Cantidad de plantas consumidoras SIN arco de abastecimiento configurado. Si > 0: revisar Location Source.',
      'Códigos de las plantas sin cobertura de abastecimiento.',
      'Cuántos otros productos requieren este material como componente PSI.',
      'Cantidad de nodos origen distintos en la red de abastecimiento de este producto.',
      'Códigos de los nodos origen en la red.',
      'Cantidad de plantas donde este producto es consumido como insumo en algún BOM.',
      'Códigos de las plantas consumidoras.'
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

      var rules = mattypeGetRules(cats);

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

      if (!obs.length) obs.push('OK');

      // Severidad final
      var finalSev = fills.length ? mattypeResolveSeverity(fills.map(function(f){
        if(f==='red') return 'red'; if(f==='yellow') return 'yellow'; return 'none';
      })) : 'none';
      var fill = severityToFill(finalSev);

      // N/A: suprimir métricas que no aplican según el tipo de material
      var hasKnownCat = cats.indexOf('all') < 0;
      var naPSH  = hasKnownCat && rules.requiresPSH  === 'none';
      var naPSI  = hasKnownCat && rules.requiresPSI  === 'none';
      var naPSR  = hasKnownCat && rules.requiresPSR  === 'none';
      var naVend = hasKnownCat && cats.indexOf('rawmat') < 0 && cats.indexOf('trading') < 0;
      var naCov  = hasKnownCat && rules.requiresPlantAsOrigin === 'none';
      function na(cond, val) { return cond ? NA_DASH : val; }

      S1.addRow([
        statusLabel(fill), obs.join(' | '),
        prdid, pd(prdid), mattypeid,
        yn(inLP), na(naPSH, yn(inPSH)), yn(inPSI), yn(inLS),
        na(naPSH, sidsPrd.length),        na(naPSH, codes(sidsPrd)),
        na(naPSH, plantsSet.size),        na(naPSH, codes(plantsSet)),
        na(naPSI, compCount),
        na(naPSR, resSet.size),           na(naPSR, codes(resSet)),
        na(naVend, vendorSet.size),       na(naVend, codes(vendorSet)),
        na(naCov, covData.covered.size),  na(naCov, codes(covData.covered)),
        na(naCov, covData.uncovered.size), na(naCov, codes(covData.uncovered)),
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
      'Color de alerta: 🔴 Alerta = problema crítico | 🟡 Advertencia = revisar | ✅ OK = sin observaciones.',
      'Resumen de todos los hallazgos detectados para esta ubicación.',
      'Código único de la ubicación en SAP IBP (LOCID).',
      'Descripción de la ubicación del maestro de ubicaciones.',
      'Tipo de ubicación según el campo LOCTYPE de SAP IBP.',
      'Rol(es) inferidos a partir del comportamiento real en los datos. Posibles valores: Planta de producción | Proveedor | Nodo de transferencia | Nodo receptor | Nodo de recursos | Sin actividad.',
      /* Planta */
      'Cantidad de productos distintos que se fabrican en esta planta (tienen PSH con este LOCID).',
      'Códigos de los productos fabricados en esta planta.',
      'Cantidad de fuentes de producción (SOURCEIDs) asociadas a esta planta.',
      'Códigos de los SOURCEIDs de producción de esta planta.',
      'Cantidad de recursos con Resource Location configurado en esta planta.',
      'Códigos de los recursos asignados a esta planta en Resource Location.',
      'Cantidad de recursos asignados que aparecen en al menos un PSR en esta planta.',
      'Códigos de los recursos activos en PSR.',
      'Recursos asignados en Resource Location pero sin uso en ningún PSR en esta planta. Posible configuración huérfana.',
      'Códigos de los recursos ociosos (asignados sin uso en PSR).',
      'Cantidad de SOURCEIDs de esta planta que no tienen ningún componente PSI definido (BOMs vacíos).',
      'Códigos de los SOURCEIDs sin componentes PSI.',
      'Cantidad de SOURCEIDs de esta planta que no tienen ningún recurso PSR asignado.',
      'Códigos de los SOURCEIDs sin recursos PSR.',
      'Total de componentes externos (no semielaborados) requeridos por los BOMs de esta planta.',
      'Cantidad de componentes externos sin arco de abastecimiento en Location Source hacia esta planta.',
      'Códigos de los componentes sin cobertura de abastecimiento.',
      'Cantidad de SOURCEIDs con PLEADTIME = 0 o no definido en esta planta.',
      'Códigos de los SOURCEIDs con PLEADTIME faltante o cero.',
      /* Proveedor */
      'Cantidad de productos distintos que esta ubicación abastece como origen en Location Source.',
      'Códigos de los productos abastecidos desde esta ubicación.',
      'Cantidad de plantas destino a las que esta ubicación envía productos.',
      'Códigos de las plantas destino abastecidas.',
      'Productos que se envían desde aquí pero no se consumen como componente PSI en la planta destino. Puede indicar arcos de transferencia sin uso productivo.',
      'Códigos de los productos enviados sin consumo PSI en destino.',
      'Productos enviados que no tienen Location Product habilitado en la planta destino. Impedirá la planificación.',
      'Códigos de los productos sin Location Product en planta destino.',
      /* Nodo transferencia */
      'Cantidad de productos que esta ubicación transfiere sin que sean consumidos como PSI en destino.',
      'Códigos de los productos transferidos (sin consumo productivo en destino).',
      'Cantidad de ubicaciones destino hacia las que se transfieren productos.',
      'Códigos de las ubicaciones destino de transferencia.',
      /* Nodo receptor */
      'Cantidad de productos que esta ubicación recibe como destino en Location Source.',
      'Códigos de los productos recibidos en esta ubicación.',
      'Cantidad de ubicaciones origen distintas desde las que recibe productos.',
      'Códigos de las ubicaciones origen.'
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
      if (!obs.length) obs.push('OK');

      var finalSev = fills.length ? mattypeResolveSeverity(fills) : 'none';
      var fill = finalSev === 'red' ? C_RED : finalSev === 'yellow' ? C_YEL : null;

      function naL(cond, val) { return cond ? NA_DASH : val; }

      S9.addRow([
        statusLabel(fill), obs.join(' | '),
        locid, locdescr, loctype, rolStr,
        naL(!isPlanta, plantaPrds.size),    naL(!isPlanta, codes(plantaPrds)),
        naL(!isPlanta, plantaSids.size),    naL(!isPlanta, codes(plantaSids)),
        naL(!isPlanta, resAsignados.size),  naL(!isPlanta, codes(resAsignados)),
        naL(!isPlanta, resActivos.size),    naL(!isPlanta, codes(resActivos)),
        naL(!isPlanta, resOciosos.size),    naL(!isPlanta, codes(resOciosos)),
        naL(!isPlanta, bomssinPSI.size),    naL(!isPlanta, codes(bomssinPSI)),
        naL(!isPlanta, bomssinPSR.size),    naL(!isPlanta, codes(bomssinPSR)),
        naL(!isPlanta, compExternos),       naL(!isPlanta, compSinCov.size), naL(!isPlanta, codes(compSinCov)),
        naL(!isPlanta, sidsSinPlt.size),    naL(!isPlanta, codes(sidsSinPlt)),
        naL(!isProveedor, prdAbastecidos.size), naL(!isProveedor, codes(prdAbastecidos)),
        naL(!isProveedor, plantasAbast.size),   naL(!isProveedor, codes(plantasAbast)),
        naL(!isProveedor, sinConsumoPSI.size),  naL(!isProveedor, codes(sinConsumoPSI)),
        naL(!isProveedor, sinLocProd.size),     naL(!isProveedor, codes(sinLocProd)),
        naL(!isTransferencia, prdTransferidos.size), naL(!isTransferencia, codes(prdTransferidos)),
        naL(!isTransferencia, destTransf.size),      naL(!isTransferencia, codes(destTransf)),
        naL(!isReceptor, prdRecibidos.size),  naL(!isReceptor, codes(prdRecibidos)),
        naL(!isReceptor, origenes.size),      naL(!isReceptor, codes(origenes))
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
      'Color de alerta: 🔴 Alerta = problema crítico | 🟡 Advertencia = revisar | ✅ OK = sin observaciones.',
      'Resumen de hallazgos. Un recurso sin PSR ni Resource Location existe en el maestro pero no aporta a ningún proceso productivo.',
      'Código único del recurso productivo en SAP IBP (RESID).',
      'Descripción del recurso del maestro de recursos.',
      'Si / No — ¿El recurso está asignado a al menos una fuente de producción en Prod Source Resource (PSR)?',
      'Si / No — ¿El recurso tiene al menos una planta configurada en Resource Location?',
      'Cantidad de plantas distintas donde este recurso tiene configuración en Resource Location.',
      'Códigos de las plantas (LOCID) donde está configurado en Resource Location.',
      'Cantidad de fuentes de producción (SOURCEIDs) a las que está asignado.',
      'Códigos de los SOURCEIDs a los que está asignado este recurso.',
      'Cantidad de productos distintos que fabrica a través de sus SOURCEIDs asignados.',
      'Códigos de los productos fabricados por las fuentes donde participa este recurso.'
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
      if (!obs.length)     obs.push('OK');
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
      'Color de alerta: 🔴 Alerta = problema crítico | 🟡 Advertencia = revisar | ✅ OK = sin observaciones.',
      'Detalle del hallazgo. Si No: el recurso está ubicado en esta planta en el maestro pero no se asignó a ninguna receta productiva (PSR).',
      'Código del recurso productivo (RESID).',
      'Descripción del recurso del maestro de recursos.',
      'Código de la planta donde está configurado este recurso (LOCID).',
      'Descripción de la planta del maestro de ubicaciones.',
      'Si / No — ¿Esta combinación RESID+LOCID aparece en al menos un registro de Prod Source Resource? Si No, el recurso está registrado en esa planta pero no participa en ninguna receta de producción.'
    ], [
      'control','control',
      'ibp','ibp','ibp','ibp',
      'flag'
    ]);
    Object.keys(PA_RES_LOC).sort().forEach(function(resid) {
      PA_RES_LOC[resid].forEach(function(e) {
        var locid = e.LOCID;
        var used  = psrByResidLoc.has(resid + '|' + locid);
        var obs   = used ? 'OK' : 'Recurso asignado a planta pero sin uso en PSR para esta planta';
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
      'Color de alerta: 🔴 Alerta = problema crítico | 🟡 Advertencia = revisar | ✅ OK = sin observaciones.',
      'Detalle de hallazgos: PLEADTIME cero, BOM vacío, sin recursos PSR, sin Location Product, múltiples fuentes sin cuota, etc.',
      'Identificador único de la fuente de producción (SOURCEID) en SAP IBP.',
      'Código del producto que produce esta fuente de producción (output).',
      'Descripción del producto output del maestro de materiales.',
      'Tipo de material del producto output.',
      'Código de la planta donde se ejecuta esta producción (LOCID).',
      'Descripción de la planta del maestro de ubicaciones.',
      'Tipo(s) de fuente: P = producción primaria | C = co-producto. Separados por / si hay varios.',
      'Lead time de producción en días. PLEADTIME = 0 o vacío impide la planificación correcta de tiempos.',
      'Unidades del producto terminado generadas por corrida de producción. Afecta el cálculo de necesidades.',
      'Si / No — ¿La combinación PRDID+LOCID está habilitada en Location Product? Requerido para que el motor planifique este producto en esta planta.',
      'Cantidad de componentes (PSI) definidos en el BOM de esta fuente. 0 = BOM vacío.',
      'Cantidad de recursos productivos asignados a esta fuente en PSR.',
      'Códigos de los recursos (RESID) asignados a esta fuente de producción.',
      'Cantidad de componentes PSI marcados como material de reemplazo alternativo (ISALTITEM=X).',
      'Si / No — ¿Esta fuente tiene al menos un recurso asignado en Prod Source Resource?'
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
      if (!obs.length) obs.push('OK');
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
      'Color de alerta: 🔴 Alerta = problema crítico | 🟡 Advertencia = revisar | ✅ OK = sin observaciones.',
      'Detalle de hallazgos: coeficiente cero, componente sin Location Product, sin arco de abastecimiento, sustitución incompleta, etc.',
      'Fuente de producción (SOURCEID) a la que pertenece este componente del BOM.',
      'Código del producto terminado que se fabrica con este BOM.',
      'Descripción del producto output.',
      'Tipo de material del producto output.',
      'Planta donde se fabrica el producto output.',
      'Descripción de la planta de fabricación.',
      'Código del material consumido como componente en este BOM (PRDID componente).',
      'Descripción del componente del maestro de materiales.',
      'Tipo de material del componente.',
      'Unidades del componente consumidas por unidad del producto terminado. Si = 0, la planificación del consumo de este insumo será incorrecta.',
      'Semielaborado: el componente tiene PSH propio en esta planta (trazabilidad en PSH). Insumo: se abastece desde Location Source.',
      'Si / No — ¿El componente está habilitado en Location Product para esta planta? Si No, el motor no puede planificar su consumo aquí.',
      'Si / No — ¿Existe al menos un arco en Location Source que abastezca este componente hacia esta planta? N/A para semielaborados.',
      'Código(s) de la(s) ubicación(es) origen desde donde se transfiere el componente (LOCFR).',
      'Descripción(es) de la(s) ubicación(es) origen.',
      'Cantidad de nodos origen distintos que abastecen este componente hacia esta planta.',
      'Códigos de los nodos origen del componente.',
      'X = este componente es un material de reemplazo alternativo (ISALTITEM). Vacío = componente principal.',
      'Código del componente principal al que reemplaza este sustituto (si aplica).'
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
        if (!obs.length) obs.push('OK');

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
      'Color de alerta: 🔴 Alerta = problema crítico | 🟡 Advertencia = revisar | ✅ OK = sin observaciones.',
      'Detalle de hallazgos. 🔴 indica asignación huérfana: el SOURCEID no existe en PSH o el recurso no tiene Resource Location en esta planta.',
      'Fuente de producción (SOURCEID) a la que se asigna este recurso.',
      'Código del producto que fabrica esta fuente.',
      'Descripción del producto output.',
      'Tipo de material del producto output.',
      'Planta donde opera esta fuente de producción.',
      'Descripción de la planta.',
      'Código del recurso asignado a esta fuente de producción (RESID).',
      'Descripción del recurso del maestro de recursos.',
      'Si / No — ¿La combinación RESID+LOCID está configurada en Resource Location? Si No, el recurso opera en esta planta sin estar registrado como tal.',
      'Cantidad de plantas donde este recurso tiene configuración en Resource Location.',
      'Códigos de las plantas donde este recurso tiene Resource Location configurado.'
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
                 : inRL  ? 'OK'
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
      'Código del tipo de material excluido del análisis principal por configuración del usuario.',
      'Cantidad de productos del maestro que tienen este tipo de material.',
      'Cuántas fuentes de producción (SOURCEIDs) usan productos de este tipo como componente PSI. Aunque estén excluidos del análisis principal, se valida su presencia como insumo.',
      'Códigos de los SOURCEIDs donde productos de este tipo aparecen como componente en un BOM.',
      'Cantidad de combinaciones componente-planta con arco de abastecimiento configurado en Location Source.',
      'Cantidad de combinaciones componente-planta SIN arco de abastecimiento. Si > 0: revisar Location Source aunque el tipo esté excluido.',
      'Detalle: indica si el tipo aparece como componente y si hay gaps de abastecimiento detectados.'
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
