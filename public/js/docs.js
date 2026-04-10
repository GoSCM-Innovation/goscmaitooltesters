// @ts-nocheck
// ════════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════════
let files = [];
let xlsBuf = null;
let parsedIntegrations = [];   // [{sheetName, pkg, parsed, paramRow}] — filled after scan

// ── Jobs-mode state ──
let docsMode = 'zip';           // 'zip' | 'jobs'

const SVC_APPJOB   = '/sap/opu/odata/sap/BC_EXT_APPJOB_MANAGEMENT;v=0002';
const JCE_DATA_INT = 'DATA INTEGRATION';  // substring of JceText that identifies CI-DS steps
const ATL_NO_GROUP = 'Sin grupo ATL';
let fetchedJobs = [];           // raw job data from API
let jobsFiles = [];             // [{name, data: ArrayBuffer}] ZIPs in jobs mode
let atlFiles  = [];             // [{name, text}] uploaded ATL files
let atlParsed = [];             // parsed ATL structures

// ════════════════════════════════════════════════════════════
//  IBP FIELD DESCRIPTIONS — fetched from OData $metadata
//  Queries MASTER_DATA_API_SRV and PLANNING_DATA_API_SRV in
//  parallel; extracts Property[Name] → sap:label mappings.
//  Returns {} silently when no IBP connection is available.
// ════════════════════════════════════════════════════════════
async function fetchIbpFieldDescriptions() {
  if (typeof CFG === 'undefined' || !CFG.url || !CFG.user || !CFG.pass) return {};
  const services = ['MASTER_DATA_API_SRV', 'PLANNING_DATA_API_SRV'];
  const descs = {};
  const results = await Promise.allSettled(
    services.map(svc => {
      return fetch('/api/proxy-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: CFG.url, service: svc, user: CFG.user, password: CFG.pass })
      }).then(r => r.ok ? r.text() : Promise.reject(r.status));
    })
  );
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const xml = new DOMParser().parseFromString(r.value, 'text/xml');
    xml.querySelectorAll('Property').forEach(p => {
      const name  = p.getAttribute('Name');
      const label = p.getAttribute('sap:label') || '';
      // MASTER_DATA_API_SRV is processed first — don't overwrite with PLANNING_DATA
      if (name && label && !descs[name]) descs[name] = label;
    });
  }
  return descs;
}

// ════════════════════════════════════════════════════════════
//  UI HELPERS
// ════════════════════════════════════════════════════════════
const docsLogEl   = document.getElementById('docs-log');
const docsLogHint = document.getElementById('docs-log-hint');
function docsLog(msg, cls = 'l-line') {
  docsLogEl.style.display = 'block';
  docsLogHint.style.display = 'none';
  const d = document.createElement('div');
  d.className = cls; d.textContent = msg;
  docsLogEl.appendChild(d);
  docsLogEl.scrollTop = docsLogEl.scrollHeight;
}
function setP(p) {
  document.getElementById('pw').style.display = 'block';
  document.getElementById('pb').style.width = p + '%';
}

// ════════════════════════════════════════════════════════════
//  FILE HANDLING
// ════════════════════════════════════════════════════════════
const dz = document.getElementById('dz');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addFiles([...e.dataTransfer.files]); });
document.getElementById('fi').addEventListener('change', e => addFiles([...e.target.files]));

function addFiles(list) {
  list.filter(f => f.name.endsWith('.zip')).forEach(f => {
    if (files.find(x => x.name === f.name)) return;
    const r = new FileReader();
    r.onload = ev => { files.push({ name: f.name, data: ev.target.result }); renderFiles(); };
    r.readAsArrayBuffer(f);
  });
}
function removeFile(i) { files.splice(i, 1); renderFiles(); }
function renderFiles() {
  document.getElementById('file-list').innerHTML = files.map((f, i) => `
    <div class="file-tag">
      <span class="ico">📦</span>
      <span class="name">${escH(f.name)}</span>
      <span class="size">${(f.data.byteLength/1024).toFixed(0)} KB</span>
      <button class="rm" onclick="removeFile(${i})">✕</button>
    </div>`).join('');
  document.getElementById('gen-btn').disabled = files.length === 0;
}

// ════════════════════════════════════════════════════════════
//  XML PARSING  (browser DOMParser — uses localName + getAttribute)
//
//  KEY INSIGHT: In browser DOMParser with namespace-prefixed XML:
//    el.localName  = 'DataStore'   (no prefix)
//    el.tagName    = 'datastore:DataStore'
//    el.getAttribute('xmi:type')   ← correct way to get xmi:type
//    el.getAttribute('{...}type')  ← WRONG in browser (Python-style Clark notation)
// ════════════════════════════════════════════════════════════

function xmiType(el) {
  return el.getAttribute('xmi:type') || el.getAttributeNS('http://www.omg.org/XMI','type') || '';
}

function getProp(el, name) {
  for (const c of el.children) {
    if (c.localName === 'properties' && c.getAttribute('name') === name)
      return c.getAttribute('value') || '';
  }
  return '';
}

function buildDsIndexMap(root) {
  const map = {};
  let i = 0;
  for (const c of root.children) {
    if (c.localName === 'DataStore') map[i] = c.getAttribute('name') || `DS_${i}`;
    i++;
  }
  return map;
}

function dsFromRef(ref, dsIdx) {
  if (!ref) return '';
  const m = ref.match(/\/(\d+)/);
  return m ? (dsIdx[+m[1]] || ref) : ref;
}

/** Build real-table lookup: displayName/outputSchemaName → { table, ds } (only TableReaders) */
function buildSchemaMap(dfEl, dsIdx) {
  const map = {};
  for (const el of dfEl.children) {
    if (el.localName !== 'elements') continue;
    const typ   = xmiType(el);
    const dname = el.getAttribute('displayName') || '';
    if (!typ.includes('TableReader')) continue;
    const tname = el.getAttribute('tableName') || el.getAttribute('outputSchemaName') || dname;
    const ds    = dsFromRef(el.getAttribute('referencedDataStore') || '', dsIdx);
    map[dname]  = { table: tname, ds };
    const oname = el.getAttribute('outputSchemaName');
    if (oname && oname !== dname) map[oname] = { table: tname, ds };
  }
  return map;
}

/** Parse all QueryTransform + XMLMapTransform schemas → { transformName → { fields, filterExpr } } */
function parseTransforms(dfEl) {
  const ts = {};
  for (const el of dfEl.children) {
    if (el.localName !== 'elements') continue;
    const typ = xmiType(el);
    // Include QueryTransform AND XMLMapTransform (RFC/BAPI outputs) so expand can traverse them
    if (!typ.includes('QueryTransform') && !typ.includes('XMLMapTransform')) continue;
    const dname = el.getAttribute('displayName') || '';
    let outSchema = null;
    for (const c of el.children) { if (c.localName === 'outputSchema') { outSchema = c; break; } }
    if (!outSchema) continue;
    const filterExpr = outSchema.getAttribute('filterExpression') || '';
    const fields = [];
    for (const node of outSchema.children) {
      if (node.localName !== 'schemaNodes') continue;
      fields.push({
        name : node.getAttribute('name') || '',
        desc : node.getAttribute('description') || '',
        proj : node.getAttribute('projectionExpression') || ''
      });
    }
    ts[dname] = { fields, filterExpr };
  }
  return ts;
}

// ── EXPRESSION EXPANSION ──────────────────────────────────────────────────────
// Fully expand any TransformN.Field reference by recursively substituting its
// projectionExpression. This avoids "first-match" errors (e.g. inside decode()
// conditions) and preserves the complete function wrapper for the ops column.
// After expansion, only real-table refs (not TransformN) remain.
//
// We need two ref patterns:
//  - Normal:  TABLENAME.FIELDNAME
//  - Quoted:  "/BI0/PSALES_OFF".FIELDNAME  (BW InfoObjects use "/" in names)

// Matches both normal and quoted table.field references
// Matches all three Table.Field combinations:
//   1. "quoted"."field" or "quoted".field   — BW InfoObjects, e.g. "/BI0/PSALES_OFF".SALES_OFF
//   2. unquoted."quoted-field"              — e.g. Transform3."/BIC/ZCUSTOMER"
//   3. unquoted.unquoted                    — standard SAP, e.g. MARA.MATNR
const _REF = /(?:"([^"]+)"\s*\.\s*(?:"([^"]+)"|([A-Za-z_\/][A-Za-z0-9_\/]*)))|(?:\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*"([^"]+)")|(?:\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_\/][A-Za-z0-9_\/]*))/g;

// Extract { schema, field } from a regex match of _REF
function refFromMatch(m) {
  if (m[1] !== undefined) return { schema: m[1], field: m[2] || m[3] };  // "quoted".field
  if (m[4] !== undefined) return { schema: m[4], field: m[5] };           // unquoted."quoted"
  return { schema: m[6], field: m[7] };                                    // unquoted.unquoted
}

function expandExpr(expr, ts, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 30 || !expr) return expr || '';
  return expr.replace(_REF, function() {
    const args = Array.from(arguments);
    const r = refFromMatch(args);
    if (!(r.schema in ts)) return args[0];        // real table ref → keep as is

    const f = ts[r.schema].fields.find(x => x.name === r.field);
    if (!f || !f.proj) return args[0];            // no projection → keep as is

    // Handle three-part RFC references: Transform3.ET_BACKORDER.ID
    // where ET_BACKORDER is the RFC return table and ID is the field
    const threePartRe = /^([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)$/;
    const tp = f.proj.match(threePartRe);
    if (tp && tp[1] in ts) {
      // Return just the TABLE.FIELD part (strip the leading TransformN.)
      return tp[2] + '.' + tp[3];
    }

    return expandExpr(f.proj, ts, depth + 1);
  });
}

function processField(proj, ts, schemaMap) {
  if (!proj) return { srcDS:'', srcTable:'', srcField:'', ops:'' };

  // Fully expand all transform refs into real-table expressions
  const expanded = expandExpr(proj, ts);

  // Collect all real-table refs from expanded expression
  const refs = [];
  const re = new RegExp(_REF.source, 'g');
  let m;
  while ((m = re.exec(expanded)) !== null) {
    const r = refFromMatch(Array.from(m));
    if (r.schema in ts) continue;   // still a transform → skip
    refs.push({ tbl: r.schema, fld: r.field });
  }

  if (refs.length === 0) {
    // Pure function / constant (gen_uuid, sysdate, literals…)
    return { srcDS:'', srcTable:'', srcField: proj.replace(/\n/g,' ').trim(), ops:'' };
  }

  // Deduplicated source tables (order-preserving)
  const tblMap = new Map();
  refs.forEach(r => { if (!tblMap.has(r.tbl)) tblMap.set(r.tbl, schemaMap[r.tbl]?.ds || ''); });
  const multi    = tblMap.size > 1;
  const srcTable = [...tblMap.keys()].join(', ');
  const srcDS    = [...new Set([...tblMap.values()].filter(Boolean))].join(', ');
  const srcField = refs.map(r => multi ? `${r.tbl}.${r.fld}` : r.fld).join(', ');

  // ops: full expanded expression when actual functions/operations are present
  const leftover = expanded
    .replace(new RegExp(_REF.source, 'g'), '')
    .replace(/[\s(),]+/g, '')
    .trim();
  const ops = leftover.length > 0 ? expanded.replace(/\n/g,' ').trim() : '';

  return { srcDS, srcTable, srcField, ops };
}

// ── Fix #9: FlatFileFormat index (for FileLoader targets: FILE_DC, ARCHIVOS) ──
function buildFfIdx(root) {
  const m = {}; let i = 0;
  for (const c of root.children) {
    const ln = c.localName;
    if (ln === 'FlatFileFormat' || ln === 'DelimitedFileFormat' ||
        ln === 'FixedWidthFileFormat' || ln.includes('FileFormat'))
      m[i] = c.getAttribute('name') || ('FILE_' + i);
    i++;
  }
  return m;
}

// ── Fix #9: buildSchemaMap extended with FileReader support ──
function buildSchemaMapFull(dfEl, dsIdx) {
  const map = {};
  for (const el of dfEl.children) {
    if (el.localName !== 'elements') continue;
    const typ   = xmiType(el);
    const dname = el.getAttribute('displayName') || '';
    if (typ.includes('TableReader')) {
      const tname = el.getAttribute('tableName') || el.getAttribute('outputSchemaName') || dname;
      const ds    = dsFromRef(el.getAttribute('referencedDataStore') || '', dsIdx);
      map[dname]  = { table: tname, ds };
      const oname = el.getAttribute('outputSchemaName');
      if (oname && oname !== dname) map[oname] = { table: tname, ds };
    } else if (typ.includes('FileReader')) {
      // FileReader: source is a flat file; displayName/outputSchemaName is the file alias
      const tn = el.getAttribute('outputSchemaName') || dname;
      map[dname] = { table: tn, ds: 'FILE' };
      if (tn && tn !== dname) map[tn] = { table: tn, ds: 'FILE' };
    }
  }
  return map;
}

// ── Known field descriptions (fallback when XML has no description) ──────────
const FIELD_DESC_FALLBACK = {
  PRDID:        'Id de producto',
  CUSTID:       'Id de cliente',
  LOCID:        'Id de centro',
  CURRID:       'Id de divisa',
  ID:           'Id interno',
  KEYFIGUREDATE:'Fecha',
  DATE:         'Fecha',
};

/**
 * Parse one <dataflow:DataFlow> element.
 * Fix #8: now returns an ARRAY of results (one per writer element found),
 *         so that XMLs with multiple DataFlows writing to different targets
 *         each produce their own entry.
 * Fix #9: handles FileLoader (writes to flat file) in addition to TableLoader.
 */
async function parseBatchCsv(zip) {
  const bf = zip.file('batch.csv');
  if (!bf) return {};
  const csv  = await bf.async('string');
  const rows = csv.trim().split(/\r?\n/);
  const hdrs = rows[0].split(',').map(h => h.trim());
  const map  = {};
  for (let i = 1; i < rows.length; i++) {
    const cols  = rows[i].split(',').map(c => c.trim());
    const entry = {};
    hdrs.forEach((h, j) => entry[h] = cols[j] || '');
    if (entry['Xmlfilename']) map[entry['Xmlfilename']] = entry;
  }
  return map;
}

function parseDataflow(dfEl, dsIdx, ffIdx, srcDSFallback, dstDSFallback) {
  // Use extended schema map that includes FileReader sources
  const schemaMap = buildSchemaMapFull(dfEl, dsIdx);
  const ts        = parseTransforms(dfEl);

  // Find the writer: prefer TableLoader, fall back to FileLoader
  let loaderEl = null, isFile = false;
  for (const el of dfEl.children) {
    if (el.localName !== 'elements') continue;
    const t = xmiType(el);
    if (t.includes('TableLoader')) { loaderEl = el; isFile = false; break; }
    if (t.includes('FileLoader'))  { loaderEl = el; isFile = true; }  // keep scanning for TableLoader
  }
  if (!loaderEl) return null;

  let targetTable, targetDS, fileLoaderFileName = '';
  if (isFile) {
    // Fix #9: target name from FlatFileFormat index; DS from batch.csv
    const ref = loaderEl.getAttribute('referencedFileFormat') || '';
    const mx  = ref.match(/\/(\d+)/);
    targetTable = mx ? (ffIdx[+mx[1]] || ref) : ref;
    if (!targetTable) targetTable = loaderEl.getAttribute('displayName') || '';
    targetDS = dstDSFallback || 'FILE_DC';
    // Extract file_name property from FileLoader for "filename".table.field format
    for (const child of loaderEl.children) {
      if (child.localName === 'properties' && child.getAttribute('name') === 'file_name') {
        const fn = child.getAttribute('value') || '';
        if (fn) fileLoaderFileName = fn;
        break;
      }
    }
  } else {
    targetTable = loaderEl.getAttribute('tableName') || loaderEl.getAttribute('displayName') || '';
    targetDS    = dsFromRef(loaderEl.getAttribute('referencedDataStore') || '', dsIdx) || dstDSFallback || '';
  }
  if (!targetTable) return null;

  const mappings = [], filters = [], lookups = [];


  // ── LOOKUPS — paren-counting to capture full expression including nested calls
  for (const [tfName, tfData] of Object.entries(ts)) {
    for (const f of tfData.fields) {
      if (!f.proj || !/\blookup\s*\(/i.test(f.proj)) continue;
      const proj = f.proj;
      let pos = 0;
      while (pos < proj.length) {
        // find each 'lookup(' using indexOf from current pos
        const lo = proj.toLowerCase().indexOf('lookup(', pos);
        if (lo === -1) break;
        // Walk forward counting parens to find matching close
        let depth = 0, i = lo + 'lookup('.length - 1;
        for (; i < proj.length; i++) {
          if (proj[i] === '(') depth++;
          else if (proj[i] === ')') { depth--; if (depth === 0) break; }
        }
        const fullExpr = proj.slice(lo, i + 1);
        lookups.push({ func: fullExpr, transform: tfName });
        pos = i + 1;
      }
    }
  }

  // ── MAPPINGS ──────────────────────────────────────────────
  const finalTF = ts['Target_Query'] || Object.values(ts).at(-1) || null;
  if (finalTF) {
    for (const f of finalTF.fields) {
      if (!f.proj) continue;
      const { srcDS, srcTable, srcField, ops } = processField(f.proj, ts, schemaMap);
      mappings.push({ srcDS: srcDS || srcDSFallback || '', srcTable, srcField,
                      dstDS: targetDS, dstTable: targetTable,
                      dstField: f.name, dstDesc: f.desc || FIELD_DESC_FALLBACK[f.name] || FIELD_DESC_FALLBACK[(f.name||"").toUpperCase()] || "", ops });
    }
  }

  // ── FILTERS ──────────────────────────────────────────────
  // Each transform's filterExpression is treated as ONE filter row.
  // The full multi-line expression is preserved as-is in the cell.
  // We extract the first real-table reference for the Tabla/Campo columns.
  const seenF = new Set();

  function pushFilterExpr(rawExpr) {
    if (!rawExpr) return;
    const feExp = expandExpr(rawExpr.replace(/&#xA;/g, '\n'), ts);
    const re2 = new RegExp(_REF.source, 'g');
    const seenTbls = new Set();
    let m2;
    while ((m2 = re2.exec(feExp)) !== null) {
      const r = refFromMatch(Array.from(m2));
      if (r.schema in ts) continue;
      seenTbls.add(schemaMap[r.schema]?.table || r.schema);
    }
    const key = feExp.substring(0, 120);
    if (seenF.has(key)) return;
    seenF.add(key);
    filters.push({ sourceTable: [...seenTbls].join(', '), sourceField: '', expression: feExp, description: '' });
  }

  // Filters from transform outputSchema filterExpression
  for (const info of Object.values(ts)) {
    pushFilterExpr(info.filterExpr);
  }

  // Filters from <joins> inside QueryTransform > outputSchema
  for (const el of dfEl.children) {
    if (el.localName !== 'elements') continue;
    const typ = xmiType(el);
    if (!typ.includes('QueryTransform')) continue;
    for (const child of el.children) {
      if (child.localName !== 'outputSchema') continue;
      for (const jn of child.children) {
        if (jn.localName !== 'joins') continue;
        const expr = jn.getAttribute('expression') || '';
        pushFilterExpr(expr);
      }
    }
  }

  // DataFlow name and GUID (used for exact ATL matching)
  const dataflowName = dfEl.getAttribute('name') || dfEl.getAttribute('displayName') || '';
  const dataflowGuid = dfEl.getAttribute('guid') || '';

  return { mappings, filters, lookups, targetTable, targetDS, dataflowName, dataflowGuid, fileLoaderFileName };
}

/**
 * Parse one integration XML + batch entry.
 * Fix #8 (complete): returns an ARRAY — one entry per DataFlow that has a writer
 * (TableLoader or FileLoader). XMLs with N distinct target tables produce N entries,
 * each becoming its own Excel sheet instead of being silently merged into one.
 * Fix #9: passes ffIdx so FileLoader targets are resolved from FlatFileFormat index.
 */
function parseIntegration(xmlStr, batchEntry) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];
  const root = doc.documentElement;

  const dsIdx = buildDsIndexMap(root);
  const ffIdx = buildFfIdx(root);

  // Job metadata
  let jobName = '', jobDesc = '';
  for (const c of root.children) {
    if (c.localName === 'Job') {
      jobName = c.getAttribute('name') || '';
      jobDesc = getProp(c, 'Description') || c.getAttribute('description') || '';
      break;
    }
  }
  if (!jobName) return [];

  const srcDSName = batchEntry?.src_datastore_Name || '';
  const dstDSName = batchEntry?.target_datastorename || '';

  // Tipo de integración from job name
  function getTipo(name, isFile) {
    if (isFile) return 'FILE';
    const u = (name || '').toUpperCase();
    if (/_KF_/.test(u)) return 'KF';
    if (/_MD_|_DM_/.test(u)) return 'MD';
    if (/_FILE_/.test(u)) return 'FILE';
    return 'MD';
  }

  // Global variables from <globalVariables> inside the <Job> element
  const variables = [];
  for (const c of root.children) {
    if (c.localName === 'Job') {
      for (const gv of c.children) {
        if (gv.localName === 'globalVariables') {
          const name = gv.getAttribute('name') || '';
          const val  = gv.getAttribute('defaultValue') || '';
          if (name) variables.push({ name, value: val });
        }
      }
      break;
    }
  }

  const results = [];
  for (const c of root.children) {
    if (c.localName !== 'DataFlow') continue;
    const r = parseDataflow(c, dsIdx, ffIdx, srcDSName, dstDSName);
    if (!r || !r.targetTable) continue;

    const dstDSFinal = dstDSName || r.targetDS || '';
    for (const m of r.mappings) {
      if (!m.srcDS && srcDSName)   m.srcDS = srcDSName;
      if (!m.dstDS && dstDSFinal)  m.dstDS = dstDSFinal;
    }

    const isFile = (dstDSFinal || '').toLowerCase().includes('file') ||
                   (dstDSFinal || '').toUpperCase() === 'FILE_DC' ||
                   (dstDSFinal || '').toUpperCase() === 'ARCHIVOS';

    results.push({
      jobName, jobDesc,
      tipoIntegracion: getTipo(jobName, isFile),
      dataflowName:    r.dataflowName,
      dataflowGuid:    r.dataflowGuid || '',
      fileLoaderFileName: r.fileLoaderFileName || '',
      srcDSName,
      dstDSName:   dstDSFinal,
      targetTable: r.targetTable,
      mappings:    r.mappings,
      filters:     r.filters,
      lookups:     r.lookups,
      variables,
    });
  }
  return results;
}

// ════════════════════════════════════════════════════════════
//  XLSX GENERATOR — Fiel al template plantilla_documentador.xlsx
//  Colores y fuentes exactas de la plantilla entregada.
// ════════════════════════════════════════════════════════════

// ── Colores tomados directamente de la plantilla ─────────────
// Parámetros header:  theme:5  → Office Blue Medium = 4472C4  (rgb FF4472C4)
// Parámetros data A-C: theme:8 → Blue lighter      = 9DC3E6  (rgb FF9DC3E6)
// Parámetros data D-G: theme:9 → Blue lightest      = DDEBF7  (rgb FFDDEBF7)
// Integ header (T1):  FF00B0F0  cyan/blue
// Integ data (T1):    theme:9 = DDEBF7
// Tabla2,3,4 header:  theme:6 → Orange             = ED7D31  (rgb FFED7D31)
// Tabla2,3,4 data:    no fill (white)
// Tabla3,4 data font: bold FF002060 navy
// Back button A1:     theme:4 → Blue dark           = 4472C4 dark = 2E74B5 → 255E94
// Col A width: 4.6

// Style index constants (0-based xf index in styles.xml)
const XF = {
  DEFAULT:       0,
  // Parámetros sheet
  PRM_HDR:       1,  // Header: white bold Calibri 11 on theme:5 (4472C4), thin border, vcenter
  PRM_ABC:       2,  // Data cols A-B-C: Calibri 11 on theme:8 (9DC3E6), center, wrap, thin border
  PRM_DEF:       3,  // Data cols D-E-F-G: Calibri 11 on theme:9 (DDEBF7), left, wrap, thin border
  PRM_LINK:      4,  // Col A: numeric id, hyperlink style (blue underline) on theme:8
  // Integration back button A1
  BACK_BTN:      5,  // "<--" bold Calibri 11 on theme:4 (255E94), center, thin border
  // Table 1 header (cyan FF00B0F0), white bold Arial 10, center, wrap, thin
  T1_HDR:        6,
  // Table 1 data (theme:9 DDEBF7), Arial 10, thin border
  T1_NUM:        7,  // # col: center
  T1_CAMPO:      8,  // Campo Destino: left bold
  T1_DATA:       9,  // other cols: left
  // Tables 2/3/4 header (theme:6 ED7D31), Arial 10 bold, thin
  T234_HDR:     10,
  // Tables 2/3/4 data: no fill, Calibri 11, left, thin B/C only
  T2_DATA:      11,  // normal
  // Tables 3/4 data: no fill, Calibri 11 BOLD color FF002060
  T34_DATA:     12,
};

// ── styles.xml — colores exactos extraídos de plantilla_documentador.xlsx ────
// Fills decodificados del tema Office 2013-2022:
//   fill[2] = 00B0F0  cyan explícito (T1 header)
//   fill[3] = A9CE91  verde claro  theme:9 tint+0.4 (T1 data)
//   fill[4] = EDEDED  gris claro   theme:6 tint+0.8 (PRM D-G, T234 header)
//   fill[5] = ED7D31  naranja      theme:5 sin tint  (PRM header)
//   fill[6] = FBE5D6  naranja pálido theme:5 tint+0.8 (no usado)
//   fill[7] = DEEBF7  azul claro   theme:8 tint+0.8 (PRM data A-C)
//   fill[8] = E2EFDA  verde pálido theme:9 tint+0.8 (no usado)
//   fill[9] = 223962  navy oscuro  theme:4 tint-0.5 (back button)
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="0"/>
<fonts count="8">
  <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  <font><sz val="10"/><name val="Arial"/><family val="2"/></font>
  <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="11"/><color rgb="FF002060"/><name val="Calibri"/><family val="2"/></font>
  <font><sz val="11"/><color rgb="FF0563C1"/><u val="single"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
</fonts>
<fills count="10">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF00B0F0"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFA9CE91"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFED7D31"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFBE5D6"/><bgColor indexed="65"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFDEEBF7"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF223962"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border>
    <left style="thin"><color indexed="64"/></left>
    <right style="thin"><color indexed="64"/></right>
    <top style="thin"><color indexed="64"/></top>
    <bottom style="thin"><color indexed="64"/></bottom>
    <diagonal/>
  </border>
  <border>
    <left style="thin"><color indexed="64"/></left>
    <right style="thin"><color indexed="64"/></right>
    <top/>
    <bottom style="thin"><color indexed="64"/></bottom>
    <diagonal/>
  </border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
  <!-- 0 DEFAULT -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <!-- 1 PRM_HDR: Calibri11 blanco bold, naranja ED7D31, thin, vcenter -->
  <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <!-- 2 PRM_ABC: Calibri11 normal, azul claro DEEBF7, thin, center+wrap -->
  <xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <!-- 3 PRM_DEF: Calibri11 normal, gris claro EDEDED, thin, left+wrap -->
  <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 4 PRM_LINK: Calibri11 azul subrayado, azul claro DEEBF7, thin, center -->
  <xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <!-- 5 BACK_BTN: Calibri11 bold, navy 223962, thin, center -->
  <xf numFmtId="0" fontId="4" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <!-- 6 T1_HDR: Arial10 bold blanco, cyan 00B0F0, thin, center+wrap -->
  <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <!-- 7 T1_NUM: Arial10 normal, verde claro A9CE91, thin, center+wrap -->
  <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <!-- 8 T1_CAMPO: Arial10 bold, verde claro A9CE91, thin, left+wrap -->
  <xf numFmtId="0" fontId="7" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 9 T1_DATA: Arial10 normal, verde claro A9CE91, thin, left+wrap -->
  <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 10 T234_HDR: Arial10 bold, gris claro EDEDED, thin, left -->
  <xf numFmtId="0" fontId="7" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  <!-- 11 T2_DATA: Calibri11 normal, sin fondo, thin, left -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  <!-- 12 T34_DATA: Calibri11 bold 002060, sin fondo, thin, left -->
  <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`.replace(/\n\s*/g, '');

// ── XML helpers ──────────────────────────────────────────────
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellRef(r, c) {
  let col = '';
  let n = c + 1;
  while (n > 0) { col = String.fromCharCode(65 + (n - 1) % 26) + col; n = Math.floor((n - 1) / 26); }
  return col + (r + 1);
}

// ── Sheet builder ────────────────────────────────────────────
class SheetBuilder {
  constructor() {
    this.rows = [];
    this.merges = [];
    this.hyperlinks = [];
    this.colWidths = [];
    this.rowHeights = [];
  }

  addRow(cells, height = 18) {
    this.rows.push(cells);
    this.rowHeights.push(height);
  }

  merge(r1, c1, r2, c2) { this.merges.push({ r1, c1, r2, c2 }); }

  addHyperlink(r, c, target) {
    this.hyperlinks.push({ ref: cellRef(r, c), target });
  }

  setColWidths(widths) { this.colWidths = widths; }

  toXML() {
    const cols = this.colWidths.map((w, i) =>
      `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');

    let sheetData = '';
    this.rows.forEach((cells, ri) => {
      const ht = this.rowHeights[ri];
      let rowXml = `<row r="${ri+1}" ht="${ht}" customHeight="1">`;
      cells.forEach((cell, ci) => {
        if (!cell) return;
        const ref = cellRef(ri, ci);
        const v   = cell.v ?? '';
        const s   = cell.s ?? 0;
        if (v === '' || v === null || v === undefined) {
          rowXml += `<c r="${ref}" s="${s}"/>`;
        } else {
          rowXml += `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${esc(String(v))}</t></is></c>`;
        }
      });
      rowXml += '</row>';
      sheetData += rowXml;
    });

    const mergeXml = this.merges.length
      ? '<mergeCells>' + this.merges.map(m =>
          `<mergeCell ref="${cellRef(m.r1,m.c1)}:${cellRef(m.r2,m.c2)}"/>`).join('') + '</mergeCells>'
      : '';

    let hyperlinkXml = '';
    let relsXml = null;
    if (this.hyperlinks.length > 0) {
      const NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
      hyperlinkXml = '<hyperlinks>' +
        this.hyperlinks.map((hl, i) =>
          `<hyperlink ${NS} ref="${hl.ref}" r:id="rId${i+1}"/>`
        ).join('') + '</hyperlinks>';
      const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
      const relEntries = this.hyperlinks.map((hl, i) =>
        `<Relationship Type="${REL_TYPE}" Target="${esc(hl.target)}" TargetMode="External" Id="rId${i+1}"/>`
      ).join('');
      relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
              + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
              + relEntries + `</Relationships>`;
    }

    const maxRow = this.rows.length;
    const maxCol = Math.max(...this.rows.map(r => r.length)) - 1;
    const dimRef = `A1:${cellRef(maxRow - 1, maxCol)}`;

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<dimension ref="${dimRef}"/>`
      + `<sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>`
      + `<sheetFormatPr baseColWidth="8" defaultRowHeight="15"/>`
      + `<cols>${cols}</cols>`
      + `<sheetData>${sheetData}</sheetData>`
      + mergeXml
      + hyperlinkXml
      + `</worksheet>`;

    return { xml, relsXml };
  }
}

// ── Parámetros sheet ─────────────────────────────────────────
// Columnas (A–G): Dato | Tipo | Task CI-DS | Desc Task | Dataflow CIDS | Sis.Fuente | Sis.Destino
// Col A: hyperlink al detalle; A-C en theme:8 (9DC3E6); D-G en theme:9 (DDEBF7)
// Header: theme:5 (4472C4) bold Calibri 11 blanco
// Col widths según template: A=33.4, B≈20, C=64.6, D=35.9, E=71.1, F=71.1, G=79.2
function buildParamSheet(rows, jobsMode) {
  const sb = new SheetBuilder();

  // Header row (row 1)
  const headers = [
    {v:'Dato - Click Aquí para más detalle', s:XF.PRM_HDR},
    {v:'Tipo de Integración',               s:XF.PRM_HDR},
  ];
  if (jobsMode) {
    headers.push({v:'Job IBP',      s:XF.PRM_HDR});
    headers.push({v:'Step',         s:XF.PRM_HDR});
    headers.push({v:'Tipo de paso', s:XF.PRM_HDR});
    headers.push({v:'Grupo',        s:XF.PRM_HDR});
  }
  headers.push(
    {v:'Task CI-DS',             s:XF.PRM_HDR},
    {v:'Descripción de la task', s:XF.PRM_HDR},
    {v:'Dataflow CIDS',          s:XF.PRM_HDR},
    {v:'Sistema fuente',         s:XF.PRM_HDR},
    {v:'Sistema Destino',        s:XF.PRM_HDR}
  );
  sb.addRow(headers, 18);

  rows.forEach((p, i) => {
    const isNonDI = p.isNonDI;
    const dataRowIdx = sb.rows.length;
    const row = [
      {v: i + 1,              s: isNonDI ? XF.PRM_ABC : XF.PRM_LINK},
      {v: p.tipoIntegracion || '', s: XF.PRM_ABC},
    ];
    if (jobsMode) {
      row.push({v: p.ibpJobName  || '', s: XF.PRM_DEF});
      row.push({v: p.ibpStepName || '', s: XF.PRM_DEF});
      row.push({v: p.ibpStepType || '', s: XF.PRM_DEF});
      row.push({v: p.atlGroup    || '', s: XF.PRM_DEF});
    }
    row.push(
      {v: p.jobName || '',      s: XF.PRM_ABC},
      {v: p.jobDesc || '',      s: XF.PRM_DEF},
      {v: p.dataflowName || '', s: XF.PRM_DEF},
      {v: p.srcDS || '',        s: XF.PRM_DEF},
      {v: p.dstDS || '',        s: XF.PRM_DEF}
    );
    sb.addRow(row, 20);
    // Hyperlink en col A (índice 0) → hoja de detalle (only for DI rows)
    if (!isNonDI) sb.addHyperlink(dataRowIdx, 0, `#'${p.sheetName}'!A1`);
  });

  const widths = jobsMode
    ? [33.4, 20, 40, 35, 40, 25, 64.6, 35.9, 71.1, 71.1, 79.2]
    : [33.4, 20, 64.6, 35.9, 71.1, 71.1, 79.2];
  sb.setColWidths(widths);
  return sb;
}

// ── Integration sheet ────────────────────────────────────────
// Layout fiel al template PLantilla integracion:
//   A1: botón "<--" (theme:4, bold, center, thin border)
//   B1-G1: headers tabla 1 (cyan 00B0F0, white bold Arial10)
//   B2-G+: data tabla 1 (theme:9 DDEBF7)
//   Fila separadora vacía
//   B?:D?: header tabla 2 (orange ED7D31)
//   B?:C?: data tabla 2 (no fill, Calibri 11)
//   Fila separadora
//   B?:C?: header tabla 3 (orange)
//   B?:C?: data tabla 3 (no fill, bold 002060)
//   Fila separadora
//   B?:C?: header tabla 4 (orange)
//   B?:C?: data tabla 4 (no fill, bold 002060)
//
// Col widths: A=4.6, B=22.4, C=29.1, D=62.3, E=41.7, F=41.7, G=40.4
function buildIntegrationSheet(parsed) {
  const sb = new SheetBuilder();
  const { jobName, jobDesc, srcDSName, dstDSName, mappings, filters, lookups, variables } = parsed;
  const N = 7; // cols A-G

  // Helper: fila vacía
  const emptyRow = () => sb.addRow(Array(N).fill({v:'', s:XF.DEFAULT}), 6);

  // ── Fila 1: Back button en A1 (con hyperlink → Parámetros) + headers tabla 1
  sb.addHyperlink(0, 0, "#'Parámetros'!A1");
  sb.addRow([
    {v:'<--',                    s:XF.BACK_BTN},
    {v:' #',                     s:XF.T1_HDR},
    {v:'Campo Destino',          s:XF.T1_HDR},
    {v:'Descripción Campo Destino', s:XF.T1_HDR},
    {v:'Tabla Origen',           s:XF.T1_HDR},
    {v:'Campo Origen',           s:XF.T1_HDR},
    {v:'Mapping',                s:XF.T1_HDR},
  ], 22);

  // ── Datos tabla 1
  if (!mappings.length) {
    sb.addRow([
      {v:'', s:XF.DEFAULT},
      {v:'Sin mapeos', s:XF.T1_DATA},
      {v:'', s:XF.T1_DATA},{v:'', s:XF.T1_DATA},
      {v:'', s:XF.T1_DATA},{v:'', s:XF.T1_DATA},{v:'', s:XF.T1_DATA}
    ], 18);
  } else {
    mappings.forEach((m, i) => {
      // Campo Destino: "archivo.csv".TABLA.CAMPO for file targets, else TABLA.CAMPO
      const filePrefix = parsed.fileLoaderFileName
        ? `"${parsed.fileLoaderFileName}".` : '';
      const campoDestino = filePrefix + [m.dstTable, m.dstField].filter(Boolean).join('.');
      sb.addRow([
        {v:'', s:XF.DEFAULT},
        {v: i + 1,              s:XF.T1_NUM},
        {v: campoDestino,       s:XF.T1_CAMPO},
        {v: m.dstDesc || '',    s:XF.T1_DATA},
        {v: m.srcTable || '',   s:XF.T1_DATA},
        {v: m.srcField || '',   s:XF.T1_DATA},
        {v: m.ops || '',        s:XF.T1_DATA},
      ], 18);
    });
  }

  emptyRow();

  // ── Tabla 2 — Filtros
  sb.addRow([
    {v:'', s:XF.DEFAULT},
    {v:'Tabla',              s:XF.T234_HDR},
    {v:'Filtro',             s:XF.T234_HDR},
    {v:'Descripción de filtro', s:XF.T234_HDR},
    {v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT}
  ], 18);

  if (!filters.length) {
    sb.addRow([
      {v:'', s:XF.DEFAULT},
      {v:'Sin filtros', s:XF.T2_DATA},
      {v:'', s:XF.T2_DATA},{v:'', s:XF.T2_DATA},
      {v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT}
    ], 18);
  } else {
    filters.forEach(f => {
      const tabla = [f.sourceTable, f.sourceField].filter(Boolean).join('.');
      sb.addRow([
        {v:'', s:XF.DEFAULT},
        {v: tabla,              s:XF.T2_DATA},
        {v: f.expression || '', s:XF.T2_DATA},
        {v: f.description || '',s:XF.T2_DATA},
        {v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT}
      ], 18);
    });
  }

  emptyRow();

  // ── Tabla 3 — Variables (Parámetros Globales)
  sb.addRow([
    {v:'', s:XF.DEFAULT},
    {v:'Parámetro Global', s:XF.T234_HDR},
    {v:'Valor',            s:XF.T234_HDR},
    {v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT}
  ], 18);

  if (!variables || !variables.length) {
    sb.addRow([
      {v:'', s:XF.DEFAULT},
      {v:'Sin variables', s:XF.T34_DATA},
      {v:'', s:XF.T34_DATA},
      {v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT}
    ], 18);
  } else {
    variables.forEach(v => {
      sb.addRow([
        {v:'', s:XF.DEFAULT},
        {v: v.name  || '', s:XF.T34_DATA},
        {v: v.value || '', s:XF.T34_DATA},
        {v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT}
      ], 18);
    });
  }

  emptyRow();

  // ── Tabla 4 — Lookups
  sb.addRow([
    {v:'', s:XF.DEFAULT},
    {v:'Función Lookup', s:XF.T234_HDR},
    {v:'Transform',      s:XF.T234_HDR},
    {v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT}
  ], 18);

  if (!lookups.length) {
    sb.addRow([
      {v:'', s:XF.DEFAULT},
      {v:'Sin lookups', s:XF.T34_DATA},
      {v:'', s:XF.T34_DATA},
      {v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT}
    ], 18);
  } else {
    lookups.forEach(l => {
      sb.addRow([
        {v:'', s:XF.DEFAULT},
        {v: l.func || '',      s:XF.T34_DATA},
        {v: l.transform || l.file || '', s:XF.T34_DATA},
        {v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT},{v:'', s:XF.DEFAULT}
      ], 18);
    });
  }

  // Col widths: A=4.6, B=22.4, C=29.1, D=62.3, E=41.7, F=41.7, G=40.4
  sb.setColWidths([4.6, 22.4, 29.1, 62.3, 41.7, 41.7, 40.4]);
  return sb;
}

// ── Assemble workbook .xlsx ──────────────────────────────────
async function assembleXlsx(sheets) {
  // sheets = [{name, sb}]
  const zip = new JSZip();

  // Static files
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" Id="rId1"/>
</Relationships>`);

  zip.file('xl/styles.xml', STYLES_XML);

  // workbook.xml
  const sheetEls = sheets.map((s, i) =>
    `<sheet name="${esc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`
  ).join('');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${sheetEls}</sheets>
</workbook>`);

  // workbook rels
  const wbRels = sheets.map((_, i) =>
    `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml" Id="rId${i+1}"/>`
  ).join('');
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${wbRels}
  <Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" Id="rIdS"/>
</Relationships>`);

  // Sheets — toXML() now returns { xml, relsXml }
  sheets.forEach((s, i) => {
    const { xml, relsXml } = s.sb.toXML();
    zip.file(`xl/worksheets/sheet${i+1}.xml`, xml);
    if (relsXml) {
      zip.file(`xl/worksheets/_rels/sheet${i+1}.xml.rels`, relsXml);
    }
  });

  // Content Types
  const sheetOverrides = sheets.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetOverrides}
</Types>`);

  return await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}


// ════════════════════════════════════════════════════════════
//  MAIN GENERATE
// ════════════════════════════════════════════════════════════
// ── Phase 1: scan ZIPs, parse XMLs, show selection panel ─────
async function generate() {
  docsLogEl.innerHTML = '';
  docsLogEl.style.display = 'block';
  docsLogHint.style.display = 'none';
  document.getElementById('stats-card').style.display = 'none';
  document.getElementById('sel-card').style.display = 'none';
  document.getElementById('gen-btn').disabled = true;
  xlsBuf = null;
  parsedIntegrations = [];

  docsLog('Escaneando ZIPs…', 'l-info');
  setP(2);

  // Unique sheet-name generator (scoped to scan, reset on each scan)
  const usedNames = new Set();
  function uniq(base) {
    let clean = base.replace(/[:\\\/\?\*\[\]]/g, '_').substring(0, 28);
    let n = clean, k = 0;
    while (usedNames.has(n)) n = clean.substring(0,25) + '_' + (++k);
    usedNames.add(n); return n;
  }

  let done = 0;
  for (const zf of files) {
    docsLog(`📦 ${zf.name}`, 'l-info');
    let zip;
    try { zip = await JSZip.loadAsync(zf.data); }
    catch(e) { docsLog(`  ✗ ${e.message}`, 'l-err'); continue; }

    const batchMap = await parseBatchCsv(zip);
    docsLog(`  ✔ batch.csv: ${Object.keys(batchMap).length} entradas`, 'l-ok');

    const xmlNames = Object.keys(zip.files).filter(n => n.endsWith('.xml') && !n.includes('/'));
    docsLog(`  📄 ${xmlNames.length} XMLs`, 'l-line');

    for (let xi = 0; xi < xmlNames.length; xi++) {
      const fname = xmlNames[xi];
      setP(2 + Math.round(94 * (done + (xi+1)/xmlNames.length) / files.length));

      let xmlStr;
      try { xmlStr = await zip.file(fname).async('string'); }
      catch(e) { docsLog(`  ✗ ${fname}: ${e.message}`, 'l-err'); continue; }

      let dfResults;
      try { dfResults = parseIntegration(xmlStr, batchMap[fname] || {}); }
      catch(e) { docsLog(`  ✗ Parse ${fname}: ${e.message}`, 'l-err'); continue; }
      if (!dfResults || !dfResults.length) { docsLog(`  ⚠ Sin DataFlows: ${fname}`, 'l-warn'); continue; }

      const multiDF = dfResults.length > 1;
      for (const parsed of dfResults) {
        const { jobName, jobDesc, srcDSName, dstDSName, targetTable, mappings, filters, lookups } = parsed;
        const baseName = jobName || fname.replace('.xml','');
        const sheetName = multiDF ? uniq(baseName + '_' + targetTable) : uniq(baseName);
        const paramRow = {
          jobName, jobDesc,
          tipoIntegracion: parsed.tipoIntegracion,
          dataflowName: parsed.dataflowName,
          srcDS: srcDSName, dstDS: dstDSName,
          targetTable, sheetName
        };
        parsedIntegrations.push({ sheetName, pkg: zf.name, parsed, paramRow });
        docsLog(`  ✔ ${sheetName}  (${mappings.length} mapeos · ${filters.length} filtros · ${lookups.length} lookups)`, 'l-ok');
      }
    }
    done++;
  }

  setP(100);
  docsLog(`✅ Escaneado — ${parsedIntegrations.length} integraciones encontradas`, 'l-ok');
  document.getElementById('gen-btn').disabled = false;
  renderSelList();
}

// ── Render the selection list ─────────────────────────────────
function renderSelList() {
  const list = document.getElementById('sel-list');
  list.innerHTML = parsedIntegrations.map((item, i) => {
    const t = (item.paramRow.tipoIntegracion || '').toUpperCase();
    const badgeClass = t === 'KF' ? 'badge-kf' : t === 'MD' ? 'badge-md' : 'badge-file';
    const jobName = item.paramRow.jobName || item.sheetName;
    const df = item.paramRow.dataflowName
      ? `<span class="si-df">${escH(item.paramRow.dataflowName)}</span>` : '';
    return `<label class="sel-item" data-idx="${i}">
      <input type="checkbox" checked onchange="updateCounter()">
      <span class="si-badge ${badgeClass}">${t || '?'}</span>
      <span class="si-name">${escH(jobName)}${df}</span>
      <span class="badge-pkg" title="${escH(item.pkg)}">${escH(item.pkg)}</span>
    </label>`;
  }).join('');
  document.getElementById('sel-search').value = '';
  updateCounter();
  document.getElementById('sel-card').style.display = 'block';
  document.getElementById('sel-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Filter list by search text ────────────────────────────────
function filterSelList() {
  const q = document.getElementById('sel-search').value.toLowerCase();
  document.querySelectorAll('#sel-list .sel-item').forEach(item => {
    const idx = +item.dataset.idx;
    const it  = parsedIntegrations[idx];
    const text = [
      it.sheetName,
      it.paramRow.tipoIntegracion,
      it.paramRow.dataflowName,
      it.paramRow.jobName,
      it.paramRow.srcDS,
      it.paramRow.dstDS,
      it.pkg,
    ].join(' ').toLowerCase();
    item.classList.toggle('hidden', q !== '' && !text.includes(q));
  });
  updateCounter();
}

// ── Toggle all currently-visible items ───────────────────────
function toggleFiltered(state) {
  document.querySelectorAll('#sel-list .sel-item:not(.hidden) input[type=checkbox]')
    .forEach(cb => cb.checked = state);
  updateCounter();
}

// ── Update "N / T selected" counter ──────────────────────────
function updateCounter() {
  const all     = document.querySelectorAll('#sel-list .sel-item');
  const visible = document.querySelectorAll('#sel-list .sel-item:not(.hidden)');
  const checked = document.querySelectorAll('#sel-list .sel-item input:checked');
  const q = document.getElementById('sel-search').value.trim();
  const counterEl = document.getElementById('sel-counter');
  if (q) {
    const visChecked = [...visible].filter(el => el.querySelector('input').checked).length;
    counterEl.textContent = `${visChecked} / ${visible.length} filtradas · ${checked.length} / ${all.length} total`;
  } else {
    counterEl.textContent = `${checked.length} / ${all.length} seleccionadas`;
  }
}

// ── Phase 2: build Excel with selected integrations only ──────
async function buildExcel() {
  docsLogEl.innerHTML = '';
  docsLogEl.style.display = 'block';
  document.getElementById('stats-card').style.display = 'none';
  xlsBuf = null;

  // Gather selected indices
  const selected = [];
  document.querySelectorAll('#sel-list .sel-item').forEach(item => {
    if (item.querySelector('input').checked)
      selected.push(parsedIntegrations[+item.dataset.idx]);
  });

  if (!selected.length) {
    docsLog('⚠ No hay integraciones seleccionadas.', 'l-warn');
    return;
  }

  docsLog(`📋 Generando Excel con ${selected.length} integraciones…`, 'l-info');
  setP(5);

  // ── Fetch IBP field descriptions (MASTER_DATA_API_SRV + PLANNING_DATA_API_SRV)
  docsLog('🔍 Obteniendo descripciones de campos desde IBP…', 'l-info');
  let ibpDescs = {};
  try {
    ibpDescs = await fetchIbpFieldDescriptions();
    const n = Object.keys(ibpDescs).length;
    docsLog(
      n > 0
        ? `✔ ${n} descripciones de campos obtenidas de IBP`
        : '⚠ Sin conexión a IBP — se usarán descripciones del XML',
      n > 0 ? 'l-ok' : 'l-warn'
    );
  } catch (e) {
    docsLog('⚠ No se pudo consultar IBP: ' + e.message, 'l-warn');
  }
  setP(15);

  const sheets   = [];
  const paramRows = [];
  let totalJobs = 0, totalMaps = 0, totalFilts = 0;

  for (const item of selected) {
    const { parsed, paramRow } = item;
    // Enrich dstDesc with IBP labels when the XML carried no description
    parsed.mappings.forEach(m => {
      if (!m.dstDesc && ibpDescs[m.dstField]) m.dstDesc = ibpDescs[m.dstField];
    });
    totalJobs++;
    totalMaps  += parsed.mappings.length;
    totalFilts += parsed.filters.length;
    paramRows.push(paramRow);
    const sb = buildIntegrationSheet(parsed);
    sheets.push({ name: paramRow.sheetName, sb });
  }

  docsLog('📋 Generando hoja Parámetros…', 'l-info');
  const paramSb = buildParamSheet(paramRows);
  sheets.unshift({ name: 'Parámetros', sb: paramSb });

  docsLog('📦 Ensamblando archivo Excel…', 'l-info');
  xlsBuf = await assembleXlsx(sheets);
  setP(100);
  docsLog(`✅ Listo — ${totalJobs} jobs · ${totalMaps} mapeos · ${totalFilts} filtros`, 'l-ok');

  document.getElementById('s-jobs').textContent = totalJobs;
  document.getElementById('s-maps').textContent = totalMaps;
  document.getElementById('s-filt').textContent = totalFilts;
  document.getElementById('stats-card').style.display = 'block';
}

// ════════════════════════════════════════════════════════════
//  JOBS MODE — ATL PARSER + JOB FLOW
// ════════════════════════════════════════════════════════════

// ── Mode switcher ────────────────────────────────────────────
function switchDocsMode(mode) {
  docsMode = mode;
  document.getElementById('docs-zip-panels').style.display = mode === 'zip' ? '' : 'none';
  document.getElementById('docs-jobs-panels').style.display = mode === 'jobs' ? '' : 'none';
  document.getElementById('mode-zip').classList.toggle('active', mode === 'zip');
  document.getElementById('mode-jobs').classList.toggle('active', mode === 'jobs');
  // Hide shared panels when switching
  document.getElementById('sel-card').style.display = 'none';
  document.getElementById('stats-card').style.display = 'none';
}

// ── ATL file handling ────────────────────────────────────────
function initAtlDropZone() {
  const dz = document.getElementById('atl-dz');
  if (!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addAtlFiles([...e.dataTransfer.files]); });
  document.getElementById('atl-fi').addEventListener('change', e => addAtlFiles([...e.target.files]));
}

function addAtlFiles(list) {
  list.filter(f => f.name.endsWith('.atl') || f.name.endsWith('.txt')).forEach(f => {
    if (atlFiles.find(x => x.name === f.name)) return;
    const r = new FileReader();
    r.onload = ev => { atlFiles.push({ name: f.name, text: ev.target.result }); renderAtlFiles(); };
    r.readAsText(f);
  });
}

function removeAtlFile(i) { atlFiles.splice(i, 1); renderAtlFiles(); }

function renderAtlFiles() {
  document.getElementById('atl-file-list').innerHTML = atlFiles.map((f, i) => `
    <div class="file-tag">
      <span class="ico">📄</span>
      <span class="name">${escH(f.name)}</span>
      <span class="size">${(f.text.length/1024).toFixed(0)} KB</span>
      <button class="rm" onclick="removeAtlFile(${i})">✕</button>
    </div>`).join('');
  updateJobsGenBtn();
}

// ── Jobs-mode ZIP handling ───────────────────────────────────
function initJobsZipDropZone() {
  const dz = document.getElementById('jobs-zip-dz');
  if (!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addJobsZipFiles([...e.dataTransfer.files]); });
  document.getElementById('jobs-zip-fi').addEventListener('change', e => addJobsZipFiles([...e.target.files]));
}

function addJobsZipFiles(list) {
  list.filter(f => f.name.endsWith('.zip')).forEach(f => {
    if (jobsFiles.find(x => x.name === f.name)) return;
    const r = new FileReader();
    r.onload = ev => { jobsFiles.push({ name: f.name, data: ev.target.result }); renderJobsZipFiles(); };
    r.readAsArrayBuffer(f);
  });
}

function removeJobsZipFile(i) { jobsFiles.splice(i, 1); renderJobsZipFiles(); }

function renderJobsZipFiles() {
  document.getElementById('jobs-zip-file-list').innerHTML = jobsFiles.map((f, i) => `
    <div class="file-tag">
      <span class="ico">📦</span>
      <span class="name">${escH(f.name)}</span>
      <span class="size">${(f.data.byteLength/1024).toFixed(0)} KB</span>
      <button class="rm" onclick="removeJobsZipFile(${i})">✕</button>
    </div>`).join('');
  updateJobsGenBtn();
}

function updateJobsGenBtn() {
  const btn = document.getElementById('jobs-gen-btn');
  if (btn) btn.disabled = atlFiles.length === 0 && jobsFiles.length === 0;
}

// ── ATL Parser ───────────────────────────────────────────────
// Parses a SAP Data Services ATL export into a structured process.
// Returns: { sessionName, description, variables: [{name,type,default}],
//            groups: [{name, displayName, parallel, dataflows: [{fullName, displayName}]}],
//            globalDefaults: {$VAR: 'value'} }
function parseATL(text) {
  const lines = text.split(/\r?\n/);
  const plans = {};       // planFullName → { displayName, parallel, dataflows }
  let sessionName = '';
  let sessionDisplayName = '';
  let description = '';
  const variables = [];
  const groupOrder = [];  // ordered plan full names from SESSION body
  const globalDefaults = {};

  // Regex patterns
  const reCreatePlan    = /^CREATE\s+PLAN\s+(\S+)::'[^']*'\s*\(/;
  const reCreateSession = /^CREATE\s+SESSION\s+(\S+)::'[^']*'\s*\(/;
  const reCallPlan      = /^CALL\s+PLAN\s+(\S+)::'[^']*'/;
  const reCallDataflow  = /^CALL\s+DATAFLOW\s+(\S+)::'([^']*)'/;
  const reDisplayName   = /ALGUICOMMENT\(.*?"ui_display_name"='([^']*)'/;
  const reGlobal        = /^\s*GLOBAL\s+(\$\S+)\s+(\S+)/;
  const reJobGV         = /"job_GV_(\$[^"]+)"='([^']*)'/g;
  const reJobName       = /"job_name"='([^']*)'/;
  const reDescription   = /"Description"='([^']*)'/;

  let currentPlan = null;
  let inSession = false;
  let inSessionBody = false;
  let sessionDeclare = false;
  let pendingDisplayName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // ── CREATE PLAN
    const planMatch = line.match(reCreatePlan);
    if (planMatch) {
      currentPlan = planMatch[1];
      plans[currentPlan] = { displayName: '', parallel: false, dataflows: [] };
      inSession = false;
      continue;
    }

    // ── CREATE SESSION
    const sessMatch = line.match(reCreateSession);
    if (sessMatch) {
      sessionName = sessMatch[1];
      currentPlan = null;
      inSession = true;
      sessionDeclare = false;
      inSessionBody = false;
      continue;
    }

    // ── Inside PLAN block
    if (currentPlan && plans[currentPlan]) {
      if (/PARALLEL\s+BEGIN/.test(line)) {
        plans[currentPlan].parallel = true;
        continue;
      }
      const dnMatch = line.match(reDisplayName);
      if (dnMatch) { pendingDisplayName = dnMatch[1]; continue; }

      const dfMatch = line.match(reCallDataflow);
      if (dfMatch) {
        plans[currentPlan].dataflows.push({
          fullName:    dfMatch[1],
          guid:        dfMatch[2] || '',
          displayName: pendingDisplayName || dfMatch[1].split('_').pop()
        });
        pendingDisplayName = '';
        continue;
      }

      // Plan SET section — ends plan block
      if (/^SET\s*\(/.test(line) || /^END$/.test(line)) {
        // do nothing, plan continues until next CREATE
      }
    }

    // ── Inside SESSION block
    if (inSession) {
      if (/^\s*DECLARE\b/.test(line)) { sessionDeclare = true; continue; }
      if (sessionDeclare) {
        const gv = line.match(reGlobal);
        if (gv) { variables.push({ name: gv[1], type: gv[2] }); continue; }
        if (/^BEGIN/.test(line)) { sessionDeclare = false; inSessionBody = true; continue; }
      }

      if (inSessionBody) {
        const dnMatch = line.match(reDisplayName);
        if (dnMatch) { pendingDisplayName = dnMatch[1]; continue; }

        const cpMatch = line.match(reCallPlan);
        if (cpMatch) {
          groupOrder.push(cpMatch[1]);
          if (plans[cpMatch[1]]) plans[cpMatch[1]].displayName = pendingDisplayName || '';
          pendingDisplayName = '';
          continue;
        }
      }

    }

    // ── Global: scan every line for SET properties (they appear at end of file)
    const jnMatch = line.match(reJobName);
    if (jnMatch) sessionDisplayName = jnMatch[1];

    const descMatch = line.match(reDescription);
    if (descMatch) description = descMatch[1];

    let gvMatch;
    reJobGV.lastIndex = 0;
    while ((gvMatch = reJobGV.exec(line)) !== null) {
      globalDefaults[gvMatch[1]] = gvMatch[2];
    }
  }

  // Assign defaults to variables
  variables.forEach(v => { v.default = globalDefaults[v.name] || ''; });

  // Build ordered groups
  const groups = groupOrder.map((planName, idx) => {
    const p = plans[planName] || { displayName: '', parallel: false, dataflows: [] };
    return {
      name: planName,
      displayName: p.displayName || ('Group ' + (idx + 1)),
      parallel: p.parallel,
      dataflows: p.dataflows
    };
  });

  return {
    sessionName: sessionDisplayName || sessionName,
    description,
    variables,
    groups,
    globalDefaults
  };
}

// ── Fetch Application Jobs from IBP API ──────────────────────
async function fetchAndDisplayJobs() {
  if (typeof CFG === 'undefined' || !CFG.url || !CFG.user || !CFG.pass) {
    docsLog('⚠ Debes conectarte a SAP IBP primero.', 'l-warn');
    return;
  }

  const btn = document.getElementById('fetch-jobs-btn');
  btn.disabled = true;
  docsLogEl.innerHTML = '';
  docsLogEl.style.display = 'block';
  docsLogHint.style.display = 'none';
  docsLog('🔍 Consultando Application Jobs…', 'l-info');

  try {
    // BC_EXT_APPJOB_MANAGEMENT uses /sap/opu/odata/sap/ (lowercase) with version suffix ;v=0002
    // Fetch $metadata first to discover entities
    const metaUrl = CFG.url + SVC_APPJOB + '/$metadata';
    let metaXml;
    try {
      metaXml = await apiXml(metaUrl);
      docsLog('✔ $metadata obtenido', 'l-ok');
    } catch (e) {
      docsLog('✗ Error obteniendo $metadata: ' + e.message, 'l-err');
      docsLog('ℹ Asegúrate de tener el Communication Arrangement SAP_COM_0326 configurado.', 'l-info');
      btn.disabled = false;
      return;
    }

    // Parse $metadata to find entity set names
    const metaDoc = new DOMParser().parseFromString(metaXml, 'text/xml');
    const entitySets = [];
    metaDoc.querySelectorAll('EntitySet').forEach(es => {
      entitySets.push(es.getAttribute('Name'));
    });
    // Try to fetch job catalog/templates
    const jobEntity = entitySets.find(n => /JobTemplate|CatalogEntries|JobSchedule/i.test(n)) || entitySets[0];
    if (!jobEntity) {
      docsLog('✗ No se encontraron entidades de jobs en el servicio.', 'l-err');
      btn.disabled = false;
      return;
    }

    docsLog(`🔍 Fetching ${jobEntity}…`, 'l-info');
    const jobsUrl = CFG.url + SVC_APPJOB + '/' + jobEntity;
    const jobs = await fetchAllPages(jobsUrl, docsLogEl);
    fetchedJobs = jobs;
    docsLog(`✔ ${jobs.length} jobs obtenidos`, 'l-ok');

    renderJobSelection(jobs, entitySets);
  } catch (e) {
    docsLog('✗ Error: ' + e.message, 'l-err');
  }
  btn.disabled = false;
}

// ── Render job selection ─────────────────────────────────────
function renderJobSelection(jobs, entitySets) {
  const panel = document.getElementById('jobs-sel-card');
  const list  = document.getElementById('jobs-list');

  if (!jobs.length) {
    list.innerHTML = '<div class="si-empty">No se encontraron jobs.</div>';
    panel.style.display = 'block';
    return;
  }

  // Detect field names dynamically from first job
  const sample = jobs[0];
  const nameField = Object.keys(sample).find(k => /JobName|TemplateName|Name/i.test(k) && typeof sample[k] === 'string') || Object.keys(sample)[0];
  const descField = Object.keys(sample).find(k => /Text|Desc|Description/i.test(k) && typeof sample[k] === 'string') || '';

  list.innerHTML = jobs.map((j, i) => {
    const name = j[nameField] || `Job ${i + 1}`;
    const desc = descField ? (j[descField] || '') : '';
    return `<label class="sel-item job-item" data-idx="${i}" data-name="${escH(name.toLowerCase())}">
      <input type="checkbox" onchange="updateJobsCounter()">
      <span class="si-name">${escH(desc)}</span>
      ${desc ? `<span class="si-df">${escH(name)}</span>` : ''}

    </label>`;
  }).join('');

  // Store field names for later use
  list.dataset.nameField = nameField;
  list.dataset.descField = descField || '';

  document.getElementById('jobs-search').value = '';
  updateJobsCounter();
  panel.style.display = 'block';

  // Show upload panels
  document.getElementById('atl-upload-panel').style.display = 'block';
  document.getElementById('jobs-zip-panel').style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterJobsList() {
  const q = document.getElementById('jobs-search').value.toLowerCase();
  document.querySelectorAll('#jobs-list .job-item').forEach(item => {
    const siName = item.querySelector('.si-name');
    const text = siName ? siName.textContent.toLowerCase() : '';
    item.classList.toggle('hidden', q !== '' && !text.includes(q));
  });
  updateJobsCounter();
}

function toggleJobsFiltered(state) {
  document.querySelectorAll('#jobs-list .job-item:not(.hidden) input[type=checkbox]')
    .forEach(cb => cb.checked = state);
  updateJobsCounter();
}

function updateJobsCounter() {
  const all     = document.querySelectorAll('#jobs-list .job-item');
  const visible  = document.querySelectorAll('#jobs-list .job-item:not(.hidden)');
  const checked  = document.querySelectorAll('#jobs-list .job-item input:checked');
  const q = document.getElementById('jobs-search') ? document.getElementById('jobs-search').value.trim() : '';
  const el = document.getElementById('jobs-counter');
  if (!el) return;
  if (q) {
    const visChecked = [...visible].filter(el => el.querySelector('input').checked).length;
    el.textContent = `${visChecked} / ${visible.length} filtrados · ${checked.length} / ${all.length} total`;
  } else {
    el.textContent = `${checked.length} / ${all.length} seleccionados`;
  }
}

// ── Match ATL dataflows to ZIP integrations ──────────────────
// Primary match: GUID (ATL CALL DATAFLOW ::'guid' == XML <dataflow:DataFlow guid="...">)
// This is a globally unique identifier — no false positives possible.
// Fallback (if ATL or ZIP has no guid): match by dataflowName (display name).
function matchATLtoIntegrations(atlData, parsedInts) {
  // Index by GUID — primary, unambiguous
  const intByGuid = {};
  // Index by dataflowName → [items] — fallback
  const intByDf = {};
  for (const item of parsedInts) {
    const guid  = (item.parsed.dataflowGuid || '').trim();
    const dfKey = (item.parsed.dataflowName || '').toUpperCase().trim();
    if (guid)  intByGuid[guid] = item;
    if (dfKey) {
      if (!intByDf[dfKey]) intByDf[dfKey] = [];
      intByDf[dfKey].push(item);
    }
  }

  const ordered       = [];
  const matchedSheets = new Set();

  for (const group of atlData.groups) {
    for (const df of group.dataflows) {
      let item = null;

      // ── Primary: match by GUID (exact, unique)
      if (df.guid) {
        item = intByGuid[df.guid] || null;
      }

      // ── Fallback: match by dataflow display name
      if (!item) {
        const displayUC  = df.displayName.toUpperCase().trim();
        const candidates = intByDf[displayUC] || [];
        if (candidates.length === 1) {
          item = candidates[0];
        } else if (candidates.length > 1) {
          docsLog(`  ⚠ Múltiples ZIPs con dataflow "${df.displayName}" y sin GUID — no se puede desambiguar`, 'l-warn');
          // Cannot determine which is correct without GUID — skip to avoid false match
          continue;
        }
      }

      if (!item) {
        docsLog(`  ⚠ ATL dataflow sin match en ZIPs: ${df.displayName} (guid: ${df.guid || 'n/a'})`, 'l-warn');
        continue;
      }

      if (!matchedSheets.has(item.sheetName)) {
        matchedSheets.add(item.sheetName);
        ordered.push({
          ...item,
          atlGroup:    (group.displayName || '').replace(/^FLOWof_/i, ''),
          atlOrder:    ordered.length + 1
        });
      }
    }
  }

  // Unmatched integrations go to 'Sin grupo ATL'
  for (const item of parsedInts) {
    if (!matchedSheets.has(item.sheetName)) {
      ordered.push({ ...item, atlGroup: ATL_NO_GROUP, atlOrder: ordered.length + 1 });
    }
  }

  return ordered;
}

// ── Generate from Jobs mode ──────────────────────────────────
async function generateFromJobs() {
  docsLogEl.innerHTML = '';
  docsLogEl.style.display = 'block';
  docsLogHint.style.display = 'none';
  document.getElementById('stats-card').style.display = 'none';
  document.getElementById('sel-card').style.display = 'none';
  document.getElementById('dl-btn').style.display = 'none';
  document.getElementById('jobs-gen-btn').disabled = true;
  xlsBuf = null;
  parsedIntegrations = [];

  // Get selected jobs
  const selectedJobIdxs = [];
  document.querySelectorAll('#jobs-list .job-item').forEach(item => {
    if (item.querySelector('input').checked) selectedJobIdxs.push(+item.dataset.idx);
  });
  const nameField = document.getElementById('jobs-list').dataset.nameField || '';
  const descField = document.getElementById('jobs-list').dataset.descField || '';
  const selectedJobNames = selectedJobIdxs.map(i => {
    const j = fetchedJobs[i];
    if (!j) return '';
    return descField ? (j[descField] || j[nameField] || '') : (j[nameField] || '');
  });

  docsLog(`📋 ${selectedJobIdxs.length} jobs seleccionados`, 'l-info');

  // ── Fetch job steps from JobTemplateSequenceSet
  const stepMap = {};
  if (CFG && CFG.url && CFG.user && selectedJobIdxs.length) {
    docsLog('🔍 Obteniendo pasos de los jobs…', 'l-info');
    const stepFetches = selectedJobIdxs.map(async function(_, ji) {
      const job = fetchedJobs[selectedJobIdxs[ji]];
      if (!job) return [];
      const jtName = job.JobTemplateName || '';
      const jtVer  = job.JobTemplateVersion || '0';
      if (!jtName) return [];
      try {
        const filter = "JobTemplateName eq '" + jtName.replace(/'/g,"''") + "' and JobTemplateVersion eq '" + jtVer + "'";
        const data = await apiJson(CFG.url + SVC_APPJOB + '/JobTemplateSequenceSet?$filter=' + encodeURIComponent(filter) + '&$format=json');
        const steps = ((data.d && data.d.results) || data.value || [])
          .sort(function(a, b) { return (a.JobSequencePosition || 0) - (b.JobSequencePosition || 0); });
        docsLog('  ✔ ' + jtName + ': ' + steps.length + ' pasos', 'l-ok');
        steps.forEach(function(s) {
          docsLog('    pos=' + s.JobSequencePosition + ' → ' + (s.JobSequenceText || s.JceText || ''), 'l-info');
        });
        return steps.map(function(s) {
          return { pos: s.JobSequencePosition || 0, text: s.JobSequenceText || s.JceText || '', jceText: s.JceText || '' };
        });
      } catch(e) {
        docsLog('  ⚠ No se pudieron obtener pasos de ' + jtName + ': ' + e.message, 'l-warn');
        return [];
      }
    });
    const stepResults = await Promise.all(stepFetches);
    stepResults.forEach(function(steps, ji) { stepMap[ji] = steps; });
  }

  // ── Parse ATL files
  atlParsed = [];
  if (atlFiles.length) {
    docsLog('📄 Parseando archivos ATL…', 'l-info');
    for (const af of atlFiles) {
      try {
        const parsed = parseATL(af.text);
        atlParsed.push(parsed);
        const dfCount = parsed.groups.reduce((s, g) => s + g.dataflows.length, 0);
        docsLog(`  ✔ ${af.name}: "${parsed.sessionName}" — ${parsed.groups.length} grupos, ${dfCount} dataflows`, 'l-ok');
      } catch (e) {
        docsLog(`  ✗ ${af.name}: ${e.message}`, 'l-err');
      }
    }
  } else {
    docsLog('ℹ Sin archivos ATL — las integraciones no tendrán orden de proceso.', 'l-info');
  }
  setP(10);

  // ── Parse ZIP files (reuse existing logic)
  const usedNames = new Set();
  function uniq(base) {
    let clean = base.replace(/[:\\\/\?\*\[\]]/g, '_').substring(0, 28);
    let n = clean, k = 0;
    while (usedNames.has(n)) n = clean.substring(0, 25) + '_' + (++k);
    usedNames.add(n); return n;
  }

  if (jobsFiles.length) {
    docsLog('📦 Escaneando ZIPs…', 'l-info');
    let done = 0;
    for (const zf of jobsFiles) {
      docsLog(`📦 ${zf.name}`, 'l-info');
      let zip;
      try { zip = await JSZip.loadAsync(zf.data); }
      catch (e) { docsLog(`  ✗ ${e.message}`, 'l-err'); continue; }

      const batchMap = await parseBatchCsv(zip);

      const xmlNames = Object.keys(zip.files).filter(n => n.endsWith('.xml') && !n.includes('/'));
      docsLog(`  📄 ${xmlNames.length} XMLs`, 'l-line');

      for (let xi = 0; xi < xmlNames.length; xi++) {
        const fname = xmlNames[xi];
        setP(10 + Math.round(40 * (done + (xi + 1) / xmlNames.length) / jobsFiles.length));

        let xmlStr;
        try { xmlStr = await zip.file(fname).async('string'); }
        catch (e) { docsLog(`  ✗ ${fname}: ${e.message}`, 'l-err'); continue; }

        let dfResults;
        try { dfResults = parseIntegration(xmlStr, batchMap[fname] || {}); }
        catch (e) { docsLog(`  ✗ Parse ${fname}: ${e.message}`, 'l-err'); continue; }
        if (!dfResults || !dfResults.length) continue;

        const multiDF = dfResults.length > 1;
        for (const parsed of dfResults) {
          const { jobName, jobDesc, srcDSName, dstDSName, targetTable, mappings, filters, lookups } = parsed;
          const baseName = jobName || fname.replace('.xml', '');
          const sheetName = multiDF ? uniq(baseName + '_' + targetTable) : uniq(baseName);
          const paramRow = {
            jobName, jobDesc,
            tipoIntegracion: parsed.tipoIntegracion,
            dataflowName: parsed.dataflowName,
            srcDS: srcDSName, dstDS: dstDSName,
            targetTable, sheetName
          };
          parsedIntegrations.push({ sheetName, pkg: zf.name, parsed, paramRow });
          docsLog(`  ✔ ${sheetName}  (${mappings.length} mapeos · ${filters.length} filtros)`, 'l-ok');
        }
      }
      done++;
    }
  }
  setP(55);

  // ── Match ATL to integrations and order
  // Each ATL is matched to integrations whose parsed.jobName starts with
  // atl.sessionName + '_' (e.g. "IBP_002_PROCESS_MASTER_DATA_MD_CURRENCY" matches
  // session "IBP_002_PROCESS_MASTER_DATA"). This prevents collisions when multiple
  // processes share a dataflow name.
  // For column H (ibpJobName): ATL[i] is associated with selectedJob[i].
  // In job mode, ATL is required — without it we cannot know which integrations
  // ATL is optional — jobs with only direct tasks (no processes) don't need it.

  let orderedIntegrations = [];
  {
    docsLog('🔗 Mapeando steps → integraciones…', 'l-info');
    const allOrdered = [];
    const globalMatched = new Set();

    for (let ai = 0; ai < atlParsed.length; ai++) {
      const atl = atlParsed[ai];

      // Find the step matching this ATL session across all selected jobs.
      const sessionUC = atl.sessionName.toUpperCase();
      let matchedStep = null;
      let ibpJobIdxForAtl = Math.min(ai, selectedJobIdxs.length - 1);
      let ibpJobNameForAtl = selectedJobNames[ibpJobIdxForAtl] || selectedJobNames[selectedJobNames.length - 1] || '';

      // Pass 1: exact match (text === sessionName)
      for (let ji = 0; ji < selectedJobIdxs.length; ji++) {
        const step = (stepMap[ji] || []).find(s => s.text.toUpperCase() === sessionUC);
        if (step) { matchedStep = step; ibpJobIdxForAtl = ji; ibpJobNameForAtl = selectedJobNames[ji] || ibpJobNameForAtl; break; }
      }
      // Pass 2: partial contains
      if (!matchedStep) {
        for (let ji = 0; ji < selectedJobIdxs.length; ji++) {
          const step = (stepMap[ji] || []).find(s => s.text.toUpperCase().includes(sessionUC) || sessionUC.includes(s.text.toUpperCase()));
          if (step) { matchedStep = step; ibpJobIdxForAtl = ji; ibpJobNameForAtl = selectedJobNames[ji] || ibpJobNameForAtl; break; }
        }
      }

      const ibpStepName = matchedStep ? matchedStep.text    : atl.sessionName;
      const ibpStepPos  = matchedStep ? matchedStep.pos     : 9999;
      const ibpStepType = matchedStep ? matchedStep.jceText : '';

      docsLog(`  📌 "${atl.sessionName}" → step: "${ibpStepName}" (pos ${ibpStepPos})`, 'l-info');

      const matched = matchATLtoIntegrations(atl, parsedIntegrations);
      for (const item of matched) {
        if (item.atlGroup === ATL_NO_GROUP) continue;
        if (globalMatched.has(item.sheetName)) continue;
        globalMatched.add(item.sheetName);
        allOrdered.push({ ...item, ibpJobName: ibpJobNameForAtl, ibpStepName, ibpStepPos, ibpStepType, ibpJobIdx: ibpJobIdxForAtl });
      }
    }

    // ── Direct-task steps: CI-DS steps not covered by any ATL
    // Some CI-DS steps are single tasks (not processes), so no ATL was uploaded for them.
    // Match them directly by step.text === parsed.jobName from the ZIPs.
    const coveredByAtlSessions = new Set(atlParsed.map(a => a.sessionName.toUpperCase()));
    const intsByJobName = {};
    for (const p of parsedIntegrations) {
      const key = (p.parsed.jobName || '').toUpperCase();
      if (key) { if (!intsByJobName[key]) intsByJobName[key] = []; intsByJobName[key].push(p); }
    }

    for (let ji = 0; ji < selectedJobIdxs.length; ji++) {
      const jobNameJ = selectedJobNames[ji] || '';
      for (const step of (stepMap[ji] || [])) {
        if (!(step.jceText || '').toUpperCase().includes(JCE_DATA_INT)) continue;
        const stepTextUC = step.text.toUpperCase();
        if (coveredByAtlSessions.has(stepTextUC)) continue;

        const directMatches = (intsByJobName[stepTextUC] || []).filter(p => !globalMatched.has(p.sheetName));
        if (!directMatches.length) {
          docsLog(`  ⚠ Step "${step.text}" sin ATL y sin ZIP con jobName coincidente`, 'l-warn');
          continue;
        }
        docsLog(`  📎 "${step.text}" (tarea directa) → ${directMatches.length} integración(es)`, 'l-info');
        for (const item of directMatches) {
          globalMatched.add(item.sheetName);
          allOrdered.push({
            ...item,
            atlGroup: '',
            atlOrder: allOrdered.length + 1,
            ibpJobName: jobNameJ,
            ibpStepName: step.text,
            ibpStepPos: step.pos,
            ibpStepType: step.jceText || '',
            ibpJobIdx: ji
          });
        }
      }
    }

    // Sort: job selection order → step position → ATL order within step
    allOrdered.sort(function(a, b) {
      if (a.ibpJobIdx !== b.ibpJobIdx) return (a.ibpJobIdx || 0) - (b.ibpJobIdx || 0);
      if (a.ibpStepPos !== b.ibpStepPos) return (a.ibpStepPos || 0) - (b.ibpStepPos || 0);
      return (a.atlOrder || 0) - (b.atlOrder || 0);
    });

    orderedIntegrations = allOrdered;
    docsLog(`✔ ${orderedIntegrations.length} integraciones documentadas (solo las presentes en el job)`, 'l-ok');
  }
  setP(60);

  // ── Build Excel
  docsLog('🔍 Obteniendo descripciones de campos desde IBP…', 'l-info');
  let ibpDescs = {};
  try {
    ibpDescs = await fetchIbpFieldDescriptions();
    const n = Object.keys(ibpDescs).length;
    docsLog(n > 0 ? `✔ ${n} descripciones de campos obtenidas de IBP` : '⚠ Sin descripciones IBP', n > 0 ? 'l-ok' : 'l-warn');
  } catch (e) { docsLog('⚠ No se pudo consultar IBP: ' + e.message, 'l-warn'); }
  setP(70);

  const sheets = [];
  const paramRows = [];
  let totalJobs = 0, totalMaps = 0, totalFilts = 0;

  // ── Collect non-CI-DS steps as informational rows (no detail sheet)
  const nonDIRows = [];
  for (let ji = 0; ji < selectedJobIdxs.length; ji++) {
    const jobNameJ = selectedJobNames[ji] || '';
    for (const step of (stepMap[ji] || [])) {
      if ((step.jceText || '').toUpperCase().includes(JCE_DATA_INT)) continue;
      nonDIRows.push({
        jobName: '', jobDesc: '', tipoIntegracion: step.jceText || step.text,
        dataflowName: '', srcDS: '', dstDS: '', targetTable: '', sheetName: '',
        atlGroup: '', ibpJobName: jobNameJ, ibpStepName: step.text,
        ibpStepType: step.jceText || '',
        ibpStepPos: step.pos, ibpJobIdx: ji, atlOrder: 0, isNonDI: true
      });
    }
  }

  // ── Merge DI integrations + non-DI rows, sort by job → step pos → ATL order
  orderedIntegrations.forEach(item => {
    item._sortJobIdx  = item.ibpJobIdx  || 0;
    item._sortStepPos = item.ibpStepPos || 0;
    item._sortOrder   = item.atlOrder   || 0;
  });
  nonDIRows.forEach(row => {
    row._sortJobIdx  = row.ibpJobIdx;
    row._sortStepPos = row.ibpStepPos;
    row._sortOrder   = 0;
  });
  const allRows = [...orderedIntegrations, ...nonDIRows];
  allRows.sort(function(a, b) {
    if (a._sortJobIdx  !== b._sortJobIdx)  return a._sortJobIdx  - b._sortJobIdx;
    if (a._sortStepPos !== b._sortStepPos) return a._sortStepPos - b._sortStepPos;
    return a._sortOrder - b._sortOrder;
  });

  for (const row of allRows) {
    if (!row.isNonDI) {
      const { parsed, paramRow } = row;
      parsed.mappings.forEach(m => {
        if (!m.dstDesc && ibpDescs[m.dstField]) m.dstDesc = ibpDescs[m.dstField];
      });
      totalJobs++;
      totalMaps += parsed.mappings.length;
      totalFilts += parsed.filters.length;
      paramRow.atlGroup    = row.atlGroup    || '';
      paramRow.ibpJobName  = row.ibpJobName  || '';
      paramRow.ibpStepName = row.ibpStepName || '';
      paramRow.ibpStepType = row.ibpStepType || '';
      paramRow.isNonDI     = false;
      paramRows.push(paramRow);
      const sb = buildIntegrationSheet(parsed);
      sheets.push({ name: paramRow.sheetName, sb });
    } else {
      paramRows.push(row);
    }
  }

  docsLog('📋 Generando hoja Parámetros…', 'l-info');
  const paramSb = buildParamSheet(paramRows, true);
  sheets.unshift({ name: 'Parámetros', sb: paramSb });

  docsLog('📦 Ensamblando archivo Excel…', 'l-info');
  xlsBuf = await assembleXlsx(sheets);
  setP(100);
  docsLog(`✅ Listo — ${totalJobs} integraciones · ${totalMaps} mapeos · ${totalFilts} filtros`, 'l-ok');

  document.getElementById('s-jobs').textContent = totalJobs;
  document.getElementById('s-maps').textContent = totalMaps;
  document.getElementById('s-filt').textContent = totalFilts;
  document.getElementById('stats-card').style.display = 'block';
  document.getElementById('jobs-gen-btn').disabled = false;
}

// ── Init jobs-mode drop zones on load ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAtlDropZone();
  initJobsZipDropZone();
});

// ════════════════════════════════════════════════════════════
//  DOWNLOAD
// ════════════════════════════════════════════════════════════
function downloadExcel() {
  if (!xlsBuf) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xlsBuf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `SAP_CIDS_Documentacion_${new Date().toISOString().slice(0,10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}