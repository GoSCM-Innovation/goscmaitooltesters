/* ═══════════════════════════════════════════════════════════════
   EXTRA FIELDS — Campos adicionales de datos maestros
   Paso opcional entre "Categorizar tipos" y "Ejecutar análisis"
   en Supply Network Analyzer y Production Analyzer (BOM).
   ═══════════════════════════════════════════════════════════════ */

var EF_SEL = {
  sn: { product: [], location: [], customer: [], locationSource: [], customerSource: [] },
  pa: { product: [], location: [], resource: [], resourceLocation: [], psh: [], psi: [], psr: [] }
};

/* Campos obligatorios mostrados en Excel (bloqueados ON en modal) */
var EF_MAND_VISIBLE = {
  sn: {
    product:        ['PRDID', 'PRDDESCR', 'MATTYPEID'],
    location:       ['LOCID', 'LOCDESCR', 'LOCTYPE'],
    customer:       ['CUSTID', 'CUSTDESCR'],
    locationSource: ['PRDID', 'LOCFR', 'LOCID', 'TLEADTIME'],
    customerSource: ['PRDID', 'LOCID', 'CUSTID', 'CLEADTIME']
  },
  pa: {
    product:          ['PRDID', 'PRDDESCR', 'MATTYPEID'],
    location:         ['LOCID', 'LOCDESCR', 'LOCTYPE'],
    resource:         ['RESID', 'RESDESCR'],
    resourceLocation: ['RESID', 'LOCID'],
    psh:              ['SOURCEID', 'PRDID', 'LOCID', 'SOURCETYPE', 'PLEADTIME', 'OUTPUTCOEFFICIENT', 'PRATIO'],
    psi:              ['SOURCEID', 'PRDID', 'COMPONENTCOEFFICIENT', 'ISALTITEM'],
    psr:              ['SOURCEID', 'RESID']
  }
};

/* Campos técnicos de filtro — siempre en $select, nunca mostrados */
var EF_MAND_HIDDEN = {
  sn: {
    product:        [],
    location:       ['LOCVALID'],
    customer:       ['CUSTVALID'],
    locationSource: ['TINVALID'],
    customerSource: ['CINVALID']
  },
  pa: {
    product:          [],
    location:         ['LOCVALID'],
    resource:         [],
    resourceLocation: [],
    psh:              ['PINVALID'],
    psi:              [],
    psr:              []
  }
};

/* Metadatos de entidades por namespace para renderizar botones */
var EF_ENTITY_META = {
  sn: [
    { key: 'product',        label: 'Product',              sel: 'selSNProduct' },
    { key: 'location',       label: 'Location',             sel: 'selSNLocMaster' },
    { key: 'customer',       label: 'Customer',             sel: 'selSNCustMaster' },
    { key: 'locationSource', label: 'Location Source',      sel: 'selSNLocation' },
    { key: 'customerSource', label: 'Customer Source',      sel: 'selSNCustomer' }
  ],
  pa: [
    { key: 'product',          label: 'Product',              sel: 'selPAProduct' },
    { key: 'location',         label: 'Location',             sel: 'selPALocMaster' },
    { key: 'resource',         label: 'Resource',             sel: 'selPAResMaster' },
    { key: 'resourceLocation', label: 'Resource Location',    sel: 'selPAResLoc' },
    { key: 'psh',              label: 'Prod Source Header',   sel: 'selPAHeader' },
    { key: 'psi',              label: 'Prod Source Item',     sel: 'selPAItem' },
    { key: 'psr',              label: 'Prod Source Resource', sel: 'selPAResource' }
  ]
};

var _efModalNs     = '';
var _efModalEntity = '';
var _efModalTmp    = [];  // selección temporal mientras el modal está abierto

/* ── Persistencia ── */
function _efLsKey(ns, entity) {
  var pa = (typeof CFG !== 'undefined' && CFG && CFG.pa) ? CFG.pa : 'default';
  return 'ef_sel_' + ns + '_' + entity + '_' + pa;
}

function efSaveEntity(ns, entity, fields) {
  EF_SEL[ns][entity] = fields.slice();
  try { localStorage.setItem(_efLsKey(ns, entity), JSON.stringify(fields)); } catch (e) {}
}

function efLoadAll() {
  ['sn', 'pa'].forEach(function (ns) {
    Object.keys(EF_SEL[ns]).forEach(function (entity) {
      try {
        var raw = localStorage.getItem(_efLsKey(ns, entity));
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) EF_SEL[ns][entity] = parsed;
        }
      } catch (e) {}
    });
  });
}

/* ── Helpers para integración en fetch / Excel ── */

function efGetSelect(ns, entity) {
  var vis   = (EF_MAND_VISIBLE[ns] && EF_MAND_VISIBLE[ns][entity])  ? EF_MAND_VISIBLE[ns][entity]  : [];
  var hid   = (EF_MAND_HIDDEN[ns]  && EF_MAND_HIDDEN[ns][entity])   ? EF_MAND_HIDDEN[ns][entity]   : [];
  var extra = (EF_SEL[ns] && EF_SEL[ns][entity]) ? EF_SEL[ns][entity] : [];
  var all   = vis.concat(hid);
  extra.forEach(function (f) { if (all.indexOf(f) < 0) all.push(f); });
  return all.join(',');
}

function efGetExtraHeaders(ns, entity) {
  return (EF_SEL[ns] && EF_SEL[ns][entity]) ? EF_SEL[ns][entity].slice() : [];
}

function efGetExtraValues(ns, entity, record) {
  var fields = (EF_SEL[ns] && EF_SEL[ns][entity]) ? EF_SEL[ns][entity] : [];
  if (!record) return fields.map(function () { return ''; });
  return fields.map(function (f) {
    var v = record[f];
    return v != null ? String(v) : '';
  });
}

/* Inserta headers + notes + groups de campos extra en la posición correcta (in-place) */
function efInjectHeaders(headers, notes, groups, ns, entity, afterIdx) {
  var extra = efGetExtraHeaders(ns, entity);
  if (!extra.length) return;
  var insertAt = afterIdx + 1;
  extra.forEach(function (f, i) {
    headers.splice(insertAt + i, 0, f);
    if (notes)  notes.splice(insertAt + i,  0, 'Campo adicional: ' + f);
    if (groups) groups.splice(insertAt + i, 0, 'ibp');
  });
}

/* Inserta valores extra en la posición correcta dentro de la fila (in-place) */
function efInjectRow(row, ns, entity, afterIdx, record) {
  var vals = efGetExtraValues(ns, entity, record);
  if (!vals.length) return;
  var insertAt = afterIdx + 1;
  vals.forEach(function (v, i) { row.splice(insertAt + i, 0, v); });
}

/* ── Render de botones de entidades en el panel ── */
function efRenderEntityButtons(ns) {
  var container = document.getElementById('efButtons_' + ns);
  if (!container) return;
  var metas = EF_ENTITY_META[ns] || [];
  var html  = '';
  metas.forEach(function (m) {
    var sel = document.getElementById(m.sel);
    if (!sel || !sel.value) return;
    var extra = (EF_SEL[ns][m.key] || []).length;
    var badge = extra > 0
      ? '<span class="ef-count-badge">' + extra + ' extra</span>'
      : '';
    html += '<button class="ef-entity-btn" onclick="efOpenModal(\'' +
      escH(ns) + '\',\'' + escH(m.key) + '\',\'' + escH(m.label) + '\',\'' + escH(m.sel) + '\')">' +
      escH(m.label) + badge + '</button>';
  });
  if (!html) {
    html = '<p style="font-size:12px;color:var(--text2);">Configura las entidades en el paso ① para habilitar la selección de campos.</p>';
  }
  container.innerHTML = html;
}

/* ── Modal ── */

function efOpenModal(ns, entityKey, displayName, selectorId) {
  _efModalNs     = ns;
  _efModalEntity = entityKey;
  _efModalTmp    = (EF_SEL[ns][entityKey] || []).slice();

  var dlg = document.getElementById('efModal');
  if (!dlg) return;

  document.getElementById('efModalTitle').textContent = 'Campos adicionales — ' + displayName;

  var selEl      = document.getElementById(selectorId);
  var entityName = selEl ? selEl.value : '';
  var entityObj  = (typeof ENTITIES !== 'undefined')
    ? ENTITIES.find(function (e) { return e.name === entityName; })
    : null;

  var allFields  = entityObj ? entityObj.fields : [];
  var mandVis    = (EF_MAND_VISIBLE[ns] && EF_MAND_VISIBLE[ns][entityKey])  ? EF_MAND_VISIBLE[ns][entityKey]  : [];
  var mandHid    = (EF_MAND_HIDDEN[ns]  && EF_MAND_HIDDEN[ns][entityKey])   ? EF_MAND_HIDDEN[ns][entityKey]   : [];
  var reserved   = mandVis.concat(mandHid);

  var optional   = allFields.filter(function (f) { return reserved.indexOf(f) < 0; });

  /* Render list */
  _efRenderList(mandVis, optional, '');
  _efUpdateCount();

  /* Clear search */
  var srch = document.getElementById('efModalSearch');
  if (srch) srch.value = '';

  dlg.showModal ? dlg.showModal() : (dlg.open = true);
}

function _efRenderList(mandVis, optional, filter) {
  var list = document.getElementById('efModalList');
  if (!list) return;

  var q = filter.trim().toUpperCase();
  var html = '';

  /* Mandatory visible fields (locked ON) */
  if (mandVis.length) {
    html += '<div class="ef-section-label">Campos obligatorios</div>';
    mandVis.forEach(function (f) {
      if (q && f.toUpperCase().indexOf(q) < 0) return;
      html += '<div class="ef-field-item">' +
        '<label class="ef-toggle-wrap locked">' +
          '<input type="checkbox" checked disabled>' +
          '<span class="ef-toggle-slider"></span>' +
        '</label>' +
        '<span class="ef-field-name">' + escH(f) + '</span>' +
        '<span class="ef-mandatory-badge">Obligatorio</span>' +
      '</div>';
    });
  }

  /* Optional fields */
  var visOptional = optional.filter(function (f) { return !q || f.toUpperCase().indexOf(q) >= 0; });
  if (visOptional.length) {
    html += '<div class="ef-section-label">Campos adicionales disponibles</div>';
    visOptional.forEach(function (f) {
      var checked = _efModalTmp.indexOf(f) >= 0;
      html += '<div class="ef-field-item">' +
        '<label class="ef-toggle-wrap">' +
          '<input type="checkbox"' + (checked ? ' checked' : '') +
            ' onchange="efToggleField(\'' + escH(f) + '\',this.checked)">' +
          '<span class="ef-toggle-slider"></span>' +
        '</label>' +
        '<span class="ef-field-name">' + escH(f) + '</span>' +
      '</div>';
    });
  } else if (!mandVis.length || (q && !mandVis.some(function (f) { return f.toUpperCase().indexOf(q) >= 0; }))) {
    html += '<p style="font-size:12px;color:var(--text2);padding:8px 0;">Sin resultados para "' + escH(filter) + '".</p>';
  }

  list.innerHTML = html;
}

function efToggleField(fieldName, checked) {
  var idx = _efModalTmp.indexOf(fieldName);
  if (checked && idx < 0)  _efModalTmp.push(fieldName);
  if (!checked && idx >= 0) _efModalTmp.splice(idx, 1);
  _efUpdateCount();
}

function _efUpdateCount() {
  var el = document.getElementById('efModalCount');
  if (!el) return;
  var n = _efModalTmp.length;
  el.textContent = n > 0 ? n + ' campo' + (n > 1 ? 's' : '') + ' seleccionado' + (n > 1 ? 's' : '') : '';
}

function efModalFilter() {
  var q   = (document.getElementById('efModalSearch') || {}).value || '';
  var ns  = _efModalNs;
  var key = _efModalEntity;

  var selEl      = document.getElementById(_efEntitySel(ns, key));
  var entityName = selEl ? selEl.value : '';
  var entityObj  = (typeof ENTITIES !== 'undefined')
    ? ENTITIES.find(function (e) { return e.name === entityName; })
    : null;
  var allFields  = entityObj ? entityObj.fields : [];
  var mandVis    = (EF_MAND_VISIBLE[ns] && EF_MAND_VISIBLE[ns][key]) ? EF_MAND_VISIBLE[ns][key] : [];
  var mandHid    = (EF_MAND_HIDDEN[ns]  && EF_MAND_HIDDEN[ns][key])  ? EF_MAND_HIDDEN[ns][key]  : [];
  var reserved   = mandVis.concat(mandHid);
  var optional   = allFields.filter(function (f) { return reserved.indexOf(f) < 0; });
  _efRenderList(mandVis, optional, q);
}

function _efEntitySel(ns, key) {
  var metas = EF_ENTITY_META[ns] || [];
  for (var i = 0; i < metas.length; i++) {
    if (metas[i].key === key) return metas[i].sel;
  }
  return '';
}

function efModalSave() {
  efSaveEntity(_efModalNs, _efModalEntity, _efModalTmp);
  efRenderEntityButtons(_efModalNs);
  efModalClose();
}

function efModalClose() {
  var dlg = document.getElementById('efModal');
  if (!dlg) return;
  dlg.close ? dlg.close() : (dlg.open = false);
  _efModalTmp = [];
}

/* ── Navegación SN ── */

function snContinueToExtraFields() {
  _snCloseMattypeBody('snmattypeCatBody', 'snmattypeCatArr');
  efLoadAll();
  efRenderEntityButtons('sn');
  var ef = document.getElementById('panelSNExtraFields');
  if (ef) {
    ef.classList.remove('hidden');
    ef.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function snBackToExtraFields() {
  var run = document.getElementById('panelSNExportMode');
  if (run) run.classList.add('hidden');
  var ef = document.getElementById('panelSNExtraFields');
  if (ef) ef.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function snBackFromExtraFieldsToCategories() {
  var ef = document.getElementById('panelSNExtraFields');
  if (ef) ef.classList.add('hidden');
  _snOpenMattypeBody('snmattypeCatBody', 'snmattypeCatArr');
  var cat = document.getElementById('panelSNCategories');
  if (cat) cat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Navegación PA ── */

function paContinueToExtraFields() {
  _paCloseMattypeBody('mattypeCatBody', 'mattypeCatArr');
  efLoadAll();
  efRenderEntityButtons('pa');
  var ef = document.getElementById('panelPAExtraFields');
  if (ef) {
    ef.classList.remove('hidden');
    ef.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function paBackToExtraFields() {
  var run = document.getElementById('panelPAExportMode');
  if (run) run.classList.add('hidden');
  var ef = document.getElementById('panelPAExtraFields');
  if (ef) ef.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function paBackFromExtraFieldsToCategories() {
  var ef = document.getElementById('panelPAExtraFields');
  if (ef) ef.classList.add('hidden');
  _paOpenMattypeBody('mattypeCatBody', 'mattypeCatArr');
  var cat = document.getElementById('panelPACategories');
  if (cat) cat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
