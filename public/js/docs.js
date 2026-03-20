// ════════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════════
let files = [];
let xlsBuf = null;

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
      <span class="name">${f.name}</span>
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

/** Parse one <dataflow:DataFlow> element → { mappings, filters, lookups, targetTable, targetDS } */
function parseDataflow(dfEl, dsIdx) {
  const schemaMap = buildSchemaMap(dfEl, dsIdx);
  const ts        = parseTransforms(dfEl);

  let loaderEl = null;
  for (const el of dfEl.children) {
    if (el.localName === 'elements' && xmiType(el).includes('TableLoader')) { loaderEl = el; break; }
  }
  const targetTable = loaderEl ? (loaderEl.getAttribute('tableName') || loaderEl.getAttribute('displayName') || '') : '';
  const targetDS    = loaderEl ? dsFromRef(loaderEl.getAttribute('referencedDataStore') || '', dsIdx) : '';

  const mappings = [], filters = [], lookups = [];

  // ── MAPPINGS ──────────────────────────────────────────────
  const finalTF = ts['Target_Query'] || Object.values(ts).at(-1) || null;
  if (finalTF) {
    for (const f of finalTF.fields) {
      if (!f.proj) continue;

      if (/\blookup\s*\(/i.test(f.proj)) {
        const lm = f.proj.match(/lookup\s*\(\s*['"]?([^'",()\s]+)/i);
        lookups.push({ func:'lookup()', file: lm ? lm[1] : '?', desc:`Campo destino: ${f.name}` });
      }

      const { srcDS, srcTable, srcField, ops } = processField(f.proj, ts, schemaMap);
      mappings.push({ srcDS, srcTable, srcField,
                      dstDS: targetDS, dstTable: targetTable,
                      dstField: f.name, dstDesc: f.desc, ops });
    }
  }

  // ── FILTERS ──────────────────────────────────────────────
  // Expand filter expressions too so they show real table names
  const seenF = new Set();
  for (const info of Object.values(ts)) {
    const fe = info.filterExpr;
    if (!fe) continue;
    const feExp   = expandExpr(fe.replace(/&#xA;/g, '\n'), ts);
    const lines   = feExp.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^(and|or|\(|\))$/i.test(line)) continue;
      // Match first table.field ref in this line (quoted or normal)
      const re2 = new RegExp(_REF.source);
      const ref = line.match(re2);
      if (!ref) continue;
      const r = refFromMatch(Array.from(ref));
      if (r.schema in ts) continue;  // guard: still a transform
      const tbl = schemaMap[r.schema]?.table || r.schema;
      const key = tbl + '|' + r.field + '|' + line.substring(0,80);
      if (seenF.has(key)) continue;
      seenF.add(key);
      filters.push({ sourceTable:tbl, sourceField:r.field,
                     expression: line.length > 400 ? line.substring(0,400)+'…' : line,
                     description:'' });
    }
  }

  return { mappings, filters, lookups, targetTable, targetDS };
}

/** Parse one integration XML + batch entry → full parsed object */
function parseIntegration(xmlStr, batchEntry) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const root = doc.documentElement;

  const dsIdx = buildDsIndexMap(root);

  // Job metadata
  let jobName = '', jobDesc = '';
  for (const c of root.children) {
    if (c.localName === 'Job') {
      jobName = c.getAttribute('name') || '';
      jobDesc = getProp(c, 'Description') || c.getAttribute('description') || '';
      break;
    }
  }

  // All DataFlows
  let allMaps = [], allFilts = [], allLooks = [], targetTable = '', targetDS = '';
  for (const c of root.children) {
    if (c.localName !== 'DataFlow') continue;
    const { mappings, filters, lookups, targetTable:tt, targetDS:tds } = parseDataflow(c, dsIdx);
    allMaps.push(...mappings); allFilts.push(...filters); allLooks.push(...lookups);
    if (tt) targetTable = tt;
    if (tds) targetDS   = tds;
  }

  const srcDSName = batchEntry?.src_datastore_Name || '';
  const dstDSName = batchEntry?.target_datastorename || targetDS || '';

  for (const m of allMaps) {
    if (!m.srcDS && srcDSName) m.srcDS = srcDSName;
    if (!m.dstDS && dstDSName) m.dstDS = dstDSName;
  }

  return { jobName, jobDesc, srcDSName, dstDSName, targetTable,
           mappings: allMaps, filters: allFilts, lookups: allLooks };
}

// ════════════════════════════════════════════════════════════
//  XLSX GENERATOR — Pure XML via JSZip (full style support)
//  Builds a real .xlsx from scratch without SheetJS Pro.
// ════════════════════════════════════════════════════════════

// ── Style index constants ────────────────────────────────────
// These numbers match the xf index in styles.xml (0-based)
const XF = {
  // Parámetros sheet
  PRM_TITLE:     1,   // Title row: white bold 15 on dark navy, center, bottom-medium
  PRM_TITLE_PAD: 2,   // Padding cells in title row
  PRM_SUBTITLE:  3,   // Subtitle italic on dark navy
  SPACER:        4,   // Spacer fill
  PRM_HDR:       5,   // Column header: white bold 9 on cobalt, center, bottom-medium
  // Parámetros data rows (white bg)
  PRM_TBL:      6,   // Target table: bold teal-dark
  PRM_LINK:     7,   // Hyperlink: bold blue underline
  PRM_TASK:     8,   // Task name: normal dark
  PRM_DESC:     9,   // Description: italic mid-gray
  PRM_SRC:      10,  // DS Origen: bold teal
  PRM_DST:      11,  // DS Destino: bold emerald
  // Parámetros data rows (alt bg EEF4FF)
  PRM_TBL_A:   12,
  PRM_LINK_A:  13,
  PRM_TASK_A:  14,
  PRM_DESC_A:  15,
  PRM_SRC_A:   16,
  PRM_DST_A:   17,
  // Integration sheet header
  INT_JOBTITLE: 18,  // Job title: bold 13 dark-navy on lightBlue
  INT_JOBTPAD:  19,  // Padding in job title row
  INT_JOBDESC:  20,  // Job description: 9 mid on F7F9FD
  INT_JOBDPAD:  21,  // Padding in desc row
  INT_DSLAB:    22,  // "Origen:"/"Destino:" label
  INT_DSSRC:    23,  // DS origin value: bold teal
  INT_DSDST:    24,  // DS destination value: bold emerald (reuse 24→same as PRM_DST on F0F4FF)
  INT_DSPAD:    21,  // Padding in DS row (same shade as desc)
  // Map section
  MAP_SEC:      27,  // Section title: white bold 12 on map1, bottom-medium
  MAP_SEC_PAD:  28,  // Section title padding
  MAP_HDR:      29,  // Column header: white bold 9 on map2, bottom-medium
  MAP_DS:       30,  // DS col white bg: bold teal
  MAP_TBL:      31,  // Table col white: bold mid
  MAP_FLD:      32,  // Field col white: normal dark
  MAP_OPS:      32,  // Ops: italic ops-color (same idx, different fill for alt)
  MAP_DS_A:     33,  // DS col alt bg EDF3FC
  MAP_TBL_A:    34,
  MAP_FLD_A:    35,
  // Filter section
  FLT_SEC:      39,  // Section title on flt1
  FLT_SEC_PAD:  40,
  FLT_HDR:      41,  // Header on flt2
  FLT_TBL:      44,  // Table col white
  FLT_FLD:      45,  // Field col white
  FLT_OPS:      47,  // Ops/expr: italic
  FLT_TBL_A:    44,  // alt (reuse; fill differs in XML but same xf for simplicity - we'll handle below)
};

// ── Hardcoded styles.xml ─────────────────────────────────────
// Built from the openpyxl reference file and extended for all needed combinations
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="0"/>
<fonts count="17">
  <font><name val="Calibri"/><family val="2"/><sz val="11"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FFFFFFFF"/><sz val="15"/></font>
  <font><name val="Calibri"/><color rgb="FF1A1D27"/><sz val="10"/></font>
  <font><name val="Calibri"/><i val="1"/><color rgb="FF99AACC"/><sz val="9"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FFFFFFFF"/><sz val="9"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FF0A3B5C"/><sz val="9"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FF2B6CB0"/><sz val="9"/><u val="single"/></font>
  <font><name val="Calibri"/><color rgb="FF1A1D27"/><sz val="9"/></font>
  <font><name val="Calibri"/><i val="1"/><color rgb="FF3D4560"/><sz val="9"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FF0E6674"/><sz val="9"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FF0E6B3F"/><sz val="9"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FF0D2137"/><sz val="13"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FF6B7494"/><sz val="8"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FFFFFFFF"/><sz val="12"/></font>
  <font><name val="Calibri"/><b val="1"/><color rgb="FF3D4560"/><sz val="9"/></font>
  <font><name val="Calibri"/><i val="1"/><color rgb="FF6B7494"/><sz val="9"/></font>
  <font><name val="Calibri"/><i val="1"/><color rgb="FF444466"/><sz val="8"/></font>
</fonts>
<fills count="20">
  <fill><patternFill/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF0A1628"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF4F6FB"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1A3A6E"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEEF4FF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEBF0FA"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FD"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF0F4FF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF0D2137"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1B4B82"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEDF3FC"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF0D3B2E"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1A6B4A"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEDFAF4"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF2D1B69"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF5B3FC9"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF3EFFE"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF0A1628"/></patternFill></fill>
</fills>
<borders count="12">
  <border><left/><right/><top/><bottom/></border>
  <border>
    <left style="thin"><color rgb="FF1A3A6E"/></left><right style="thin"><color rgb="FF1A3A6E"/></right>
    <top style="thin"><color rgb="FF1A3A6E"/></top><bottom style="medium"><color rgb="FF1A3A6E"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FF0A1628"/></left><right style="thin"><color rgb="FF0A1628"/></right>
    <top style="thin"><color rgb="FF0A1628"/></top><bottom style="thin"><color rgb="FF0A1628"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FFB0BCDB"/></left><right style="thin"><color rgb="FFB0BCDB"/></right>
    <top style="thin"><color rgb="FFB0BCDB"/></top><bottom style="medium"><color rgb="FFB0BCDB"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FFD0D7E8"/></left><right style="thin"><color rgb="FFD0D7E8"/></right>
    <top style="thin"><color rgb="FFD0D7E8"/></top><bottom style="thin"><color rgb="FFD0D7E8"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FFB0BCDB"/></left><right style="thin"><color rgb="FFB0BCDB"/></right>
    <top style="thin"><color rgb="FFB0BCDB"/></top><bottom style="thin"><color rgb="FFB0BCDB"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FF1B4B82"/></left><right style="thin"><color rgb="FF1B4B82"/></right>
    <top style="thin"><color rgb="FF1B4B82"/></top><bottom style="medium"><color rgb="FF1B4B82"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FFB8C8E8"/></left><right style="thin"><color rgb="FFB8C8E8"/></right>
    <top style="thin"><color rgb="FFB8C8E8"/></top><bottom style="thin"><color rgb="FFB8C8E8"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FF1A6B4A"/></left><right style="thin"><color rgb="FF1A6B4A"/></right>
    <top style="thin"><color rgb="FF1A6B4A"/></top><bottom style="medium"><color rgb="FF1A6B4A"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FF5B3FC9"/></left><right style="thin"><color rgb="FF5B3FC9"/></right>
    <top style="thin"><color rgb="FF5B3FC9"/></top><bottom style="medium"><color rgb="FF5B3FC9"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FF0D3B2E"/></left><right style="thin"><color rgb="FF0D3B2E"/></right>
    <top style="thin"><color rgb="FF0D3B2E"/></top><bottom style="thin"><color rgb="FF0D3B2E"/></bottom>
  </border>
  <border>
    <left style="thin"><color rgb="FF1A6B4A"/></left><right style="thin"><color rgb="FF1A6B4A"/></right>
    <top style="thin"><color rgb="FF1A6B4A"/></top><bottom style="thin"><color rgb="FF1A6B4A"/></bottom>
  </border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="55">
  <!-- 0: default -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <!-- 1: PRM title white bold 15 navy center bottom-medium -->
  <xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <!-- 2: PRM title padding -->
  <xf numFmtId="0" fontId="0" fillId="2" borderId="2" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 3: PRM subtitle italic -->
  <xf numFmtId="0" fontId="3" fillId="2" borderId="2" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <!-- 4: spacer -->
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0"/>
  <!-- 5: PRM col header white bold 9 cobalt center bottom-medium -->
  <xf numFmtId="0" fontId="4" fillId="4" borderId="3" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <!-- 6: PRM table bold teal-dark white bg -->
  <xf numFmtId="0" fontId="5" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 7: PRM link bold blue underline white bg -->
  <xf numFmtId="0" fontId="6" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 8: PRM task normal dark white bg -->
  <xf numFmtId="0" fontId="7" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 9: PRM desc italic mid white bg -->
  <xf numFmtId="0" fontId="8" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 10: PRM src bold teal white bg -->
  <xf numFmtId="0" fontId="9" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 11: PRM dst bold emerald white bg -->
  <xf numFmtId="0" fontId="10" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 12: PRM table alt bg EEF4FF -->
  <xf numFmtId="0" fontId="5" fillId="6" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 13: PRM link alt bg -->
  <xf numFmtId="0" fontId="6" fillId="6" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 14: PRM task alt bg -->
  <xf numFmtId="0" fontId="7" fillId="6" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 15: PRM desc alt bg -->
  <xf numFmtId="0" fontId="8" fillId="6" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 16: PRM src alt bg -->
  <xf numFmtId="0" fontId="9" fillId="6" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 17: PRM dst alt bg -->
  <xf numFmtId="0" fontId="10" fillId="6" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 18: INT job title bold 13 dark-navy on lightBlue EBF0FA bottom-medium -->
  <xf numFmtId="0" fontId="11" fillId="7" borderId="6" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 19: INT job title padding -->
  <xf numFmtId="0" fontId="0" fillId="7" borderId="7" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 20: INT desc italic 9 mid on F7F9FD -->
  <xf numFmtId="0" fontId="8" fillId="8" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 21: INT desc padding F7F9FD -->
  <xf numFmtId="0" fontId="0" fillId="8" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 22: INT DS label bold 8 gray on F0F4FF -->
  <xf numFmtId="0" fontId="12" fillId="9" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 23: INT DS src bold teal on F0F4FF -->
  <xf numFmtId="0" fontId="9" fillId="9" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 24: INT DS dst bold emerald on F0F4FF -->
  <xf numFmtId="0" fontId="10" fillId="9" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 25: empty -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <!-- 26: empty -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <!-- 27: MAP section title white bold 12 on 0D2137 bottom-medium -->
  <xf numFmtId="0" fontId="13" fillId="10" borderId="6" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 28: MAP section title padding -->
  <xf numFmtId="0" fontId="0" fillId="10" borderId="2" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
  <!-- 29: MAP col header white bold 9 on 1B4B82 bottom-medium -->
  <xf numFmtId="0" fontId="4" fillId="11" borderId="6" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <!-- 30: MAP DS src bold teal white bg -->
  <xf numFmtId="0" fontId="9" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 31: MAP table bold mid white bg -->
  <xf numFmtId="0" fontId="14" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 32: MAP field normal dark white bg -->
  <xf numFmtId="0" fontId="7" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 33: MAP DS src alt bg EDF3FC -->
  <xf numFmtId="0" fontId="9" fillId="12" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 34: MAP table alt bg -->
  <xf numFmtId="0" fontId="14" fillId="12" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 35: MAP field alt bg -->
  <xf numFmtId="0" fontId="7" fillId="12" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 36: MAP ops italic white bg -->
  <xf numFmtId="0" fontId="16" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 37: MAP ops italic alt bg -->
  <xf numFmtId="0" fontId="16" fillId="12" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 38: MAP desc italic white bg -->
  <xf numFmtId="0" fontId="15" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 39: FLT section title white bold 12 on 0D3B2E -->
  <xf numFmtId="0" fontId="13" fillId="13" borderId="8" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 40: FLT section padding -->
  <xf numFmtId="0" fontId="0" fillId="13" borderId="10" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
  <!-- 41: FLT col header white bold 9 on 1A6B4A -->
  <xf numFmtId="0" fontId="4" fillId="14" borderId="8" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <!-- 42: FLT hdr padding -->
  <xf numFmtId="0" fontId="0" fillId="14" borderId="11" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
  <!-- 43: FLT table bold mid white -->
  <xf numFmtId="0" fontId="14" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 44: FLT table bold mid alt EDFAF4 -->
  <xf numFmtId="0" fontId="14" fillId="15" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 45: FLT field white -->
  <xf numFmtId="0" fontId="7" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 46: FLT field alt -->
  <xf numFmtId="0" fontId="7" fillId="15" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 47: FLT ops italic white -->
  <xf numFmtId="0" fontId="16" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 48: FLT ops italic alt -->
  <xf numFmtId="0" fontId="16" fillId="15" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 49: LKP section title white bold 12 on 2D1B69 -->
  <xf numFmtId="0" fontId="13" fillId="16" borderId="9" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 50: LKP section padding -->
  <xf numFmtId="0" fontId="0" fillId="16" borderId="2" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
  <!-- 51: LKP col header white bold 9 on 5B3FC9 -->
  <xf numFmtId="0" fontId="4" fillId="17" borderId="9" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <!-- 52: LKP data white -->
  <xf numFmtId="0" fontId="7" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 53: LKP data alt F3EFFE -->
  <xf numFmtId="0" fontId="7" fillId="18" borderId="5" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <!-- 54: MAP dst bold emerald white bg -->
  <xf numFmtId="0" fontId="10" fillId="5" borderId="4" applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
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

// Convert (row, col) 0-based to Excel reference like "A1"
function cellRef(r, c) {
  let col = '';
  let n = c + 1;
  while (n > 0) { col = String.fromCharCode(65 + (n - 1) % 26) + col; n = Math.floor((n - 1) / 26); }
  return col + (r + 1);
}

// ── Sheet builder ────────────────────────────────────────────
// A sheet is built row by row. Each cell is { v: value, s: xfIndex }
// Merges are tracked separately.

class SheetBuilder {
  constructor() {
    this.rows = [];
    this.merges = [];
    this.hyperlinks = []; // [{cellRef, target}]  target = "#'SheetName'!A1"
    this.colWidths = [];
    this.rowHeights = [];
  }

  addRow(cells, height = 18) {
    this.rows.push(cells);
    this.rowHeights.push(height);
  }

  merge(r1, c1, r2, c2) {
    this.merges.push({ r1, c1, r2, c2 });
  }

  // Register a hyperlink on a cell (row/col 0-based)
  addHyperlink(r, c, target) {
    this.hyperlinks.push({ ref: cellRef(r, c), target });
  }

  setColWidths(widths) { this.colWidths = widths; }

  addMergedRow(value, xfValue, xfPad, totalCols, height = 22) {
    const r = this.rows.length;
    const cells = [{ v: value, s: xfValue }];
    for (let c = 1; c < totalCols; c++) cells.push({ v: '', s: xfPad });
    this.addRow(cells, height);
    this.merge(r, 0, r, totalCols - 1);
  }

  addSpacerRow(totalCols, height = 6) {
    this.addRow(Array(totalCols).fill({ v: '', s: 4 }), height);
  }

  // Returns { xml, relsXml } — relsXml is null when no hyperlinks
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

    // Hyperlinks section in sheet XML (reference rId1, rId2, ...)
    let hyperlinkXml = '';
    let relsXml = null;
    if (this.hyperlinks.length > 0) {
      const NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
      hyperlinkXml = '<hyperlinks>' +
        this.hyperlinks.map((hl, i) =>
          `<hyperlink ${NS} ref="${hl.ref}" r:id="rId${i+1}"/>`
        ).join('') + '</hyperlinks>';

      // Build the _rels XML for this sheet
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
function buildParamSheet(rows) {
  const sb = new SheetBuilder();
  const N = 6;

  sb.addMergedRow('PARÁMETROS DE INTEGRACIONES SAP CIDS', 1, 2, N, 34);
  sb.addMergedRow(`${rows.length} integraciones documentadas`, 3, 2, N, 16);
  sb.addSpacerRow(N, 8);
  sb.addRow([
    {v:'Tabla de Destino',s:5},{v:'Nombre del Dato',s:5},{v:'Nombre del Task',s:5},
    {v:'Descripción',s:5},{v:'DS Origen',s:5},{v:'DS Destino',s:5}
  ], 22);

  rows.forEach((p, i) => {
    const a = i % 2 === 1;
    const dataRowIdx = sb.rows.length; // current row index before adding
    sb.addRow([
      {v: p.targetTable||'', s: a?12:6},
      {v: p.jobName||'',     s: a?13:7},  // col 1 = "Nombre del Dato" with link style
      {v: p.jobName||'',     s: a?14:8},
      {v: p.jobDesc||'',     s: a?15:9},
      {v: p.srcDS||'',       s: a?16:10},
      {v: p.dstDS||'',       s: a?17:11},
    ], 20);
    // Register hyperlink on col 1 (Nombre del Dato) → target sheet
    sb.addHyperlink(dataRowIdx, 1, `#'${p.sheetName}'!A1`);
  });

  sb.setColWidths([28, 34, 38, 52, 18, 18]);
  return sb;
}

// ── Integration sheet ────────────────────────────────────────
function buildIntegrationSheet(parsed, srcDS, dstDS) {
  const sb = new SheetBuilder();
  const { jobName, jobDesc, mappings, filters, lookups } = parsed;
  const N = 8;

  // Header block
  sb.addMergedRow(jobName || '', 18, 19, N, 30);
  if (jobDesc) sb.addMergedRow(jobDesc, 20, 21, N, 18);
  // DS bar
  const dsRow = [
    {v:'  Origen:', s:22}, {v:srcDS||'', s:23}, {v:'', s:21},
    {v:'  Destino:', s:22}, {v:dstDS||'', s:24},
    {v:'',s:21},{v:'',s:21},{v:'',s:21}
  ];
  const dsRowIdx = sb.rows.length;
  sb.addRow(dsRow, 18);
  sb.merge(dsRowIdx, 1, dsRowIdx, 2);
  sb.merge(dsRowIdx, 4, dsRowIdx, 7);
  sb.addSpacerRow(N, 6);

  // TABLE 1 — MAPEOS
  sb.addMergedRow('▸  TABLA 1  —  MAPEO DE CAMPOS', 27, 28, N, 22);
  sb.addRow([
    {v:'DS Origen',s:29},{v:'Tabla Origen',s:29},{v:'Campo Origen',s:29},
    {v:'DS Destino',s:29},{v:'Tabla Destino',s:29},{v:'Campo Destino',s:29},
    {v:'Descripción',s:29},{v:'Operaciones',s:29}
  ], 22);
  if (!mappings.length) {
    sb.addMergedRow('Sin mapeos detectados en esta integración', 32, 28, N, 18);
  } else {
    mappings.forEach((m, i) => {
      const a = i % 2 === 1;
      sb.addRow([
        {v:m.srcDS||srcDS||'', s:a?33:30},
        {v:m.srcTable||'',     s:a?34:31},
        {v:m.srcField||'',     s:a?35:32},
        {v:m.dstDS||dstDS||'', s:a?33:54},
        {v:m.dstTable||'',     s:a?34:31},
        {v:m.dstField||'',     s:a?35:32},
        {v:m.dstDesc||'',      s:a?35:38},
        {v:m.ops||'',          s:a?37:36},
      ], 18);
    });
  }
  sb.addSpacerRow(N, 6);
  sb.addSpacerRow(N, 6);

  // TABLE 2 — FILTROS
  sb.addMergedRow('▸  TABLA 2  —  FILTROS UTILIZADOS', 39, 40, N, 22);
  sb.addRow([
    {v:'Tabla Origen',s:41},{v:'Campo Origen',s:41},{v:'Expresión Filtrada',s:41},
    {v:'Descripción del Filtro',s:41},
    {v:'',s:42},{v:'',s:42},{v:'',s:42},{v:'',s:42}
  ], 22);
  if (!filters.length) {
    sb.addMergedRow('Sin filtros detectados en esta integración', 45, 40, N, 18);
  } else {
    filters.forEach((f, i) => {
      const a = i % 2 === 1;
      sb.addRow([
        {v:f.sourceTable||'', s:a?44:43},
        {v:f.sourceField||'', s:a?46:45},
        {v:f.expression||'',  s:a?48:47},
        {v:f.description||'', s:a?46:45},
        {v:'',s:a?44:43},{v:'',s:a?44:43},{v:'',s:a?44:43},{v:'',s:a?44:43}
      ], 18);
    });
  }
  sb.addSpacerRow(N, 6);
  sb.addSpacerRow(N, 6);

  // TABLE 3 — LOOKUPS
  sb.addMergedRow('▸  TABLA 3  —  FUNCIONES LOOKUP', 49, 50, N, 22);
  sb.addRow([
    {v:'Función Lookup',s:51},{v:'Archivo / Tabla Utilizada',s:51},{v:'Descripción',s:51},
    {v:'',s:51},{v:'',s:51},{v:'',s:51},{v:'',s:51},{v:'',s:51}
  ], 22);
  if (!lookups.length) {
    sb.addMergedRow('Sin lookups detectados en esta integración', 52, 50, N, 18);
  } else {
    lookups.forEach((l, i) => {
      const a = i % 2 === 1;
      sb.addRow([
        {v:l.func||'', s:a?53:52},
        {v:l.file||'', s:a?53:52},
        {v:l.desc||'', s:a?53:52},
        {v:'',s:a?53:52},{v:'',s:a?53:52},{v:'',s:a?53:52},{v:'',s:a?53:52},{v:'',s:a?53:52}
      ], 18);
    });
  }

  sb.setColWidths([16, 22, 30, 16, 24, 24, 26, 52]);
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
async function generate() {
  docsLogEl.innerHTML = '';
  docsLogEl.style.display = 'block';
  docsLogHint.style.display = 'none';
  document.getElementById('stats-card').style.display = 'none';
  document.getElementById('dl-btn').style.display = 'none';
  document.getElementById('gen-btn').disabled = true;
  xlsBuf = null;

  docsLog('Iniciando…', 'l-info');
  setP(2);

  const sheets = [];   // [{name, sb}]
  const paramRows = [];
  let totalJobs = 0, totalMaps = 0, totalFilts = 0;
  const usedNames = new Set();

  function uniq(base) {
    // Excel sheet names: max 31 chars, no special chars
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

    // batch.csv
    const batchMap = {};
    const bf = zip.file('batch.csv');
    if (bf) {
      const csv = await bf.async('string');
      const lines = csv.trim().split(/\r?\n/);
      const hdrs  = lines[0].split(',').map(h => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const cols  = lines[i].split(',').map(c => c.trim());
        const entry = {};
        hdrs.forEach((h, j) => entry[h] = cols[j] || '');
        if (entry['Xmlfilename']) batchMap[entry['Xmlfilename']] = entry;
      }
      docsLog(`  ✔ batch.csv: ${Object.keys(batchMap).length} entradas`, 'l-ok');
    } else docsLog('  ⚠ Sin batch.csv', 'l-warn');

    const xmlNames = Object.keys(zip.files).filter(n => n.endsWith('.xml') && !n.includes('/'));
    docsLog(`  📄 ${xmlNames.length} XMLs`, 'l-line');

    for (let xi = 0; xi < xmlNames.length; xi++) {
      const fname = xmlNames[xi];
      setP(2 + Math.round(94 * (done + (xi+1)/xmlNames.length) / files.length));

      let xmlStr;
      try { xmlStr = await zip.file(fname).async('string'); }
      catch(e) { docsLog(`  ✗ ${fname}: ${e.message}`, 'l-err'); continue; }

      let parsed;
      try { parsed = parseIntegration(xmlStr, batchMap[fname] || {}); }
      catch(e) { docsLog(`  ✗ Parse ${fname}: ${e.message}`, 'l-err'); continue; }
      if (!parsed) { docsLog(`  ⚠ XML inválido: ${fname}`, 'l-warn'); continue; }

      const { jobName, jobDesc, srcDSName, dstDSName, targetTable, mappings, filters, lookups } = parsed;
      totalJobs++;
      totalMaps  += mappings.length;
      totalFilts += filters.length;

      const sheetName = uniq(jobName || fname.replace('.xml',''));
      paramRows.push({ jobName, jobDesc, srcDS: srcDSName, dstDS: dstDSName, targetTable, sheetName });

      const sb = buildIntegrationSheet(parsed, srcDSName, dstDSName);
      sheets.push({ name: sheetName, sb });
      docsLog(`  ✔ ${sheetName}  (${mappings.length} mapeos · ${filters.length} filtros · ${lookups.length} lookups)`, 'l-ok');
    }
    done++;
  }

  // Build Parámetros sheet (insert at front)
  docsLog('📋 Generando hoja Parámetros…', 'l-info');
  const paramSb = buildParamSheet(paramRows);
  sheets.unshift({ name: 'Parámetros', sb: paramSb });

  docsLog('📦 Ensamblando archivo Excel con estilos…', 'l-info');
  xlsBuf = await assembleXlsx(sheets);
  setP(100);
  docsLog(`✅ Listo — ${totalJobs} jobs · ${totalMaps} mapeos · ${totalFilts} filtros`, 'l-ok');

  document.getElementById('s-jobs').textContent = totalJobs;
  document.getElementById('s-maps').textContent = totalMaps;
  document.getElementById('s-filt').textContent = totalFilts;
  document.getElementById('stats-card').style.display = 'block';
  document.getElementById('dl-btn').style.display = 'flex';
  document.getElementById('gen-btn').disabled = false;
}

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