// @ts-nocheck
// ════════════════════════════════════════════════════════════
//  INTEGRATION EXPLORER
//  Reutiliza parseBatchCsv() y parseIntegration() de docs.js
//  (globals top-level, no IIFE — accesibles directamente).
//
//  Namespace único "Explorer" para no colisionar con docs.js
//  que declara files, dz, addFiles, etc. a nivel global.
// ════════════════════════════════════════════════════════════

const Explorer = (function () {

  // ── Estado ───────────────────────────────────────────────
  let exFiles       = [];   // [{name, data: ArrayBuffer}]
  let integrations  = [];   // flat: un parsed por dataflow, con _zipName, _idx
  let filtered      = [];   // subset de integrations según búsqueda
  let indexes       = {};   // byTargetKey, bySourceKey, byFileWritten, byFileRead
  let chainEdges    = [];   // [{from, to, via:'table'|'file', label}]
  let selectedIdx   = null;
  let currentView   = 'list';
  let currentDim    = 'integration'; // 'integration'|'dst-table'|'src-table'|'dst-field'|'src-field'
  let selectedDimKey = null;
  let visNetwork    = null;
  let analyzing     = false;

  // ── Normalización de claves para matching ───────────────
  function normTableKey(ds, tbl) {
    const d = (ds  || '').trim().toUpperCase();
    const t = (tbl || '').replace(/^.*[\\/]/, '').trim().toUpperCase();
    return d + '::' + t;
  }
  function normFileKey(file) {
    if (!file) return '';
    return 'FILE::' + file.replace(/^.*[\\/]/, '').toUpperCase();
  }

  // ── Drop zone ────────────────────────────────────────────
  function initDropZone() {
    const dz = document.getElementById('ex-dz');
    const fi = document.getElementById('ex-fi');
    if (!dz || !fi) return;
    dz.addEventListener('click', e => { if (e.target !== fi) fi.click(); });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addFiles([...e.dataTransfer.files]); });
    fi.addEventListener('change', e => { addFiles([...e.target.files]); fi.value = ''; });
  }

  function addFiles(list) {
    list.filter(f => f.name.toLowerCase().endsWith('.zip')).forEach(f => {
      if (exFiles.find(x => x.name === f.name)) return;
      const r = new FileReader();
      r.onload = ev => { exFiles.push({ name: f.name, data: ev.target.result }); renderFiles(); };
      r.readAsArrayBuffer(f);
    });
  }

  function removeFile(i) {
    exFiles.splice(i, 1);
    renderFiles();
  }

  function renderFiles() {
    const el = document.getElementById('ex-file-list');
    const btn = document.getElementById('ex-analyze-btn');
    if (!el) return;
    el.innerHTML = exFiles.map((f, i) => `
      <div class="file-tag">
        <span class="ico">📦</span>
        <span class="name">${escH(f.name)}</span>
        <span class="size">${(f.data.byteLength / 1024).toFixed(0)} KB</span>
        <button class="rm" onclick="Explorer.removeFile(${i})">✕</button>
      </div>`).join('');
    if (btn) btn.disabled = exFiles.length === 0;
  }

  // ── Análisis principal ───────────────────────────────────
  async function analyze() {
    if (analyzing) return;
    analyzing = true;
    const btn = document.getElementById('ex-analyze-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Analizando...'; }

    integrations   = [];
    chainEdges     = [];
    selectedIdx    = null;
    selectedDimKey = null;
    currentDim     = 'integration';
    ALL_DIMS.forEach(d => {
      const b = document.getElementById('ex-dim-' + d);
      if (b) b.classList.toggle('active', d === 'integration');
    });
    const vt = document.getElementById('ex-view-toggle');
    if (vt) vt.style.display = '';

    for (const f of exFiles) {
      try {
        const zip = await JSZip.loadAsync(f.data);
        // parseBatchCsv y parseIntegration son globals de docs.js
        const batchMap = await parseBatchCsv(zip);
        const xmlNames = Object.keys(zip.files).filter(n => n.endsWith('.xml') && !n.includes('/'));
        for (const xmlName of xmlNames) {
          const xmlStr = await zip.file(xmlName).async('string');
          const arr = parseIntegration(xmlStr, batchMap[xmlName]);
          arr.forEach(p => {
            p._zipName = f.name;
            p._idx     = integrations.length;
            integrations.push(p);
          });
        }
      } catch (e) {
        console.error('Explorer: error en ZIP', f.name, e);
      }
    }

    buildIndexes();
    detectChains();
    filtered = integrations.slice();
    renderSidebarList(filtered);
    updateCounter(filtered.length, integrations.length);

    const results = document.getElementById('ex-results');
    if (results) results.style.display = 'block';

    // Log de diagnóstico en consola para ayudar a depurar cadenas
    console.debug(`[Explorer] ${integrations.length} dataflows, ${chainEdges.length} cadenas`);
    if (integrations.length > 0 && chainEdges.length === 0) {
      console.debug('[Explorer] Sin cadenas. Muestra de destinos:', integrations.slice(0,5).map(p => `${p.dstDSName}::${p.targetTable}`));
      console.debug('[Explorer] Muestra de orígenes:', integrations.slice(0,5).map(p => p.mappings.slice(0,2).map(m => `${m.srcDS}::${m.srcTable}`)));
    }

    analyzing = false;
    if (btn) { btn.disabled = false; btn.textContent = '🔬 Explorar integraciones'; }
  }

  // ── Índices ──────────────────────────────────────────────
  // Regex para extraer tokens TABLA.CAMPO o CAMPO de expresiones de filtro.
  // Se excluyen palabras clave SQL comunes para evitar ruido.
  const _FILTER_SQL_KW = new Set([
    'AND','OR','NOT','IS','NULL','IN','LIKE','BETWEEN','EXISTS','SELECT',
    'FROM','WHERE','JOIN','ON','AS','CASE','WHEN','THEN','ELSE','END',
    'TRIM','UPPER','LOWER','SUBSTR','LENGTH','CONVERT','CAST','COALESCE',
    'IFTHENELSE','ISNULL','IFNULL','IIF','SYSDATE','GEN_UUID',
  ]);

  function extractFilterFields(expr) {
    // Captura TOKEN.CAMPO o TOKEN standalone (sin operadores ni literales)
    const tokens = new Set();
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\b/g;
    let m;
    while ((m = re.exec(expr)) !== null) {
      const schemaOrField = m[1].toUpperCase();
      const field         = m[2] ? m[2].toUpperCase() : null;
      if (field) {
        // TABLE.FIELD pattern — index the FIELD part
        if (!_FILTER_SQL_KW.has(field)) tokens.add(field);
      } else {
        // standalone token — only index if not a keyword and looks like a column
        if (!_FILTER_SQL_KW.has(schemaOrField) && schemaOrField.length >= 2)
          tokens.add(schemaOrField);
      }
    }
    return [...tokens];
  }

  function buildIndexes() {
    indexes = {
      byTargetKey:    {},   // normTableKey(dst, target) → [idx]
      bySourceKey:    {},   // normTableKey(srcDS, srcTable) → [idx]
      byFileWritten:  {},   // normFileKey(fileLoaderFileName) → [idx]
      byFileRead:     {},   // normFileKey(srcTable when srcDS≈FILE) → [idx]
      searchTokens:   [],   // [{idx, tokens: string}]
      // ── Dimensiones de exploración — mappings ──
      byDstTable:     {},   // normTableKey(dstDS, dstTable) → [{intIdx, mIdx}]
      bySrcTable:     {},   // normTableKey(srcDS, srcTable) → [{intIdx, mIdx}]
      byDstField:     {},   // FIELDNAME → [{intIdx, mIdx}]
      bySrcField:     {},   // FIELDNAME → [{intIdx, mIdx}]
      // ── Dimensiones de exploración — filtros/joins ──
      byFilterTable:  {},   // normTableKey('', table) → [{intIdx, fIdx}]
      byFilterField:  {},   // FIELDNAME → [{intIdx, fIdx}]
    };

    function push(map, key, idx) {
      if (!key) return;
      if (!map[key]) map[key] = [];
      if (!map[key].includes(idx)) map[key].push(idx);
    }
    function pushDim(map, key, intIdx, mIdx) {
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push({ intIdx, mIdx });
    }
    function pushDimF(map, key, intIdx, fIdx) {
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push({ intIdx, fIdx });
    }

    integrations.forEach(p => {
      // target
      push(indexes.byTargetKey, normTableKey(p.dstDSName, p.targetTable), p._idx);
      // file written
      if (p.fileLoaderFileName) push(indexes.byFileWritten, normFileKey(p.fileLoaderFileName), p._idx);
      // FILE datastore target
      if (/(FILE|ARCHIVOS)/i.test(p.dstDSName || '')) push(indexes.byFileWritten, normFileKey(p.targetTable), p._idx);

      // sources from mappings + dimension indexes
      p.mappings.forEach((m, mIdx) => {
        push(indexes.bySourceKey, normTableKey(m.srcDS, m.srcTable), p._idx);
        if (/(FILE|ARCHIVOS)/i.test(m.srcDS || '')) push(indexes.byFileRead, normFileKey(m.srcTable), p._idx);

        // Tabla Destino
        const dstKey = normTableKey(m.dstDS || p.dstDSName, m.dstTable || p.targetTable);
        if (dstKey) pushDim(indexes.byDstTable, dstKey, p._idx, mIdx);

        // Tabla Origen — puede ser multi-tabla separada por comas
        if (m.srcTable) {
          m.srcTable.split(/,\s*/).forEach(rawTbl => {
            const t = rawTbl.trim();
            if (t) pushDim(indexes.bySrcTable, normTableKey(m.srcDS, t), p._idx, mIdx);
          });
        }

        // Campo Destino
        if (m.dstField) pushDim(indexes.byDstField, m.dstField.toUpperCase(), p._idx, mIdx);

        // Campo Origen — puede ser "TABLE.FIELD, TABLE.FIELD2" o solo "FIELD"
        if (m.srcField) {
          m.srcField.split(/,\s*/).forEach(rawFld => {
            const f = rawFld.trim().replace(/^[^.]+\./, ''); // strip TABLE. prefix
            if (f) pushDim(indexes.bySrcField, f.toUpperCase(), p._idx, mIdx);
          });
        }
      });

      // ── Filtros y joins ───────────────────────────────────
      p.filters.forEach((f, fIdx) => {
        // Tabla origen — extraida por parseDataflow; puede ser multi-tabla
        if (f.sourceTable) {
          f.sourceTable.split(/,\s*/).forEach(rawTbl => {
            const t = rawTbl.trim();
            if (t) pushDimF(indexes.byFilterTable, normTableKey('', t), p._idx, fIdx);
          });
        }
        // Campos individuales extraidos de la expresion
        extractFilterFields(f.expression || '').forEach(field => {
          pushDimF(indexes.byFilterField, field, p._idx, fIdx);
        });
      });

      // search tokens (incluye tablas referenciadas en lookup expressions)
      const lookupTables = extractLookupPairs(p.lookups).map(pair => pair.file || pair.ds);
      const tokens = [
        p.jobName, p.dataflowName, p.srcDSName, p.dstDSName, p.targetTable,
        ...p.mappings.flatMap(m => [m.dstField, m.dstDesc, m.srcField, m.srcTable, m.ops]),
        ...p.filters.map(f => f.expression),
        ...p.variables.map(v => v.name),
        ...lookupTables,
        ...p.lookups.map(l => l.func),
      ].filter(Boolean).join(' ').toLowerCase();
      indexes.searchTokens.push({ idx: p._idx, tokens });
    });
  }

  // ── Detección de cadenas ─────────────────────────────────
  // Tres mecanismos de unión:
  //   table  – DS+tabla (L1) o solo tabla (L2) vía TableReader/FileReader
  //   file   – por nombre de archivo (fileLoaderFileName o targetTable en FILE DS)
  //   lookup – la integración B usa lookup(A.targetTable.FIELD, …) en sus expresiones

  // Extrae todos los nombres de tabla referenciados en expresiones lookup(TABLE.field, ...)
  // Returns [{ds, file}] from lookup(DATASTORE."file.csv", ...) expressions
  function extractLookupPairs(lookups) {
    const pairs = [];
    lookups.forEach(l => {
      const re = /lookup\s*\(\s*([A-Za-z_][A-Za-z0-9_\/]*)\s*\.\s*(?:"([^"]+)"|([A-Za-z0-9_][A-Za-z0-9_.\/-]*))/gi;
      let m;
      while ((m = re.exec(l.func)) !== null) {
        const ds   = (m[1] || '').toUpperCase();
        const file = (m[2] || m[3] || '').replace(/^.*[\\/]/, '').toUpperCase();
        if (ds) pairs.push({ ds, file });
      }
    });
    return pairs;
  }

  function detectChains() {
    chainEdges = [];
    const seen = new Set();

    integrations.forEach(a => {
      const targetKey     = normTableKey(a.dstDSName, a.targetTable);
      const targetKeyNoDS = normTableKey('', a.targetTable);
      const aTblNorm      = (a.targetTable || '').replace(/^.*[\\/]/, '').toUpperCase();
      const aFileNorm     = a.fileLoaderFileName
        ? a.fileLoaderFileName.replace(/^.*[\\/]/, '').toUpperCase()
        : '';
      const aIsFile       = a.tipoIntegracion === 'FILE';

      integrations.forEach(b => {
        if (b._idx === a._idx) return;

        const alreadyLinked = seen.has(`${a._idx}→${b._idx}:table`) ||
                              seen.has(`${a._idx}→${b._idx}:file`)  ||
                              seen.has(`${a._idx}→${b._idx}:lookup`);

        // ── Match por tabla (solo integraciones no-FILE) ─────────────────────
        // L2 requiere que ninguno de los dos lados sea tipo archivo para evitar
        // falsos positivos por nombres de formato coincidentes.
        if (!alreadyLinked) {
          const matchTable = b.mappings.some(m => {
            if (!m.srcTable) return false;
            if (normTableKey(m.srcDS, m.srcTable) === targetKey) return true;  // L1 exacto
            if (aIsFile) return false;  // A escribe archivo: sin L2
            const bDSNorm = (m.srcDS || '').toUpperCase();
            if (bDSNorm === 'FILE' || /(FILE|ARCHIVOS)/i.test(bDSNorm)) return false;  // B lee archivo: sin L2
            const srcNoDS = normTableKey('', m.srcTable);
            return srcNoDS === targetKeyNoDS && srcNoDS.replace('::', '').length >= 4;  // L2 solo DB
          });
          if (matchTable) {
            const k = `${a._idx}→${b._idx}:table`;
            seen.add(k);
            chainEdges.push({ from: a._idx, to: b._idx, via: 'table', label: a.targetTable });
          }
        }

        // ── Match por archivo (FileLoader → FileReader) ─────────────────────
        // Usa el nombre del formato (targetTable) como clave primaria.
        // Requiere tabla destino == tabla origen Y nombre de archivo == nombre de archivo.
        // Si el fileLoaderFileName está disponible, ambos deben coincidir con lo que lee B.
        if (aIsFile && aTblNorm.length >= 4 &&
            !seen.has(`${a._idx}→${b._idx}:table`) &&
            !seen.has(`${a._idx}→${b._idx}:file`)) {
          const matchFile = b.mappings.some(m => {
            if (!m.srcTable) return false;
            // El nombre de formato debe coincidir en ambos lados
            const bFmt = m.srcTable.replace(/^.*[\\/]/, '').toUpperCase();
            if (bFmt !== aTblNorm) return false;
            // El lado lector debe ser de tipo archivo
            const bDS = (m.srcDS || '').toUpperCase();
            if (bDS && bDS !== 'FILE' && !/(FILE|ARCHIVOS)/i.test(bDS)) return false;
            // Si A tiene nombre de archivo explícito, verificar que el formato y
            // el archivo base coincidan (el lector expone el nombre de formato, no el archivo físico)
            if (aFileNorm.length >= 4) {
              const aBase = aFileNorm.replace(/\.[^.]+$/, '');  // sin extensión
              return aBase === bFmt || bFmt === aTblNorm;
            }
            return true;
          });
          if (matchFile) {
            const k = `${a._idx}→${b._idx}:file`;
            seen.add(k);
            chainEdges.push({ from: a._idx, to: b._idx, via: 'file', label: a.targetTable });
          }
        }

        // ── Match vía lookup(DS."archivo.csv", ...) ──────────────────────────
        // Requiere: nombre de formato (DS) coincide con targetTable de A.
        // Si A tiene fileLoaderFileName y el lookup provee nombre de archivo, ambos deben coincidir.
        if (!seen.has(`${a._idx}→${b._idx}:table`) &&
            !seen.has(`${a._idx}→${b._idx}:file`)  &&
            !seen.has(`${a._idx}→${b._idx}:lookup`) &&
            b.lookups.length > 0 && aTblNorm.length >= 4) {

          const bPairs = extractLookupPairs(b.lookups);
          const lookupMatch = bPairs.find(p => {
            if (p.ds !== aTblNorm) return false;
            // Si A tiene nombre de archivo Y el lookup también lo provee, deben coincidir
            if (aFileNorm.length >= 4 && p.file.length >= 4) {
              const aBase = aFileNorm.replace(/\.[^.]+$/, '');
              const pBase = p.file.replace(/\.[^.]+$/, '');
              return aBase === pBase;
            }
            return true;  // solo nombre de formato disponible: suficiente
          });

          if (lookupMatch) {
            const label = lookupMatch.file || aTblNorm;
            const k = `${a._idx}→${b._idx}:lookup`;
            seen.add(k);
            chainEdges.push({ from: a._idx, to: b._idx, via: 'lookup', label });
          }
        }
      });
    });

    const byVia = chainEdges.reduce((acc, e) => { acc[e.via] = (acc[e.via] || 0) + 1; return acc; }, {});
    console.debug(`[Explorer] cadenas: ${chainEdges.length} total`, byVia);
  }

  // ── Sidebar (lista master) ───────────────────────────────
  function renderSidebarList(list) {
    const el = document.getElementById('ex-master');
    if (!el) return;
    if (!list || list.length === 0) {
      el.innerHTML = '<p style="padding:12px;color:var(--text2);font-size:13px;">No se encontraron integraciones</p>';
      return;
    }
    el.innerHTML = list.map(p => {
      const typeClass = `ex-type-${p.tipoIntegracion || 'MD'}`;
      const inEdges  = chainEdges.filter(e => e.to   === p._idx);
      const outEdges = chainEdges.filter(e => e.from === p._idx);
      // Iconos de cadena: ⬅ para entradas, ➡ para salidas; color por tipo
      const viaColors = { table: '#34d399', file: '#E8622A', lookup: '#a78bfa' };
      const chainBadges = [
        ...inEdges.map(e  => `<span style="color:${viaColors[e.via]||'#aaa'};font-size:10px;" title="Alimentado por (${e.via})">⬅</span>`),
        ...outEdges.map(e => `<span style="color:${viaColors[e.via]||'#aaa'};font-size:10px;" title="Alimenta a (${e.via})">➡</span>`),
      ].join('');
      return `<div class="ex-item${selectedIdx === p._idx ? ' active' : ''}" data-idx="${p._idx}" onclick="Explorer.renderDetail(${p._idx})">
        <div class="ex-name">
          <span class="ex-type-badge ${typeClass}">${escH(p.tipoIntegracion || 'MD')}</span>${escH(p.jobName)}${chainBadges ? `<span style="margin-left:4px;">${chainBadges}</span>` : ''}
        </div>
        ${p.dataflowName && p.dataflowName !== p.jobName ? `<div class="ex-sub ex-sub-df">↳ ${escH(p.dataflowName)}</div>` : ''}
        <div class="ex-sub">${escH(p._zipName)} · ${escH(p.targetTable)}</div>
      </div>`;
    }).join('');
  }

  // ── Detalle del panel derecho ────────────────────────────
  function renderDetail(idx) {
    selectedIdx = idx;
    // actualizar estado activo en master
    document.querySelectorAll('#ex-master .ex-item').forEach(el => {
      el.classList.toggle('active', +el.dataset.idx === idx);
    });

    const p   = integrations[idx];
    const det = document.getElementById('ex-detail');
    if (!p || !det) return;

    // cadenas
    const incoming = chainEdges.filter(e => e.to === idx);
    const outgoing = chainEdges.filter(e => e.from === idx);

    function chainPill(e, neighborIdx, dir) {
      const nb    = integrations[neighborIdx];
      const name  = nb ? (nb.dataflowName || nb.jobName) : String(neighborIdx);
      const viaCls = { table: '', file: ' via-file', lookup: ' via-lookup' }[e.via] || '';
      const viaIcon = { table: '⬌', file: '📄', lookup: '🔍' }[e.via] || '→';
      return `<span class="ex-chain-pill${viaCls}" onclick="Explorer.renderDetail(${neighborIdx})" title="${dir} (${escH(e.via)}): ${escH(e.label)}">${viaIcon} ${escH(name)}</span>`;
    }

    const chainsHtml = (incoming.length || outgoing.length) ? `
      <div class="ex-chain-section">
        ${incoming.length ? `
          <div class="ex-chain-label">⬅ Alimentado por</div>
          <div>${incoming.map(e => chainPill(e, e.from, 'Alimentado por')).join('')}</div>` : ''}
        ${outgoing.length ? `
          <div class="ex-chain-label" style="margin-top:${incoming.length ? 8 : 0}px">➡ Alimenta a</div>
          <div>${outgoing.map(e => chainPill(e, e.to, 'Alimenta a')).join('')}</div>` : ''}
      </div>` : '';

    // header card
    const headerHtml = `
      <div class="ex-header-card">
        <div class="ex-h-title">
          <span class="ex-type-badge ex-type-${p.tipoIntegracion || 'MD'}">${escH(p.tipoIntegracion || 'MD')}</span>
          ${escH(p.jobName)}
        </div>
        ${p.dataflowName && p.dataflowName !== p.jobName ? `<div class="ex-h-sub">↳ Dataflow: ${escH(p.dataflowName)}</div>` : ''}
        <div class="ex-h-flow">${escH(p.srcDSName || '—')} → ${escH(p.dstDSName || '—')}</div>
        <div class="ex-h-sub">Target: <b>${escH(p.targetTable)}</b>${p.fileLoaderFileName ? ` · Archivo: <b>${escH(p.fileLoaderFileName)}</b>` : ''}</div>
        <div class="ex-h-sub" style="margin-top:2px;">ZIP: ${escH(p._zipName)}</div>
      </div>`;

    // mappings
    const mappingsHtml = buildSection('🗂️ Mappings', p.mappings.length,
      p.mappings.length === 0 ? '<p style="color:var(--text2);font-size:12px;">Sin mappings</p>' :
      `<div style="overflow-x:auto">
        <table class="ex-mapping-table">
          <thead><tr>
            <th style="min-width:130px">Campo Destino</th>
            <th style="min-width:130px">Origen</th>
            <th style="min-width:180px">Transformación</th>
          </tr></thead>
          <tbody>${p.mappings.map(m => {
            const hasLookup = m.ops && /\blookup\s*\(/i.test(m.ops);
            const hasOps    = m.ops && m.ops.trim().length > 0;
            const srcParts  = [m.srcDS, m.srcTable, m.srcField].filter(Boolean);
            return `<tr>
              <td>
                <div class="ex-dst-field">${escH(m.dstField)}</div>
                ${m.dstDesc ? `<div class="ex-dst-desc">${escH(m.dstDesc)}</div>` : ''}
              </td>
              <td class="ex-src-info">${escH(srcParts.join(' · ') || '—')}</td>
              <td>${hasOps ? `<code class="ex-ops-code">${escH(m.ops)}</code>` : '<span style="color:var(--text2)">—</span>'}
                ${hasLookup ? `<div><span class="ex-lookup-badge">lookup</span></div>` : ''}
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`
    );

    // filtros
    const filtersHtml = buildSection('🔍 Filtros', p.filters.length,
      p.filters.length === 0 ? '<p style="color:var(--text2);font-size:12px;">Sin filtros</p>' :
      p.filters.map(f => `
        <div class="ex-filter-row">
          ${f.sourceTable ? `<div class="ex-filter-table">Tabla: ${escH(f.sourceTable)}</div>` : ''}
          <pre class="ex-filter-expr">${escH(f.expression)}</pre>
        </div>`).join('')
    );

    // lookups
    const lookupsHtml = p.lookups.length ? buildSection('🔗 Lookups', p.lookups.length,
      p.lookups.map(l => `
        <div class="ex-lookup-item">
          ${l.transform ? `<div class="ex-lookup-tf">Transform: ${escH(l.transform)}</div>` : ''}
          <pre class="ex-lookup-fn">${escH(l.func)}</pre>
        </div>`).join('')
    ) : '';

    // variables
    const varsHtml = p.variables && p.variables.length ? buildSection('⚙️ Variables', p.variables.length,
      p.variables.map(v => `
        <div class="ex-var-row">
          <span class="ex-var-name">${escH(v.name)}</span>
          <span class="ex-var-val">${escH(v.value || '(vacío)')}</span>
        </div>`).join('')
    ) : '';

    det.innerHTML = headerHtml + chainsHtml + mappingsHtml + filtersHtml + lookupsHtml + varsHtml;

    // scroll master al item activo
    const activeItem = document.querySelector('#ex-master .ex-item.active');
    if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
  }

  function buildSection(title, count, body, collapsed = false) {
    const id = 'ex-sec-' + Math.random().toString(36).slice(2);
    return `
      <div class="ex-detail-section">
        <div class="ex-section-header" onclick="
          var b=document.getElementById('${id}');
          b.classList.toggle('collapsed');
          this.querySelector('.ex-arr').textContent = b.classList.contains('collapsed') ? '▶' : '▼';
        ">
          <span>${escH(title)} <span style="color:var(--text2);font-weight:400">(${count})</span></span>
          <span class="ex-arr">${collapsed ? '▶' : '▼'}</span>
        </div>
        <div class="ex-section-body${collapsed ? ' collapsed' : ''}" id="${id}">${body}</div>
      </div>`;
  }

  // ── Búsqueda global ──────────────────────────────────────
  function applySearch(q) {
    if (currentDim !== 'integration') {
      renderMasterForDim(currentDim, q);
      return;
    }
    applySearchIntegration(q);
  }

  function applySearchIntegration(q) {
    const query = (q || '').trim().toLowerCase();
    if (!query) {
      filtered = integrations.slice();
    } else {
      const terms = query.split(/\s+/).filter(Boolean);
      filtered = integrations.filter(p => {
        const entry = indexes.searchTokens.find(s => s.idx === p._idx);
        if (!entry) return false;
        return terms.every(t => entry.tokens.includes(t));
      });
    }
    renderSidebarList(filtered);
    updateCounter(filtered.length, integrations.length);
    if (selectedIdx !== null && !filtered.find(p => p._idx === selectedIdx)) {
      document.getElementById('ex-detail').innerHTML = '<p class="docs-hint">Selecciona una integración a la izquierda</p>';
      selectedIdx = null;
    }
  }

  function updateCounter(visible, total) {
    const el = document.getElementById('ex-counter');
    if (!el || visible === null) return;
    if (currentDim !== 'integration') {
      const labels = {
        'dst-table':    'tablas destino',
        'src-table':    'tablas origen',
        'dst-field':    'campos destino',
        'src-field':    'campos origen',
        'filter-table': 'tablas filtro/join',
        'filter-field': 'campos filtro/join',
      };
      const lbl = labels[currentDim] || '';
      el.textContent = visible === total ? `${total} ${lbl}` : `${visible} / ${total} ${lbl}`;
    } else {
      el.textContent = visible === total ? `${total} integración${total !== 1 ? 'es' : ''}` : `${visible} / ${total}`;
    }
  }

  // ── Dimensiones ──────────────────────────────────────────
  const DIM_MAP_KEY = {
    'dst-table':    'byDstTable',
    'src-table':    'bySrcTable',
    'dst-field':    'byDstField',
    'src-field':    'bySrcField',
    'filter-table': 'byFilterTable',
    'filter-field': 'byFilterField',
  };
  const DIM_LABELS = {
    'dst-table':    'Tabla Destino',
    'src-table':    'Tabla Origen',
    'dst-field':    'Campo Destino',
    'src-field':    'Campo Origen',
    'filter-table': 'Tabla Filtro/Join',
    'filter-field': 'Campo Filtro/Join',
  };
  const ALL_DIMS = ['integration','dst-table','src-table','dst-field','src-field','filter-table','filter-field'];

  function switchDimension(dim) {
    currentDim     = dim;
    selectedDimKey = null;

    ALL_DIMS.forEach(d => {
      const btn = document.getElementById('ex-dim-' + d);
      if (btn) btn.classList.toggle('active', d === dim);
    });

    // grafo solo aplica en vista integracion
    const vt = document.getElementById('ex-view-toggle');
    if (vt) vt.style.display = dim === 'integration' ? '' : 'none';
    if (currentView === 'graph' && dim !== 'integration') switchView('list');

    const det = document.getElementById('ex-detail');
    if (det) det.innerHTML = '<p class="docs-hint">Selecciona un elemento a la izquierda</p>';

    const q = (document.getElementById('ex-search') || {}).value || '';
    renderMasterForDim(dim, q);
  }

  function renderMasterForDim(dim, query) {
    if (dim === 'integration') { applySearchIntegration(query); return; }
    const mapKey = DIM_MAP_KEY[dim];
    if (!mapKey) return;
    renderMasterDimItems(indexes[mapKey], dim, query);
  }

  // Para dimensiones de filtro, el contador muestra filtros (fIdx) en lugar de mapeos (mIdx)
  function isMappingDim(dim) {
    return dim === 'dst-table' || dim === 'src-table' || dim === 'dst-field' || dim === 'src-field';
  }
  function isFilterDim(dim) {
    return dim === 'filter-table' || dim === 'filter-field';
  }

  function renderMasterDimItems(dimMap, dim, filterQuery) {
    const el = document.getElementById('ex-master');
    if (!el) return;
    const isField  = dim === 'dst-field'    || dim === 'src-field'    || dim === 'filter-field';
    const isFilter = dim === 'filter-table' || dim === 'filter-field';

    let entries = Object.entries(dimMap || {});
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      entries = entries.filter(([key]) => key.toLowerCase().includes(q));
    }
    entries.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

    updateCounter(entries.length, Object.keys(dimMap || {}).length);

    if (!entries.length) {
      el.innerHTML = '<p style="padding:12px;color:var(--text2);font-size:13px;">Sin resultados</p>';
      return;
    }

    el.innerHTML = entries.map(([key, items]) => {
      const isActive = selectedDimKey === key;
      let label, sublabel;
      const intCount = new Set(items.map(x => x.intIdx)).size;
      if (isField) {
        label    = key;
        const unit = isFilter ? 'filtro' : 'uso';
        sublabel = `${items.length} ${unit}${items.length !== 1 ? 's' : ''} · ${intCount} integracion${intCount !== 1 ? 'es' : ''}`;
      } else {
        const parts = key.split('::');
        label = parts[1] || key;
        if (isFilter) {
          sublabel = `${intCount} integracion${intCount !== 1 ? 'es' : ''} · ${items.length} filtro${items.length !== 1 ? 's' : ''}`;
        } else {
          sublabel = (parts[0] ? parts[0] + ' · ' : '') + `${intCount} integracion${intCount !== 1 ? 'es' : ''} · ${items.length} mapeo${items.length !== 1 ? 's' : ''}`;
        }
      }
      return `<div class="ex-item${isActive ? ' active' : ''}" data-key="${escH(encodeURIComponent(key))}" onclick="Explorer.handleDimItemClick(this)">
        <div class="ex-name">${escH(label)}</div>
        <div class="ex-sub">${escH(sublabel)}</div>
      </div>`;
    }).join('');
  }

  function handleDimItemClick(el) {
    const key = decodeURIComponent(el.getAttribute('data-key') || '');
    renderDetailDimByKey(key, currentDim);
  }

  function renderDetailDimByKey(key, dim) {
    selectedDimKey = key;
    document.querySelectorAll('#ex-master .ex-item').forEach(el => {
      el.classList.toggle('active', decodeURIComponent(el.getAttribute('data-key') || '') === key);
    });

    const det = document.getElementById('ex-detail');
    if (!det) return;

    const mapKey = DIM_MAP_KEY[dim];
    const items  = mapKey && indexes[mapKey] ? (indexes[mapKey][key] || []) : [];
    if (!items.length) { det.innerHTML = '<p class="docs-hint">Sin datos para esta clave</p>'; return; }

    const isField  = dim === 'dst-field'    || dim === 'src-field'    || dim === 'filter-field';
    const isDst    = dim === 'dst-table'    || dim === 'dst-field';
    const isFilter = dim === 'filter-table' || dim === 'filter-field';
    const parts    = key.split('::');
    const displayName = isField ? key : (parts[1] || key);
    const displayDS   = isField ? '' : (parts[0] || '');
    const intCount    = new Set(items.map(x => x.intIdx)).size;
    const unitLabel   = isFilter ? 'filtro' : 'mapeo';

    let html = `
      <div class="ex-header-card">
        <div class="ex-h-title">${escH(displayName)}</div>
        ${displayDS ? `<div class="ex-h-flow">Datastore: ${escH(displayDS)}</div>` : ''}
        <div class="ex-h-sub">${escH(DIM_LABELS[dim] || dim)} · ${items.length} ${unitLabel}${items.length !== 1 ? 's' : ''} en ${intCount} integracion${intCount !== 1 ? 'es' : ''}</div>
      </div>`;

    if (isFilter) {
      // ── Vista para filtros/joins ──────────────────────────
      // Agrupar por integracion; items tiene {intIdx, fIdx}
      const byInt = new Map();
      items.forEach(({ intIdx, fIdx }) => {
        if (!byInt.has(intIdx)) byInt.set(intIdx, []);
        byInt.get(intIdx).push(fIdx);
      });

      byInt.forEach((fIdxList, intIdx) => {
        const p = integrations[intIdx];
        if (!p) return;
        // Eliminar duplicados de fIdx (una expresion puede matchear varios campos)
        const uniqueFIdx = [...new Set(fIdxList)];
        const secId = 'exsec-' + intIdx + '-' + Math.random().toString(36).slice(2, 6);
        html += `
          <div class="ex-detail-section">
            <div class="ex-section-header" onclick="var b=document.getElementById('${secId}');b.classList.toggle('collapsed');this.querySelector('.ex-arr').textContent=b.classList.contains('collapsed')?'▶':'▼';">
              <span>
                <span class="ex-type-badge ex-type-${p.tipoIntegracion || 'MD'}">${escH(p.tipoIntegracion || 'MD')}</span>
                ${escH(p.dataflowName || p.jobName)}
                <span style="color:var(--text2);font-weight:400;font-size:11px;margin-left:6px;">${escH(p._zipName)}</span>
              </span>
              <span style="display:flex;gap:6px;align-items:center">
                <span style="color:var(--text2);font-size:11px;">${uniqueFIdx.length} filtro${uniqueFIdx.length !== 1 ? 's' : ''}</span>
                <span class="ex-chain-pill" onclick="event.stopPropagation();Explorer.goToIntegration(${intIdx})" title="Ver integracion completa">Ver</span>
                <span class="ex-arr">▼</span>
              </span>
            </div>
            <div class="ex-section-body" id="${secId}">
              ${uniqueFIdx.map(fIdx => {
                const f = p.filters[fIdx];
                if (!f) return '';
                return `<div class="ex-filter-row">
                  ${f.sourceTable ? `<div class="ex-filter-table">Tabla: ${escH(f.sourceTable)}</div>` : ''}
                  <pre class="ex-filter-expr">${escH(f.expression)}</pre>
                </div>`;
              }).join('')}
            </div>
          </div>`;
      });

    } else {
      // ── Vista para mappings (comportamiento original) ─────
      const byInt = new Map();
      items.forEach(({ intIdx, mIdx }) => {
        if (!byInt.has(intIdx)) byInt.set(intIdx, []);
        byInt.get(intIdx).push(mIdx);
      });

      byInt.forEach((mIdxList, intIdx) => {
        const p = integrations[intIdx];
        if (!p) return;
        const secId = 'exsec-' + intIdx + '-' + Math.random().toString(36).slice(2, 6);
        html += `
          <div class="ex-detail-section">
            <div class="ex-section-header" onclick="var b=document.getElementById('${secId}');b.classList.toggle('collapsed');this.querySelector('.ex-arr').textContent=b.classList.contains('collapsed')?'▶':'▼';">
              <span>
                <span class="ex-type-badge ex-type-${p.tipoIntegracion || 'MD'}">${escH(p.tipoIntegracion || 'MD')}</span>
                ${escH(p.dataflowName || p.jobName)}
                <span style="color:var(--text2);font-weight:400;font-size:11px;margin-left:6px;">${escH(p._zipName)}</span>
              </span>
              <span style="display:flex;gap:6px;align-items:center">
                <span style="color:var(--text2);font-size:11px;">${mIdxList.length} campo${mIdxList.length !== 1 ? 's' : ''}</span>
                <span class="ex-chain-pill" onclick="event.stopPropagation();Explorer.goToIntegration(${intIdx})" title="Ver integracion completa">Ver</span>
                <span class="ex-arr">▼</span>
              </span>
            </div>
            <div class="ex-section-body" id="${secId}">
              <div style="overflow-x:auto">
                <table class="ex-mapping-table">
                  <thead><tr>
                    ${isDst
                      ? '<th style="min-width:120px">Campo Destino</th><th style="min-width:130px">Origen</th><th>Transformacion</th>'
                      : '<th style="min-width:130px">Campo Origen</th><th style="min-width:120px">Campo Destino</th><th>Transformacion</th>'}
                  </tr></thead>
                  <tbody>${mIdxList.map(mIdx => {
                    const m = p.mappings[mIdx];
                    if (!m) return '';
                    const srcParts = [m.srcDS, m.srcTable, m.srcField].filter(Boolean);
                    const hasOps = m.ops && m.ops.trim().length > 0;
                    if (isDst) {
                      return `<tr>
                        <td><div class="ex-dst-field">${escH(m.dstField)}</div>${m.dstDesc ? `<div class="ex-dst-desc">${escH(m.dstDesc)}</div>` : ''}</td>
                        <td class="ex-src-info">${escH(srcParts.join(' · ') || '—')}</td>
                        <td>${hasOps ? `<code class="ex-ops-code">${escH(m.ops)}</code>` : '<span style="color:var(--text2)">—</span>'}</td>
                      </tr>`;
                    } else {
                      return `<tr>
                        <td class="ex-src-info">${escH(srcParts.join(' · ') || '—')}</td>
                        <td><div class="ex-dst-field">${escH(m.dstField)}</div>${m.dstTable ? `<div class="ex-dst-desc">${escH(m.dstTable)}</div>` : ''}</td>
                        <td>${hasOps ? `<code class="ex-ops-code">${escH(m.ops)}</code>` : '<span style="color:var(--text2)">—</span>'}</td>
                      </tr>`;
                    }
                  }).join('')}</tbody>
                </table>
              </div>
            </div>
          </div>`;
      });
    }

    det.innerHTML = html;
  }

  function goToIntegration(idx) {
    const searchEl = document.getElementById('ex-search');
    if (searchEl) searchEl.value = '';
    filtered = integrations.slice();
    currentDim = 'integration';
    selectedDimKey = null;
    ALL_DIMS.forEach(d => {
      const btn = document.getElementById('ex-dim-' + d);
      if (btn) btn.classList.toggle('active', d === 'integration');
    });
    const vt = document.getElementById('ex-view-toggle');
    if (vt) vt.style.display = '';
    renderSidebarList(filtered);
    updateCounter(filtered.length, integrations.length);
    renderDetail(idx);
  }

  // ── Vista grafo ──────────────────────────────────────────
  function switchView(v) {
    currentView = v;
    const listView  = document.getElementById('ex-list-view');
    const graphView = document.getElementById('ex-graph-view');
    const btnList   = document.getElementById('ex-view-list');
    const btnGraph  = document.getElementById('ex-view-graph');
    if (!listView || !graphView) return;

    listView.style.display  = v === 'list'  ? '' : 'none';
    const graphWrap = document.getElementById('ex-graph-wrap');
    if (graphWrap) graphWrap.style.display = v === 'graph' ? '' : 'none';
    if (btnList)  btnList.classList.toggle('active',  v === 'list');
    if (btnGraph) btnGraph.classList.toggle('active', v === 'graph');

    if (v === 'graph') renderGraph();
  }

  // vis-network 10.x renderiza title como texto plano cuando es string;
  // hay que pasar un elemento DOM para HTML en tooltips.
  function makeTooltip(lines) {
    const d = document.createElement('div');
    d.style.cssText = 'padding:6px 10px;font-size:12px;line-height:1.7;background:#0f1829;color:#dce6f5;border:1px solid #243350;border-radius:6px;max-width:280px;';
    d.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
    return d;
  }

  function renderGraph() {
    const container = document.getElementById('ex-graph-view');
    if (!container || typeof vis === 'undefined') return;

    if (visNetwork) { visNetwork.destroy(); visNetwork = null; }

    const typeColors = { MD: '#F7A800', KF: '#29ABE2', FILE: '#E8622A' };

    const nodes = new vis.DataSet(integrations.map(p => {
      const rawLabel = p.dataflowName || p.jobName || '';
      // Partir en dos líneas si es largo (vis-network respeta \n en label)
      const label = rawLabel.length > 30
        ? rawLabel.slice(0, 30).replace(/[_\s](?=[^_\s]*$)/, '\n') || rawLabel.slice(0, 15) + '\n' + rawLabel.slice(15, 30) + '…'
        : rawLabel;
      const col = typeColors[p.tipoIntegracion] || '#7d9abf';
      return {
        id:    p._idx,
        label,
        title: makeTooltip([
          `<b>${escH(p.dataflowName || p.jobName)}</b>`,
          p.dataflowName && p.jobName !== p.dataflowName ? `Job: ${escH(p.jobName)}` : '',
          `${escH(p.srcDSName || '?')} → ${escH(p.dstDSName || '?')}`,
          `Target: <b>${escH(p.targetTable)}</b>`,
          `ZIP: ${escH(p._zipName)}`,
        ].filter(Boolean)),
        color: { background: col, border: col, highlight: { background: '#fff', border: col } },
        font:  { color: '#000', size: 12, multi: false },
        shape: 'box',
        margin: 8
      };
    }));

    const edgeStyle = {
      table:  { color: '#34d399', dashes: false,      width: 2   },
      file:   { color: '#E8622A', dashes: [6, 4],     width: 1.5 },
      lookup: { color: '#a78bfa', dashes: [2, 3, 8, 3], width: 1.5 },
    };

    const edges = new vis.DataSet(chainEdges.map((e, i) => {
      const st = edgeStyle[e.via] || edgeStyle.table;
      return {
        id:     i,
        from:   e.from,
        to:     e.to,
        label:  e.label && e.label.length > 24 ? e.label.slice(0, 22) + '…' : (e.label || ''),
        title:  makeTooltip([`Tipo: <b>${escH(e.via)}</b>`, `Vía: ${escH(e.label)}`]),
        arrows: 'to',
        dashes: st.dashes,
        color:  { color: st.color, highlight: '#fff' },
        font:   { size: 10, color: '#9db4d0', align: 'middle' },
        width:  st.width
      };
    }));

    const options = {
      layout: chainEdges.length > 0
        ? { hierarchical: { direction: 'LR', sortMethod: 'directed', levelSeparation: 260, nodeSpacing: 130 } }
        : { randomSeed: 42 },
      physics: false,
      interaction: { hover: true, tooltipDelay: 100 },
      nodes: { borderWidth: 1, borderWidthSelected: 2 },
      edges: { smooth: { type: 'curvedCW', roundness: 0.15 } }
    };

    visNetwork = new vis.Network(container, { nodes, edges }, options);

    visNetwork.on('click', params => {
      if (params.nodes.length) {
        switchView('list');
        renderDetail(params.nodes[0]);
      }
    });
  }

  // ── Init ─────────────────────────────────────────────────
  function init() {
    initDropZone();
  }

  // ── API pública ──────────────────────────────────────────
  return {
    analyze,
    removeFile,
    renderDetail,
    applySearch,
    switchView,
    switchDimension,
    handleDimItemClick,
    goToIntegration,
    init
  };

})();

window.Explorer = Explorer;
document.addEventListener('DOMContentLoaded', () => Explorer.init());
