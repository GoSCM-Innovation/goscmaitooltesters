/* ═══════════════════════════════════════════════════════════════
   MATTYPE-CONFIG.JS
   Gestión de tipos de material para Production Hierarchy Analyzer.
   • Detecta MATTYPEID únicos desde PA_PRD (ya cargado en memoria).
   • Bloque 1: Excluir tipos — drag & drop a zona de exclusión.
   • Bloque 2: Categorizar tipos incluidos — drag & drop a 4 columnas.
   • Multi-categoría permitida: un tipo puede estar en más de una columna.
   • Persistencia en localStorage por planning area.
   • Sin categoría = todas las métricas + reglas más permisivas (🟡).
   ═══════════════════════════════════════════════════════════════ */

var MATTYPE_CFG = {};   // prdid_tipo → { excluded: bool, categories: Set }

/* ── Categorías disponibles ── */
var MATTYPE_CATS = [
  { id: 'finished',    label: 'Producto Terminado',  color: 'var(--accent)'  },
  { id: 'semi',        label: 'Semiterminado',        color: 'var(--cyan)'    },
  { id: 'rawmat',      label: 'Mat. Prima / Insumo',  color: 'var(--green)'   },
  { id: 'trading',     label: 'Mercadería',           color: 'var(--purple)'  }
];

/* ── Clave de localStorage por planning area ── */
function _mattypeLsKey() {
  var pa = (typeof CFG !== 'undefined' && CFG.pa) ? CFG.pa : 'default';
  return 'mattype_cfg_' + pa;
}

/* ── Guardar config en localStorage ── */
function mattypeSave() {
  var out = {};
  Object.keys(MATTYPE_CFG).forEach(function(k) {
    out[k] = {
      excluded: MATTYPE_CFG[k].excluded,
      categories: Array.from(MATTYPE_CFG[k].categories)
    };
  });
  try { localStorage.setItem(_mattypeLsKey(), JSON.stringify(out)); } catch(e) {}
}

/* ── Cargar config desde localStorage ── */
function mattyeLoad() {
  try {
    var raw = localStorage.getItem(_mattypeLsKey());
    if (!raw) return;
    var parsed = JSON.parse(raw);
    Object.keys(parsed).forEach(function(k) {
      if (MATTYPE_CFG[k]) {
        MATTYPE_CFG[k].excluded   = !!parsed[k].excluded;
        MATTYPE_CFG[k].categories = new Set(parsed[k].categories || []);
      }
    });
  } catch(e) {}
}

/* ── Inicializar MATTYPE_CFG desde PA_PRD ── */
function mattyeInit(prdMap) {
  // prdMap = PA_PRD: { prdid → { PRDID, PRDDESCR, MATTYPEID } }
  var counts = {};
  Object.keys(prdMap).forEach(function(prdid) {
    var mt = str(prdMap[prdid].MATTYPEID || '');
    if (!mt) return;
    counts[mt] = (counts[mt] || 0) + 1;
  });

  // Inicializar solo tipos nuevos (preservar config existente)
  Object.keys(counts).forEach(function(mt) {
    if (!MATTYPE_CFG[mt]) {
      MATTYPE_CFG[mt] = { excluded: false, categories: new Set(), count: counts[mt] };
    } else {
      MATTYPE_CFG[mt].count = counts[mt];
    }
  });

  mattyeLoad();
}

/* ── Resetear config completa ── */
function mattyeReset() {
  Object.keys(MATTYPE_CFG).forEach(function(k) {
    MATTYPE_CFG[k].excluded   = false;
    MATTYPE_CFG[k].categories = new Set();
  });
  mattypeSave();
}

/* ═══════════════════════════════════════════════════════════════
   RENDER — Bloque 1: Excluir tipos
   ═══════════════════════════════════════════════════════════════ */
function mattyeRenderExclude() {
  var wrap = document.getElementById('mattypeExcludeWrap');
  if (!wrap) return;

  var types = Object.keys(MATTYPE_CFG).sort();
  if (!types.length) {
    wrap.innerHTML = '<p class="mattype-empty">Carga datos primero para detectar los tipos de material.</p>';
    return;
  }

  var includedTypes = types.filter(function(t) { return !MATTYPE_CFG[t].excluded; });
  var excludedTypes = types.filter(function(t) { return MATTYPE_CFG[t].excluded; });

  var html = '<div class="mattype-exclude-layout">';

  // Panel incluidos
  html += '<div class="mattype-zone mattype-zone-included" id="mattypeZoneIncluded">';
  html += '<div class="mattype-zone-title">Tipos incluidos <span class="mattype-count-badge">' + includedTypes.length + '</span></div>';
  html += '<div class="mattype-cards-wrap" id="mattypeCardsIncluded" ondragover="mattypeDragOver(event)" ondrop="mattypeDropExclude(event,false)">';
  includedTypes.forEach(function(mt) {
    html += _mattypeExcludeCard(mt);
  });
  if (!includedTypes.length) {
    html += '<div class="mattype-drop-hint">Arrastra aquí para reincluir</div>';
  }
  html += '</div></div>';

  // Panel excluidos
  html += '<div class="mattype-zone mattype-zone-excluded" id="mattypeZoneExcluded">';
  html += '<div class="mattype-zone-title">⛔ Excluidos del análisis <span class="mattype-count-badge mattype-count-red">' + excludedTypes.length + '</span></div>';
  html += '<div class="mattype-cards-wrap" id="mattypeCardsExcluded" ondragover="mattypeDragOver(event)" ondrop="mattypeDropExclude(event,true)">';
  excludedTypes.forEach(function(mt) {
    html += _mattypeExcludeCard(mt, true);
  });
  if (!excludedTypes.length) {
    html += '<div class="mattype-drop-hint">Arrastra tipos aquí para excluirlos</div>';
  }
  html += '</div></div>';

  html += '</div>';

  // Nota informativa
  html += '<p class="mattype-note">ℹ️ Los tipos excluidos que actúen como componentes PSI de productos incluidos se validan igualmente en contexto.</p>';

  wrap.innerHTML = html;
  _mattypeWireExcludeDrag();
  _mattyeUpdateExcludeSummary();
}

function _mattypeExcludeCard(mt, excluded) {
  var cfg = MATTYPE_CFG[mt] || {};
  var cls = 'mattype-card' + (excluded ? ' mattype-card-excluded' : '');
  return '<div class="' + cls + '" draggable="true" data-mt="' + escH(mt) + '" id="mtExCard_' + escH(mt) + '">' +
    '<span class="mattype-code">' + escH(mt) + '</span>' +
    '<span class="mattype-count">' + (cfg.count || 0) + ' prods</span>' +
    '</div>';
}

function _mattypeWireExcludeDrag() {
  document.querySelectorAll('#mattypeExcludeWrap .mattype-card').forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', card.dataset.mt);
      card.classList.add('mattype-dragging');
    });
    card.addEventListener('dragend', function() {
      card.classList.remove('mattype-dragging');
    });
  });
}

function mattypeDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function mattypeDropExclude(e, toExcluded) {
  e.preventDefault();
  var mt = e.dataTransfer.getData('text/plain');
  if (!mt || !MATTYPE_CFG[mt]) return;
  MATTYPE_CFG[mt].excluded = toExcluded;
  mattypeSave();
  mattyeRenderExclude();
  _mattyeUpdateExcludeSummary();
}

function _mattyeUpdateExcludeSummary() {
  var excl  = Object.keys(MATTYPE_CFG).filter(function(k) { return MATTYPE_CFG[k].excluded; });
  var nProds = excl.reduce(function(s, k) { return s + (MATTYPE_CFG[k].count || 0); }, 0);
  var sumEl  = document.getElementById('mattypeExcludeSummary');
  if (!sumEl) return;
  if (!excl.length) {
    sumEl.textContent = 'Todos los tipos incluidos — sin configurar';
  } else {
    sumEl.textContent = excl.length + ' tipo(s) excluido(s) · ' + nProds + ' producto(s) omitidos del análisis principal';
  }
}

/* ═══════════════════════════════════════════════════════════════
   RENDER — Bloque 2: Categorizar tipos
   ═══════════════════════════════════════════════════════════════ */
function mattyeRenderCategorize() {
  var wrap = document.getElementById('mattypeCatWrap');
  if (!wrap) return;

  var types = Object.keys(MATTYPE_CFG).filter(function(k) { return !MATTYPE_CFG[k].excluded; }).sort();
  if (!types.length) {
    wrap.innerHTML = '<p class="mattype-empty">No hay tipos incluidos para categorizar.</p>';
    return;
  }

  var html = '<div class="mattype-cat-layout">';

  // Columna sin categoría
  var uncatTypes = types.filter(function(t) { return MATTYPE_CFG[t].categories.size === 0; });
  html += '<div class="mattype-cat-col mattype-cat-col-none" id="mattypeCatColNone">';
  html += '<div class="mattype-cat-col-title">Sin categoría</div>';
  html += '<div class="mattype-cat-cards" id="mattypeCatCards_none" ondragover="mattypeDragOver(event)" ondrop="mattypeDropCat(event,\'none\')">';
  uncatTypes.forEach(function(mt) { html += _mattypeCatCard(mt); });
  if (!uncatTypes.length) html += '<div class="mattype-drop-hint">—</div>';
  html += '</div></div>';

  // Columnas por categoría
  MATTYPE_CATS.forEach(function(cat) {
    var catTypes = types.filter(function(t) { return MATTYPE_CFG[t].categories.has(cat.id); });
    html += '<div class="mattype-cat-col" id="mattypeCatCol_' + cat.id + '" style="border-top:3px solid ' + cat.color + '">';
    html += '<div class="mattype-cat-col-title" style="color:' + cat.color + '">' + escH(cat.label) + '</div>';
    html += '<div class="mattype-cat-cards" id="mattypeCatCards_' + cat.id + '" ondragover="mattypeDragOver(event)" ondrop="mattypeDropCat(event,\'' + cat.id + '\')">';
    catTypes.forEach(function(mt) { html += _mattypeCatCard(mt, cat.color); });
    if (!catTypes.length) html += '<div class="mattype-drop-hint">Arrastra aquí</div>';
    html += '</div></div>';
  });

  html += '</div>';
  html += '<p class="mattype-note">ℹ️ Un tipo puede estar en más de una categoría. Sin categoría = todas las métricas con reglas en modo 🟡.</p>';

  wrap.innerHTML = html;
  _mattypeWireCatDrag();
  _mattyeUpdateCatSummary();
}

function _mattypeCatCard(mt, borderColor) {
  var cfg = MATTYPE_CFG[mt] || {};
  var cats = Array.from(cfg.categories);
  var catLabels = cats.map(function(cid) {
    var c = MATTYPE_CATS.find(function(x) { return x.id === cid; });
    return c ? '<span class="mattype-cat-badge" style="background:' + c.color + '">' + escH(c.label.split(' ')[0]) + '</span>' : '';
  }).join('');
  var border = borderColor ? 'border-left:3px solid ' + borderColor + ';' : '';
  return '<div class="mattype-card" draggable="true" data-mt="' + escH(mt) + '" style="' + border + '">' +
    '<span class="mattype-code">' + escH(mt) + '</span>' +
    '<span class="mattype-count">' + (cfg.count || 0) + ' prods</span>' +
    (catLabels ? '<div class="mattype-cat-badges">' + catLabels + '</div>' : '') +
    '</div>';
}

function _mattypeWireCatDrag() {
  document.querySelectorAll('#mattypeCatWrap .mattype-card').forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', card.dataset.mt);
      card.classList.add('mattype-dragging');
    });
    card.addEventListener('dragend', function() {
      card.classList.remove('mattype-dragging');
    });
  });
}

function mattypeDropCat(e, catId) {
  e.preventDefault();
  var mt = e.dataTransfer.getData('text/plain');
  if (!mt || !MATTYPE_CFG[mt]) return;
  if (catId === 'none') {
    MATTYPE_CFG[mt].categories.clear();
  } else {
    MATTYPE_CFG[mt].categories.add(catId);
  }
  mattypeSave();
  mattyeRenderCategorize();
  _mattyeUpdateCatSummary();
}

/* Double-click en categoría asignada para quitar esa categoría específica */
function mattypeRemoveCat(mt, catId) {
  if (!MATTYPE_CFG[mt]) return;
  MATTYPE_CFG[mt].categories.delete(catId);
  mattypeSave();
  mattyeRenderCategorize();
  _mattyeUpdateCatSummary();
}

function _mattyeUpdateCatSummary() {
  var types   = Object.keys(MATTYPE_CFG).filter(function(k) { return !MATTYPE_CFG[k].excluded; });
  var catted  = types.filter(function(k) { return MATTYPE_CFG[k].categories.size > 0; });
  var uncatted = types.length - catted.length;
  var sumEl   = document.getElementById('mattypeCatSummary');
  if (!sumEl) return;
  if (!catted.length) {
    sumEl.textContent = 'Sin categorización — análisis estándar para todos los tipos';
  } else {
    sumEl.textContent = catted.length + ' tipo(s) categorizados' + (uncatted > 0 ? ' · ' + uncatted + ' sin categoría (reglas 🟡)' : '');
  }
}

/* ═══════════════════════════════════════════════════════════════
   API pública — para prodAnalyzer.js
   ═══════════════════════════════════════════════════════════════ */

/* Devuelve las categorías efectivas para un MATTYPEID.
   Si sin categoría → ['all']  (tratado como todas las categorías).
   Si excluido      → ['excluded'].
   Si multi-cat     → ['finished','semi',...] */
function mattypeGetCategories(mattypeid) {
  var cfg = MATTYPE_CFG[mattypeid];
  if (!cfg)                    return ['all'];
  if (cfg.excluded)            return ['excluded'];
  if (cfg.categories.size === 0) return ['all'];
  return Array.from(cfg.categories);
}

/* ¿Está excluido este MATTYPEID? */
function mattypeIsExcluded(mattypeid) {
  var cfg = MATTYPE_CFG[mattypeid];
  return cfg ? cfg.excluded : false;
}

/* Resolución de severidad cuando hay múltiples categorías con reglas distintas.
   Toma el mínimo de severidad (más permisivo).
   Valores: 'red' > 'yellow' > 'info' > 'none' */
function mattypeResolveSeverity(severities) {
  var order = ['none', 'info', 'yellow', 'red'];
  var min = 'red';
  severities.forEach(function(s) {
    if (order.indexOf(s) < order.indexOf(min)) min = s;
  });
  return min;
}

/* Reglas de análisis por categoría.
   Devuelve objeto con flags booleanos de qué aplica.
   cats = array de category IDs (de mattypeGetCategories) */
function mattypeGetRules(cats) {
  // Sin categoría o multi → unión permisiva
  var isAll = cats.indexOf('all') >= 0;

  function rule(finishedVal, semiVal, rawmatVal, tradingVal) {
    // Para 'all': toma el más permisivo entre todos
    if (isAll) {
      return _permissive([finishedVal, semiVal, rawmatVal, tradingVal]);
    }
    var vals = cats.map(function(c) {
      if (c === 'finished') return finishedVal;
      if (c === 'semi')     return semiVal;
      if (c === 'rawmat')   return rawmatVal;
      if (c === 'trading')  return tradingVal;
      return 'none';
    });
    return _permissive(vals);
  }

  function _permissive(vals) {
    var order = ['red', 'yellow', 'info', 'none'];
    var best = 'red';
    vals.forEach(function(v) {
      if (order.indexOf(v) > order.indexOf(best)) best = v;
    });
    return best;
  }

  return {
    requiresPSH:    rule('red',    'red',    'none',   'none'),
    requiresPSI:    rule('red',    'red',    'none',   'none'),   // bloque con PSH
    requiresPSR:    rule('red',    'red',    'none',   'none'),   // bloque con PSH
    requiresLocPrd: 'red',                                        // universal
    requiresLocSrc: rule('red',    'yellow', 'none',   'red'),
    requiresPlantAsOrigin: rule('red', 'none', 'none', 'none'),   // LocSrc LOCFR=planta PSH
    requiresVendorArc:     rule('none','none','red',   'none'),   // LocSrc llega a planta consumidora
    requiresAnyOriginDest: rule('none','yellow','none','red'),    // LocSrc algún origen+destino
    pleadtimeZero:  rule('red',    'yellow', 'none',   'none')
  };
}

/* ── Toggle de panels opcionales ── */
function mattypeToggleExcludePanel() {
  var body = document.getElementById('mattypeExcludeBody');
  var arr  = document.getElementById('mattypeExcludeArr');
  if (!body || !arr) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  arr.textContent = open ? '▶' : '▼';
  if (!open) mattyeRenderExclude();
}

function mattypeToggleCatPanel() {
  var body = document.getElementById('mattypeCatBody');
  var arr  = document.getElementById('mattypeCatArr');
  if (!body || !arr) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  arr.textContent = open ? '▶' : '▼';
  if (!open) mattyeRenderCategorize();
}

function mattypeResetExclude() {
  Object.keys(MATTYPE_CFG).forEach(function(k) { MATTYPE_CFG[k].excluded = false; });
  mattypeSave();
  mattyeRenderExclude();
  _mattyeUpdateExcludeSummary();
}

function mattypeResetCat() {
  Object.keys(MATTYPE_CFG).forEach(function(k) { MATTYPE_CFG[k].categories = new Set(); });
  mattypeSave();
  mattyeRenderCategorize();
  _mattyeUpdateCatSummary();
}
