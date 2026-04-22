/* ═══════════════════════════════════════════════════════════════
   MATTYPE-CONFIG.JS
   Gestión de tipos de material para Production Hierarchy Analyzer.
   • Detecta MATTYPEID únicos desde el maestro de productos.
   • Bloque 1: Excluir tipos — lista con toggle switch (ON = incluido).
   • Bloque 2: Categorizar tipos incluidos — matriz de toggles.
   • Multi-categoría permitida: un tipo puede estar en más de una.
   • Persistencia en localStorage por planning area.
   • Sin categoría = todas las métricas + reglas más permisivas (🟡).
   ═══════════════════════════════════════════════════════════════ */

var MATTYPE_CFG = {};   // mattypeid → { excluded: bool, categories: Set, count: number }

/* ── Categorías disponibles ── */
var MATTYPE_CATS = [
  {
    id: 'finished', label: 'Producto Terminado', color: 'var(--accent)',
    tooltip: {
      desc: 'Producto fabricado internamente mediante un proceso de producción.',
      rules: [
        'Requiere BOM completo (PSH + componentes PSI)',
        'Requiere recurso productivo (PSR)',
        'Debe tener ruta desde planta de origen',
        'Lead time de producción (PLEADTIME) obligatorio — si es 0 se marca 🔴',
        'Falta de Location Source = 🔴 crítico'
      ],
      example: 'FG_BOTELLA_500ML, PT_SHAMPOO_1L'
    }
  },
  {
    id: 'semi', label: 'Semiterminado', color: 'var(--cyan)',
    tooltip: {
      desc: 'Componente fabricado internamente que alimenta otro proceso productivo; no se entrega directamente al cliente.',
      rules: [
        'Requiere BOM (PSH + PSI) y recurso (PSR)',
        'No exige ruta directa a cliente — ausencia = 🟡 advertencia',
        'Falta de Location Source = 🟡 advertencia (no crítico)',
        'PLEADTIME = 0 se marca 🟡',
        'Sin origen de planta no se penaliza'
      ],
      example: 'SF_TAPA_ROSCA, WIP_MEZCLA_BASE'
    }
  },
  {
    id: 'rawmat', label: 'Mat. Prima / Insumo', color: 'var(--green)',
    tooltip: {
      desc: 'Ítem adquirido externamente; no se fabrica ni transforma internamente.',
      rules: [
        'No requiere BOM (PSH/PSI) ni recurso (PSR)',
        'Debe existir arco de proveedor/origen en la red — si falta = 🔴',
        'No se evalúa PLEADTIME ni ruta a cliente',
        'No necesita estar asociado a una planta como origen'
      ],
      example: 'RM_RESINA_PET, INS_COLORANTE_AZUL'
    }
  },
  {
    id: 'trading', label: 'Mercadería', color: 'var(--purple)',
    tooltip: {
      desc: 'Producto comprado y revendido sin transformación (trading / reventa).',
      rules: [
        'No requiere BOM (PSH/PSI) ni recurso (PSR)',
        'Debe tener Location Source definida — si falta = 🔴',
        'Debe existir ruta de abastecimiento completa (origen → destino) — si falta = 🔴',
        'PLEADTIME no se evalúa'
      ],
      example: 'TR_ACCESORIO_VALVULA, MER_FILTRO_REPUESTO'
    }
  }
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
      excluded:   MATTYPE_CFG[k].excluded,
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

/* ── Inicializar MATTYPE_CFG desde mapa de productos ── */
function mattyeInit(prdMap) {
  var counts = {};
  Object.keys(prdMap).forEach(function(prdid) {
    var mt = str(prdMap[prdid].MATTYPEID || '');
    if (!mt) return;
    counts[mt] = (counts[mt] || 0) + 1;
  });

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
   RENDER — Bloque 1: Excluir tipos (lista con toggle switch)
   Toggle ON  = incluido en el análisis (estado inicial)
   Toggle OFF = excluido del análisis
   ═══════════════════════════════════════════════════════════════ */
function mattyeRenderExclude() {
  var wrap = document.getElementById('mattypeExcludeWrap');
  if (!wrap) return;

  var types = Object.keys(MATTYPE_CFG).sort();
  if (!types.length) {
    wrap.innerHTML = '<p class="mattype-empty">Carga datos primero para detectar los tipos de material.</p>';
    return;
  }

  var html = '<table class="mattype-toggle-table"><thead><tr>' +
    '<th>Tipo</th><th>Productos</th><th>Incluir en análisis</th>' +
    '</tr></thead><tbody>';

  types.forEach(function(mt) {
    var cfg      = MATTYPE_CFG[mt];
    var included = !cfg.excluded;
    var mtSafe   = escH(mt).replace(/'/g, '&#39;');
    html += '<tr class="' + (included ? '' : 'mattype-row-excluded') + '">' +
      '<td><span class="mattype-code">' + escH(mt) + '</span></td>' +
      '<td class="mattype-col-count">' + (cfg.count || 0) + ' prods</td>' +
      '<td class="mattype-col-toggle">' +
        '<label class="mattype-toggle">' +
          '<input type="checkbox"' + (included ? ' checked' : '') +
            ' onchange="mattypeToggleExclude(\'' + mtSafe + '\',this.checked)">' +
          '<span class="mattype-toggle-slider"></span>' +
        '</label>' +
        '<span class="mattype-toggle-label">' + (included ? 'Incluido' : 'Excluido') + '</span>' +
      '</td></tr>';
  });

  html += '</tbody></table>';
  html += '<p class="mattype-note">ℹ️ Los tipos excluidos que actúen como componentes PSI de productos incluidos se validan igualmente en contexto.</p>';
  wrap.innerHTML = html;
  _mattyeUpdateExcludeSummary();
}

function mattypeToggleExclude(mt, included) {
  if (!MATTYPE_CFG[mt]) return;
  MATTYPE_CFG[mt].excluded = !included;
  mattypeSave();
  mattyeRenderExclude();
  _mattyeUpdateExcludeSummary();
}

function _mattyeUpdateExcludeSummary() {
  var excl   = Object.keys(MATTYPE_CFG).filter(function(k) { return MATTYPE_CFG[k].excluded; });
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
   RENDER — Bloque 2: Categorizar tipos (matriz de toggles)
   Filas = tipos incluidos · Columnas = 4 categorías
   Estado inicial: todos desactivados (sin categorización)
   ═══════════════════════════════════════════════════════════════ */
function mattyeRenderCategorize() {
  var wrap = document.getElementById('mattypeCatWrap');
  if (!wrap) return;

  var types = Object.keys(MATTYPE_CFG).filter(function(k) { return !MATTYPE_CFG[k].excluded; }).sort();
  if (!types.length) {
    wrap.innerHTML = '<p class="mattype-empty">No hay tipos incluidos para categorizar.</p>';
    return;
  }

  var html = '<div class="mattype-matrix-scroll"><table class="mattype-matrix-table"><thead><tr>' +
    '<th class="mattype-matrix-th-type">Tipo</th>' +
    '<th class="mattype-matrix-th-count">Productos</th>';
  MATTYPE_CATS.forEach(function(cat) {
    var tip = cat.tooltip;
    var rulesHtml = tip.rules.map(function(r) {
      return '<li>' + escH(r) + '</li>';
    }).join('');
    var tooltipHtml =
      '<span class="mattype-cat-help">?' +
        '<span class="mattype-cat-tooltip">' +
          '<div class="mattype-cat-tooltip-title">' + escH(cat.label) + '</div>' +
          '<div>' + escH(tip.desc) + '</div>' +
          '<ul class="mattype-cat-tooltip-rules">' + rulesHtml + '</ul>' +
          '<div class="mattype-cat-tooltip-ex">Ej: ' + escH(tip.example) + '</div>' +
        '</span>' +
      '</span>';
    html += '<th class="mattype-matrix-th-cat" style="color:' + cat.color + '">' +
      escH(cat.label) + tooltipHtml + '</th>';
  });
  html += '</tr></thead><tbody>';

  types.forEach(function(mt) {
    var cfg    = MATTYPE_CFG[mt];
    var mtSafe = escH(mt).replace(/'/g, '&#39;');
    html += '<tr>' +
      '<td><span class="mattype-code">' + escH(mt) + '</span></td>' +
      '<td class="mattype-col-count">' + (cfg.count || 0) + ' prods</td>';
    MATTYPE_CATS.forEach(function(cat) {
      var checked = cfg.categories.has(cat.id);
      html += '<td class="mattype-matrix-cell">' +
        '<label class="mattype-toggle" data-cat="' + cat.id + '">' +
          '<input type="checkbox"' + (checked ? ' checked' : '') +
            ' onchange="mattypeToggleCat(\'' + mtSafe + '\',\'' + cat.id + '\',this.checked)">' +
          '<span class="mattype-toggle-slider"></span>' +
        '</label>' +
      '</td>';
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html += '<p class="mattype-note">ℹ️ Un tipo puede estar en más de una categoría. Sin categoría = todas las métricas con reglas en modo 🟡.</p>';
  wrap.innerHTML = html;
  _mattyeUpdateCatSummary();
  _mattypeCatBindTooltips(wrap);
}

function _mattypeCatBindTooltips(wrap) {
  wrap.querySelectorAll('.mattype-cat-help').forEach(function(el) {
    el.addEventListener('mouseenter', function() {
      var inner = el.querySelector('.mattype-cat-tooltip');
      if (!inner) return;
      var tip = document.createElement('div');
      tip.id = 'mattype-floating-tooltip';
      tip.innerHTML = inner.innerHTML;
      document.body.appendChild(tip);
      var rect = el.getBoundingClientRect();
      var tipW = 240;
      var left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
      var top  = rect.top - tip.offsetHeight - 10;
      if (top < 8) top = rect.bottom + 10;
      tip.style.left = left + 'px';
      tip.style.top  = top  + 'px';
    });
    el.addEventListener('mouseleave', function() {
      var t = document.getElementById('mattype-floating-tooltip');
      if (t) t.parentNode.removeChild(t);
    });
  });
}

function mattypeToggleCat(mt, catId, checked) {
  if (!MATTYPE_CFG[mt]) return;
  if (checked) {
    MATTYPE_CFG[mt].categories.add(catId);
  } else {
    MATTYPE_CFG[mt].categories.delete(catId);
  }
  mattypeSave();
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
    sumEl.textContent = catted.length + ' tipo(s) categorizado(s)' +
      (uncatted > 0 ? ' · ' + uncatted + ' sin categoría (reglas 🟡)' : '');
  }
}

/* ═══════════════════════════════════════════════════════════════
   PANELES OPCIONALES — toggle de expansión/colapso
   ═══════════════════════════════════════════════════════════════ */
function mattypeToggleExcludePanel() {
  var body = document.getElementById('mattypeExcludeBody');
  var arr  = document.getElementById('mattypeExcludeArr');
  if (!body || !arr) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  arr.textContent    = open ? '▶' : '▼';
  if (!open) mattyeRenderExclude();
}

function mattypeToggleCatPanel() {
  var body = document.getElementById('mattypeCatBody');
  var arr  = document.getElementById('mattypeCatArr');
  if (!body || !arr) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  arr.textContent    = open ? '▶' : '▼';
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

/* ═══════════════════════════════════════════════════════════════
   API PÚBLICA — usada por prodAnalyzer.js
   ═══════════════════════════════════════════════════════════════ */

/* Devuelve las categorías efectivas para un MATTYPEID.
   Sin categoría → ['all']   (tratado como todas las categorías).
   Excluido      → ['excluded'].
   Multi-cat     → ['finished','semi',...] */
function mattypeGetCategories(mattypeid) {
  var cfg = MATTYPE_CFG[mattypeid];
  if (!cfg)                       return ['uncategorized'];
  if (cfg.excluded)               return ['excluded'];
  if (cfg.categories.size === 0)  return ['uncategorized'];
  return Array.from(cfg.categories);
}

/* ¿Está excluido este MATTYPEID? */
function mattypeIsExcluded(mattypeid) {
  var cfg = MATTYPE_CFG[mattypeid];
  return cfg ? cfg.excluded : false;
}

/* Resolución de severidad cuando hay múltiples categorías con reglas distintas.
   Devuelve el mínimo de severidad (más permisivo).
   Orden: 'red' > 'yellow' > 'info' > 'none' */
function mattypeResolveSeverity(severities) {
  var order = ['none', 'info', 'yellow', 'red'];
  var min = 'red';
  severities.forEach(function(s) {
    if (order.indexOf(s) < order.indexOf(min)) min = s;
  });
  return min;
}

/* Reglas de análisis por categoría.
   cats = array de category IDs (resultado de mattypeGetCategories) */
function mattypeGetRules(cats) {
  var isAll          = cats.indexOf('all') >= 0;
  var isUncategorized = cats.indexOf('uncategorized') >= 0;

  function rule(finishedVal, semiVal, rawmatVal, tradingVal) {
    if (isUncategorized) {
      var anyNonNone = [finishedVal, semiVal, rawmatVal, tradingVal]
        .some(function(v) { return v !== 'none'; });
      return anyNonNone ? 'yellow' : 'none';
    }
    if (isAll) return _permissive([finishedVal, semiVal, rawmatVal, tradingVal]);
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
    var best  = 'red';
    vals.forEach(function(v) {
      if (order.indexOf(v) > order.indexOf(best)) best = v;
    });
    return best;
  }

  return {
    requiresPSH:           rule('red',    'red',    'none',   'none'),
    requiresPSI:           rule('red',    'red',    'none',   'none'),
    requiresPSR:           rule('red',    'red',    'none',   'none'),
    requiresLocPrd:        'red',
    requiresPlantAsOrigin: rule('red',    'none',   'none',   'none'),
    requiresVendorArc:     rule('none',   'none',   'red',    'none'),
    requiresAnyOriginDest: rule('none',   'yellow', 'none',   'red'),
    pleadtimeZero:         rule('red',    'yellow', 'none',   'none'),
    outputCoeffZero:       rule('red',    'yellow', 'none',   'none'),
    isCoproductOnly:       rule('yellow', 'yellow', 'none',   'none'),
    hasPSHUnexpected:      rule('none',   'none',   'yellow', 'yellow'),
    notConsumedInBOM:      rule('none',   'yellow', 'yellow', 'none'),
    tleadtimeZero:         rule('yellow', 'yellow', 'yellow', 'yellow')
  };
}
