    /* ═══════════════════════════════════════════════════════════════
       LOAD BOM SUBTREE FROM IDB (async BFS)
       Populates the small in-memory BOM indexes for ONE selected product.
       Traverses the full tree: co-products and multi-level components.
       ═══════════════════════════════════════════════════════════════ */
    async function loadBomSubtree(prdid) {
      // Reset BOM indexes — will hold only this product's subtree
      HDR_BY_PRD = {}; HDR_BY_SID = {}; ITM_BY_SID = {};
      RES_BY_SID = {}; CPR_BY_SID = {}; PSISUB_BY_SID = {};
      isCompAtLoc = {}; prdIndex = {}; LOC_BY_ID = {};

      var visitedPrds = {}; visitedPrds[prdid] = true;
      var visitedSids = {};
      var queue = [prdid];

      while (queue.length > 0) {
        var nextQueue = [];

        for (var i = 0; i < queue.length; i++) {
          var pid = queue[i];

          // 1. Get all PSH rows where PRDID = pid
          var hdrsForPrd = await idbGetByIndex('bom_psh', 'by_prdid', pid);

          for (var j = 0; j < hdrsForPrd.length; j++) {
            var sid = str(hdrsForPrd[j].SOURCEID);
            if (!sid || visitedSids[sid]) continue;
            visitedSids[sid] = true;

            // 2. Get ALL PSH rows for this SOURCEID (finds co-products of the same source)
            var allHdrs = await idbGetByIndex('bom_psh', 'by_sourceid', sid);
            allHdrs.forEach(function (h) {
              var spid = str(h.PRDID);
              var st = str(h.SOURCETYPE || 'P');
              // HDR_BY_SID: prefer P-type row
              if (!HDR_BY_SID[sid] || st !== 'C') HDR_BY_SID[sid] = h;
              // CPR_BY_SID: C-type co-products
              if (st === 'C') {
                if (!CPR_BY_SID[sid]) CPR_BY_SID[sid] = [];
                CPR_BY_SID[sid].push({
                  prdid: spid, coefficient: h.OUTPUTCOEFFICIENT || '',
                  prddescr: '', mattypeid: '', uomid: '', sourcetype: st
                });
              }
              // HDR_BY_PRD: all types needed for traversal
              if (!HDR_BY_PRD[spid]) HDR_BY_PRD[spid] = [];
              HDR_BY_PRD[spid].push(h);
              // Queue new products for traversal (co-products and the main product at each level)
              if (!visitedPrds[spid]) { visitedPrds[spid] = true; nextQueue.push(spid); }
            });

            // 3. Get PSI rows for this SOURCEID (component items)
            var items = await idbGetByIndex('bom_psi', 'by_sourceid', sid);
            items.forEach(function (item) {
              var isid = str(item.SOURCEID);
              var compPrd = str(item.PRDID);
              if (!ITM_BY_SID[isid]) ITM_BY_SID[isid] = [];
              ITM_BY_SID[isid].push(item);
              // isCompAtLoc: HDR_BY_SID[sid] was just built above
              var parentHdr = HDR_BY_SID[isid];
              if (compPrd && parentHdr) {
                isCompAtLoc[str(parentHdr.LOCID) + '|' + compPrd] = true;
              }
              // Queue component products
              if (compPrd && !visitedPrds[compPrd]) { visitedPrds[compPrd] = true; nextQueue.push(compPrd); }
            });

            // 4. Get PSR rows for this SOURCEID (resources)
            var resources = await idbGetByIndex('bom_psr', 'by_sourceid', sid);
            resources.forEach(function (r) {
              var rsid = str(r.SOURCEID), rid = str(r.RESID);
              if (!RES_BY_SID[rsid]) RES_BY_SID[rsid] = [];
              if (RES_BY_SID[rsid].indexOf(rid) < 0) RES_BY_SID[rsid].push(rid);
            });

            // 5. Get PSI Sub rows for this SOURCEID (item substitutions)
            var subs = await idbGetByIndex('bom_psisub', 'by_sourceid', sid);
            subs.forEach(function (sub) {
              var ssid = str(sub.SOURCEID);
              if (!PSISUB_BY_SID[ssid]) PSISUB_BY_SID[ssid] = [];
              PSISUB_BY_SID[ssid].push(sub);
            });
          }
        }

        queue = nextQueue;
      }

      // 5. Load product master for all visited products
      var allPids = Object.keys(visitedPrds);
      for (var k = 0; k < allPids.length; k++) {
        var p = await idbGet('bom_prd', allPids[k]);
        if (p) prdIndex[allPids[k]] = p;
      }

      // 6. Load Location master for all LOCIDs seen in PSH headers
      var seenLocs = {};
      Object.keys(HDR_BY_SID).forEach(function (sid) {
        var locid = str(HDR_BY_SID[sid].LOCID);
        if (locid) seenLocs[locid] = true;
      });
      var allLocids = Object.keys(seenLocs);
      for (var li = 0; li < allLocids.length; li++) {
        var locRec = await idbGet('bom_loc', allLocids[li]);
        if (locRec) LOC_BY_ID[allLocids[li]] = locRec;
      }
    }

    /* ═══════════════════════════════════════════════════════════════
       STEP 3: FINALIZE HIERARCHY
       Called after doFetchAll streaming completes.
       Indexes HDR_BY_PRD, HDR_BY_SID, ITM_BY_SID, RES_BY_SID,
       CPR_BY_SID, prdIndex and isCompAtLoc are already populated.
       This step only:
         1. Enriches co-product descriptions (requires prdIndex)
         2. Builds root trees (requires isCompAtLoc + all indexes)
       ═══════════════════════════════════════════════════════════════ */
    function finalizeHierarchy() {
      // Enrich co-product descriptions using the already-built prdIndex
      Object.keys(CPR_BY_SID).forEach(function (sid) {
        CPR_BY_SID[sid].forEach(function (cp) {
          var pInfo = prdIndex[cp.prdid] || {};
          cp.prddescr = str(pInfo.PRDDESCR);
          cp.mattypeid = str(pInfo.MATTYPEID);
          cp.uomid = str(pInfo.UOMDESCR || pInfo.UOMID || '');
        });
      });

      // Build root trees — per LOCID, skip products that are components at that LOCID.
      // Deduplicate by (locid|sourceid): a single source can appear in HDR_BY_PRD for
      // multiple PRDIDs (P-type + one or more C-types). We only build it once; the node
      // itself exposes the P-type as principal and the rest as co-products (Rule 5).
      // isCompAtLoc is already fully built from item streaming (doFetchAll).
      var cycles = [];
      var allLocids = {};
      var roots = {};
      var seenRootSrcs = {}; // (locid|sourceid) → true, prevents duplicate root nodes

      Object.keys(HDR_BY_PRD).sort().forEach(function (pid) {
        HDR_BY_PRD[pid].forEach(function (h) {
          var sid = str(h.SOURCEID), loc = str(h.LOCID);
          if (isCompAtLoc[loc + '|' + pid]) return;  // component at this plant — skip as root
          var srcKey = loc + '|' + sid;
          if (seenRootSrcs[srcKey]) return;           // already built this source as a root
          seenRootSrcs[srcKey] = true;
          var node = buildSourceNode(sid, 1, {}, pid);
          if (node) {
            node.type = 'MAIN';
            allLocids[loc] = true;
            if (!roots[loc]) roots[loc] = [];
            roots[loc].push(node);
          }
        });
      });

      var locids = Object.keys(allLocids).sort();
      var stats = {};
      locids.forEach(function (loc) {
        var ns = roots[loc] || [];
        var maxD = 0;
        ns.forEach(function (n) { var d = getDepth(n); if (d > maxD) maxD = d; });
        stats[loc] = { roots: ns.length, total: ns.length, max_depth: maxD };
      });

      TREE = { locids: locids, roots: roots, stats: stats, cycles: cycles };
    }

    /* Builds a tree node starting from a SOURCEID.
       visitedSids : set of SOURCEIDs already on the current path (cycle detection).
       displayPrdid: override which product to show at this node (C-type multi-output sources).
       rootLocid   : LOCID of the level-1 source; only follow sub-components at this same plant. */
    function buildSourceNode(sid, level, visitedSids, displayPrdid, rootLocid) {
      if (visitedSids[sid]) return null;   // cycle

      var h = HDR_BY_SID[sid];
      if (!h) return null;

      var newVis = {};
      for (var k in visitedSids) newVis[k] = true;
      newVis[sid] = true;

      // Cuando llegamos a este nodo siguiendo un componente PSI (displayPrdid provisto),
      // mostramos SIEMPRE el componente como producto primario — independientemente de si
      // la fuente tiene SOURCETYPE='P' o 'C'. Esto garantiza que la jerarquía BOM siempre
      // muestre el material que enlaza cada nivel (el componente del PSI padre).
      // Sin displayPrdid (raíz nivel 1): usamos el PRDID de la cabecera de la fuente.
      var pid = displayPrdid ? str(displayPrdid) : str(h.PRDID);
      var pidHdr = (HDR_BY_PRD[pid] || []).find(function (r) { return str(r.SOURCEID) === sid; });
      var hSourceType = str((pidHdr || h).SOURCETYPE || '');
      var pInfo = prdIndex[pid] || {};

      // Establish the plant to stay in throughout the whole hierarchy
      var nodeLocid = str(h.LOCID);
      var curRootLocid = rootLocid || nodeLocid;   // level 1 sets it; deeper levels inherit

      var node = {
        id: sid + '_L' + level,
        locid: nodeLocid,
        sourceid: sid,
        prdid: pid,
        prddescr: str(pInfo.PRDDESCR),
        mattypeid: str(pInfo.MATTYPEID),
        uomid: str(pInfo.UOMDESCR || pInfo.UOMID || ''),
        coefficient: h.OUTPUTCOEFFICIENT || '',
        inputCoeff: '',
        type: level === 1 ? 'MAIN' : 'COMPONENT',
        sourcetype: hSourceType,
        level: level,
        resids: RES_BY_SID[sid] || [],
        // Co-productos: excluir el producto primario (pid) de la lista C-type.
        // Si el P-type de la fuente (h.PRDID) es distinto de pid (porque llegamos via
        // displayPrdid), agregarlo al inicio como co-producto para que sea visible.
        coprods: (function () {
          var list = (CPR_BY_SID[sid] || []).filter(function (cp) { return cp.prdid !== pid; });
          var ptPrd = str(h.PRDID);
          if (ptPrd && ptPrd !== pid) {
            var ptInfo = prdIndex[ptPrd] || {};
            list = [{
              prdid: ptPrd, coefficient: h.OUTPUTCOEFFICIENT || '',
              prddescr: str(ptInfo.PRDDESCR || ''), mattypeid: str(ptInfo.MATTYPEID || ''),
              uomid: str(ptInfo.UOMDESCR || ptInfo.UOMID || ''), sourcetype: str(h.SOURCETYPE || '')
            }].concat(list);
          }
          return list;
        })(),
        children: []
      };

      // Expand components — respect same plant (curRootLocid).
      // seenCompSids is shared across ALL items of this node: if the same SOURCEID
      // supplies multiple items (e.g. source 53_2043 produces both PRDID=2020029 as P-type
      // and PRDID=2020031 as C-type, and the parent consumes both), we only recurse into
      // that source once — the other product appears as a co-product on the same node.
      var seenCompSids = {};
      (ITM_BY_SID[sid] || []).forEach(function (it) {
        var compPrd = str(it.PRDID);
        if (!compPrd) return;

        var compInfo = prdIndex[compPrd] || {};
        var compCoeff = it.COMPONENTCOEFFICIENT || '';
        var compUom = str(compInfo.UOMDESCR || compInfo.UOMID || '');
        var compDescr = str(compInfo.PRDDESCR || '');

        // Follow ALL production sources at the same plant regardless of SOURCETYPE.
        // SOURCETYPE (P/C) is informative only — traversal is driven by the
        // material-parent-component relationship, not by the source output type.
        // Deduplicate by SOURCEID (across ALL items of this node) to avoid visiting
        // the same production source twice when it appears for multiple PRDIDs.
        var compHdrs = (HDR_BY_PRD[compPrd] || []).filter(function (ch) {
          return str(ch.LOCID) === curRootLocid;
        });
        var uniqueCompHdrs = compHdrs.filter(function (ch) {
          var cSid = str(ch.SOURCEID);
          if (seenCompSids[cSid]) return false;
          seenCompSids[cSid] = true;
          return true;
        });

        var leafFallback = {
          id: sid + '_leaf_' + compPrd + '_L' + (level + 1),
          locid: curRootLocid,
          sourceid: '',
          prdid: compPrd,
          prddescr: compDescr,
          mattypeid: str(compInfo.MATTYPEID),
          uomid: compUom,
          coefficient: '',
          inputCoeff: compCoeff,
          isAltItem: str(it.ISALTITEM),
          type: 'LEAF',
          level: level + 1,
          resids: [],
          coprods: [],
          children: []
        };

        if (uniqueCompHdrs.length > 0) {
          // Component has production sources at this plant — recurse
          var anyAdded = false;
          uniqueCompHdrs.forEach(function (ch) {
            // Pasar compPrd (PSI.PRDID) como displayPrdid: el nodo hijo muestra el material
            // que vincula los niveles (PSI.PRDID = PSH.PRDID del hijo), que puede ser C-type.
            // El filtro de coprods (cp.prdid !== pid) evita que aparezca duplicado.
            var childNode = buildSourceNode(str(ch.SOURCEID), level + 1, newVis, compPrd, curRootLocid);
            if (childNode) {
              childNode.inputCoeff = compCoeff;   // PSI — consumed by parent
              childNode.uomid = compUom;     // UOM from component master
              childNode.type = 'COMPONENT';
              childNode.isAltItem = str(it.ISALTITEM);
              node.children.push(childNode);
              anyAdded = true;
            }
          });
          // If all recursive calls returned null (cycle/missing), fall back to leaf
          if (!anyAdded) node.children.push(leafFallback);
        } else {
          // Leaf component — no production source at this plant
          node.children.push(leafFallback);
        }
      });

      return node;
    }

    function getDepth(node) {
      if (!node.children || !node.children.length) return node.level;
      var maxD = node.level;
      node.children.forEach(function (c) {
        var d = getDepth(c);
        if (d > maxD) maxD = d;
      });
      return maxD;
    }

    function maxDepthGlobal() {
      var m = 0;
      TREE.locids.forEach(function (loc) {
        var s = TREE.stats[loc];
        if (s && s.max_depth > m) m = s.max_depth;
      });
      return m;
    }

    /* ═══════════════════════════════════════════════════════════════
       MULTI-TAB SYSTEM — each tab has its own product search + table
       ═══════════════════════════════════════════════════════════════ */
    var BOM_TABS = [];       // [{id, prdid, expandedIds, tree, inverted, qualityOpen}]
    var BOM_ACTIVE_TAB = null;
    var BOM_TAB_SEQ = 0;
    var BOM_MAX_TABS = 15;

    function bomInitTabs() {
      document.getElementById('bomTabsBar').classList.remove('hidden');
      document.getElementById('bomTabsContent').classList.remove('hidden');
      if (!BOM_TABS.length) bomAddTab();
    }

    function bomAddTab() {
      if (BOM_TABS.length >= BOM_MAX_TABS) return;
      BOM_TAB_SEQ++;
      var tabId = 'bt_' + BOM_TAB_SEQ;
      var tab = {
        id: tabId, prdid: '', expandedIds: {}, tree: null,
        inverted: false
      };
      BOM_TABS.push(tab);
      bomBuildTabPane(tab);
      bomRenderTabBar();
      bomSwitchTab(tabId);
    }

    function bomBuildTabPane(tab) {
      var pane = document.createElement('div');
      pane.id = 'pane_' + tab.id;
      pane.className = 'bom-tab-pane';
      pane.innerHTML =
        '<div class="controls-bar" style="display:flex">' +
          '<div class="prod-search-group">' +
            '<label>Buscar producto</label>' +
            '<div class="ss-wrap prod-ss-wrap">' +
              '<input type="text" class="ss-input-vis bom-search-inp" data-tab="' + tab.id + '" placeholder="Código o descripción..." autocomplete="off">' +
              '<div class="ss-list bom-sugg-list"></div>' +
            '</div>' +
          '</div>' +
          '<button class="btn btn-secondary btn-small" onclick="bomExpandAll(\'' + tab.id + '\')">⊞ Expandir</button>' +
          '<button class="btn btn-secondary btn-small" onclick="bomCollapseAll(\'' + tab.id + '\')">⊟ Colapsar</button>' +
          '<button class="btn btn-danger btn-small" onclick="bomClearSearch(\'' + tab.id + '\')">✕ Limpiar</button>' +
          '<div class="stats-row">' +
            '<span>Raíces: <strong class="bom-stat-roots">-</strong></span>' +
            '<span>Visibles: <strong class="bom-stat-visible">-</strong></span>' +
            '<span>Prof.máx: <strong class="bom-stat-depth">-</strong></span>' +
          '</div>' +
        '</div>' +
        '<div class="empty-state bom-prompt" style="display:block">' +
          '<div class="icon">🔍</div>' +
          'Busca un producto en el campo superior para visualizar su jerarquía BOM.<br>' +
          '<span style="font-size:11px;color:var(--text3)">Se mostrarán todos los SourceID del producto en cada planta y opción de producción.</span>' +
        '</div>' +
        '<div class="table-wrap hidden bom-table-wrap">' +
          '<table><thead><tr>' +
            '<th class="col-exp"></th>' +
            '<th class="col-lvl">Nivel</th>' +
            '<th class="col-loc">Planta</th>' +
            '<th class="col-src">ID de producción</th>' +
            '<th class="col-prd">Material</th>' +
            '<th class="col-alt">Alt</th>' +
            '<th class="col-coef">Coeficiente</th>' +
            '<th class="col-mat">Tipo de Material</th>' +
            '<th class="col-type">Tipo</th>' +
            '<th class="col-res">Puestos de trabajo</th>' +
          '</tr></thead><tbody class="bom-tbody"></tbody></table>' +
          '<div class="empty-state hidden bom-empty"><div class="icon">🔍</div>Producto no encontrado como raíz en la jerarquía BOM.</div>' +
        '</div>';
      document.getElementById('bomTabsContent').appendChild(pane);

      // Wire search
      var inp = pane.querySelector('.bom-search-inp');
      var list = pane.querySelector('.bom-sugg-list');
      inp.addEventListener('input', function () { bomOnSearch(tab.id); });
      inp.addEventListener('focus', function () { if (inp.value.trim()) bomOnSearch(tab.id); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') list.classList.remove('open'); });
      list.addEventListener('mousedown', function (e) {
        var opt = e.target.closest('[data-prdid]');
        if (!opt) return;
        e.preventDefault();
        bomSelectProduct(tab.id, opt.dataset.prdid);
      });

      // Wire expand/collapse click delegation
      pane.querySelector('.bom-tbody').addEventListener('click', function (e) {
        var btn = e.target.closest('.exp-btn');
        if (btn && !btn.classList.contains('no-ch')) {
          var nid = btn.getAttribute('data-nodeid');
          if (nid) {
            var t = bomGetTab(tab.id);
            if (t) {
              if (t.expandedIds[nid]) delete t.expandedIds[nid];
              else t.expandedIds[nid] = true;
              bomRenderTable(tab.id);
            }
          }
        }
      });
    }

    function bomGetTab(tabId) {
      return BOM_TABS.find(function (t) { return t.id === tabId; });
    }

    function bomGetPane(tabId) {
      return document.getElementById('pane_' + tabId);
    }

    function bomRenderTabBar() {
      var scroll = document.getElementById('bomTabsScroll');
      scroll.innerHTML = '';
      BOM_TABS.forEach(function (tab) {
        var btn = document.createElement('button');
        btn.className = 'bom-tab-btn' + (BOM_ACTIVE_TAB === tab.id ? ' active' : '');
        var label = tab.prdid || 'Nueva búsqueda';
        btn.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis;">' + escH(label) + '</span>';
        if (BOM_TABS.length > 1) {
          var closeBtn = document.createElement('span');
          closeBtn.className = 'bom-tab-close';
          closeBtn.textContent = '×';
          closeBtn.addEventListener('click', function (e) { e.stopPropagation(); bomCloseTab(tab.id); });
          btn.appendChild(closeBtn);
        }
        btn.addEventListener('click', function () { bomSwitchTab(tab.id); });
        scroll.appendChild(btn);
      });
      if (BOM_TABS.length < BOM_MAX_TABS) {
        var addBtn = document.createElement('button');
        addBtn.className = 'bom-tab-add';
        addBtn.title = 'Nueva pestaña (máx 15)';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', function () { bomAddTab(); });
        scroll.appendChild(addBtn);
      }
    }

    function bomSwitchTab(tabId) {
      BOM_ACTIVE_TAB = tabId;
      BOM_TABS.forEach(function (t) {
        var pane = bomGetPane(t.id);
        if (pane) pane.classList.toggle('active', t.id === tabId);
      });
      bomRenderTabBar();
    }

    function bomCloseTab(tabId) {
      var idx = BOM_TABS.findIndex(function (t) { return t.id === tabId; });
      if (idx < 0) return;
      var pane = bomGetPane(tabId);
      if (pane) pane.remove();
      BOM_TABS.splice(idx, 1);
      if (BOM_ACTIVE_TAB === tabId) {
        var next = BOM_TABS[Math.min(idx, BOM_TABS.length - 1)];
        if (next) bomSwitchTab(next.id);
      }
      if (!BOM_TABS.length) bomAddTab();
      bomRenderTabBar();
    }

    /* ── Search within tab ── */
    function bomOnSearch(tabId) {
      var pane = bomGetPane(tabId);
      if (!pane) return;
      var inp = pane.querySelector('.bom-search-inp');
      var list = pane.querySelector('.bom-sugg-list');
      var val = inp.value.trim();
      if (!val) {
        list.classList.remove('open');
        var tab = bomGetTab(tabId);
        if (tab && tab.prdid) { tab.prdid = ''; tab.expandedIds = {}; bomRenderTable(tabId); bomRenderTabBar(); }
        return;
      }
      var f = val.toLowerCase();
      var matches = prodSuggestions.filter(function (p) {
        return p.prdid.toLowerCase().indexOf(f) >= 0 || p.prddescr.toLowerCase().indexOf(f) >= 0;
      }).slice(0, 30);
      list.innerHTML = '';
      if (!matches.length) {
        list.innerHTML = '<div class="ss-none">Sin coincidencias</div>';
      } else {
        matches.forEach(function (p) {
          var div = document.createElement('div');
          div.className = 'ss-opt';
          div.innerHTML = '<span style="color:var(--accent);font-weight:600">' + escH(p.prdid) + '</span>' +
            (p.prddescr ? ' <span style="color:var(--text3);font-size:10px">· ' + escH(p.prddescr) + '</span>' : '');
          div.dataset.prdid = p.prdid;
          list.appendChild(div);
        });
      }
      list.classList.add('open');
    }

    async function bomSelectProduct(tabId, prdid) {
      var tab = bomGetTab(tabId);
      var pane = bomGetPane(tabId);
      if (!tab || !pane) return;
      setStatus('info', 'Cargando BOM para ' + prdid + '...');
      try {
        await loadBomSubtree(prdid);
      } catch (e) {
        setStatus('err', 'Error cargando BOM: ' + e.message);
        return;
      }
      currentLoc = '';
      finalizeHierarchy();
      tab.tree = JSON.parse(JSON.stringify(TREE));
      tab.prdid = prdid;
      tab.expandedIds = {};
      tab.inverted = false;
      setStatus('ok', '¡Listo! ' + TREE.locids.length + ' plantas · profundidad máx: ' + maxDepthGlobal());

      var p = prodSuggestions.find(function (x) { return x.prdid === prdid; });
      pane.querySelector('.bom-search-inp').value = prdid + (p && p.prddescr ? '  ·  ' + p.prddescr : '');
      pane.querySelector('.bom-sugg-list').classList.remove('open');
      // Also set globals for compatibility
      selectedPrdid = prdid;
      expandedIds = {};
      bomRenderTable(tabId);
      bomRenderTabBar();
    }

    function bomExpandAll(tabId) {
      var tab = bomGetTab(tabId);
      if (!tab || !tab.prdid) return;
      // Restore globals from tab state
      bomRestoreGlobals(tab);
      tab.expandedIds = {};
      function expNode(node) {
        if (node.children && node.children.length > 0) {
          tab.expandedIds[node.id] = true;
          node.children.forEach(expNode);
        }
      }
      bomGetRoots(tab).forEach(expNode);
      bomRenderTable(tabId);
    }

    function bomCollapseAll(tabId) {
      var tab = bomGetTab(tabId);
      if (!tab) return;
      tab.expandedIds = {};
      bomRenderTable(tabId);
    }

    function bomClearSearch(tabId) {
      var tab = bomGetTab(tabId);
      var pane = bomGetPane(tabId);
      if (!tab || !pane) return;
      pane.querySelector('.bom-search-inp').value = '';
      pane.querySelector('.bom-sugg-list').classList.remove('open');
      tab.prdid = '';
      tab.expandedIds = {};
      tab.inverted = false;
      bomRenderTable(tabId);
      bomRenderTabBar();
    }

    function bomRestoreGlobals(tab) {
      if (tab.tree) {
        TREE = tab.tree;
      }
      selectedPrdid = tab.prdid;
      expandedIds = tab.expandedIds;
    }

    function bomGetRoots(tab) {
      if (!tab.prdid || !tab.tree) return [];
      var tree = tab.tree;
      var all = [];
      tree.locids.forEach(function (loc) {
        (tree.roots[loc] || []).forEach(function (root) {
          if (root.prdid === tab.prdid ||
            (root.coprods && root.coprods.some(function (cp) { return cp.prdid === tab.prdid; }))) {
            all.push(root);
          }
        });
      });
      return all;
    }

    /* ── Invert hierarchy ── */
    function bomToggleInvert(tabId) {
      var tab = bomGetTab(tabId);
      if (!tab || !tab.prdid) return;
      tab.inverted = !tab.inverted;
      tab.expandedIds = {};
      var pane = bomGetPane(tabId);
      if (pane) {
        var btn = pane.querySelector('.bom-invert-btn');
        if (btn) btn.style.background = tab.inverted ? 'var(--accent)' : '';
        if (btn) btn.style.color = tab.inverted ? '#000' : '';
      }
      bomRenderTable(tabId);
    }

    function bomInvertTree(roots) {
      // Invert hierarchy: keep same roots, but reverse the internal tree.
      // Each root stays as-is visually, but its deepest leaves become the first
      // expandable children, and the original root info appears at the bottom.
      return roots.map(function (root) {
        return invertNode(root, 1);
      });
    }

    function invertNode(node, level) {
      // Deep-clone the node preserving all fields
      var inv = {
        id: 'inv_' + node.id, locid: node.locid, sourceid: node.sourceid,
        prdid: node.prdid, prddescr: node.prddescr, mattypeid: node.mattypeid,
        uomid: node.uomid, coefficient: node.coefficient,
        inputCoeff: node.inputCoeff, type: node.type, sourcetype: node.sourcetype || '',
        level: level, resids: node.resids || [], coprods: node.coprods || [],
        children: []
      };

      if (!node.children || !node.children.length) {
        return inv; // leaf stays as leaf
      }

      // Collect all leaf-to-root paths within this subtree
      var leafPaths = [];
      function collectPaths(n, path) {
        var cur = path.concat([n]);
        if (!n.children || !n.children.length) {
          leafPaths.push(cur);
        } else {
          n.children.forEach(function (c) { collectPaths(c, cur); });
        }
      }
      node.children.forEach(function (c) { collectPaths(c, []); });

      // Build reversed children: leaves become direct children, parents below them
      var childMap = {};
      leafPaths.forEach(function (path) {
        var leaf = path[path.length - 1];
        var leafKey = leaf.prdid + '|' + leaf.locid + '|' + (leaf.sourceid || leaf.id);
        if (!childMap[leafKey]) {
          childMap[leafKey] = {
            id: 'inv_' + leaf.id + '_L' + (level + 1),
            locid: leaf.locid, sourceid: leaf.sourceid,
            prdid: leaf.prdid, prddescr: leaf.prddescr, mattypeid: leaf.mattypeid,
            uomid: leaf.uomid, coefficient: leaf.coefficient,
            inputCoeff: leaf.inputCoeff, type: leaf.type, sourcetype: leaf.sourcetype || '',
            level: level + 1, resids: leaf.resids || [], coprods: leaf.coprods || [],
            children: []
          };
        }
        // Build chain from leaf-1 up (reversed path towards root's direct child)
        var parent = childMap[leafKey];
        for (var i = path.length - 2; i >= 0; i--) {
          var orig = path[i];
          var childKey2 = orig.prdid + '|' + orig.locid + '|' + (orig.sourceid || orig.id);
          var existing = parent.children.find(function (c) {
            return (c.prdid + '|' + c.locid + '|' + (c.sourceid || '')) ===
                   (orig.prdid + '|' + orig.locid + '|' + (orig.sourceid || ''));
          });
          if (!existing) {
            existing = {
              id: 'inv_' + orig.id + '_L' + (parent.level + 1),
              locid: orig.locid, sourceid: orig.sourceid,
              prdid: orig.prdid, prddescr: orig.prddescr, mattypeid: orig.mattypeid,
              uomid: orig.uomid, coefficient: orig.coefficient,
              inputCoeff: orig.inputCoeff, type: orig.type, sourcetype: orig.sourcetype || '',
              level: parent.level + 1, resids: orig.resids || [], coprods: orig.coprods || [],
              children: []
            };
            parent.children.push(existing);
          }
          parent = existing;
        }
      });

      inv.children = Object.values(childMap);
      return inv;
    }


    /* ── Render table for a specific tab ── */
    function bomRenderTable(tabId) {
      var tab = bomGetTab(tabId);
      var pane = bomGetPane(tabId);
      if (!tab || !pane) return;

      var promptEl = pane.querySelector('.bom-prompt');
      var tableWrap = pane.querySelector('.bom-table-wrap');
      var tbody = pane.querySelector('.bom-tbody');

      if (!tab.prdid) {
        promptEl.style.display = 'block';
        tableWrap.classList.add('hidden');
        pane.querySelector('.bom-stat-roots').textContent = '-';
        pane.querySelector('.bom-stat-visible').textContent = '-';
        pane.querySelector('.bom-stat-depth').textContent = '-';
        return;
      }

      promptEl.style.display = 'none';
      tableWrap.classList.remove('hidden');

      // Restore globals
      bomRestoreGlobals(tab);
      var roots = bomGetRoots(tab);

      // Apply inversion if needed
      if (tab.inverted && roots.length) {
        roots = bomInvertTree(roots);
      }

      var rows = [];
      bomFlatten(roots, rows, tab.expandedIds);

      var html = '';
      rows.forEach(function (r) {
        var n = r.node;
        var indent = (n.level - 1) * 20;
        var hasKids = n.children && n.children.length > 0;
        var isExp = !!tab.expandedIds[n.id];

        var rowClass = 'rt-leaf';
        if (n.type === 'MAIN') rowClass = 'rt-root';
        else if (n.type === 'CYCLE') rowClass = 'rt-cycle';
        else if (hasKids) rowClass = 'rt-subprod';

        var expHtml = hasKids
          ? '<button class="exp-btn" data-nodeid="' + escH(n.id) + '">' + (isExp ? '▼' : '▶') + '</button>'
          : '<button class="exp-btn no-ch">·</button>';

        var stVal = n.sourcetype || '';
        var typeBadge = stVal
          ? '<span class="badge ' + (stVal === 'C' ? 'badge-coprod' : 'badge-psh') + '">' + escH(stVal) + '</span>'
          : '';

        var resHtml = '';
        if (n.resids && n.resids.length) {
          resHtml = n.resids.map(function (rid) {
            var rdesc = RES_DESCR[rid] || '';
            var title = rdesc ? ' title="' + escH(rdesc) + '"' : '';
            return '<span class="badge badge-res"' + title + '>' + escH(rid) + '</span>';
          }).join('');
        }

        var locRec = LOC_BY_ID[n.locid] || {};
        var locLabel = n.locid
          ? escH(n.locid) + (locRec.LOCDESCR ? ' <span style="color:var(--text3);font-size:10px">— ' + escH(locRec.LOCDESCR) + '</span>' : '')
          : '';
        var matLabel = escH(n.prdid) + (n.prddescr ? ' <span style="color:var(--text3);font-size:10px">— ' + escH(n.prddescr) + '</span>' : '');

        html += '<tr class="' + rowClass + '">';
        html += '<td style="padding-left:' + (indent + 6) + 'px">' + expHtml + '</td>';
        html += '<td>' + n.level + '</td>';
        html += '<td style="font-family:var(--mono);font-size:11px">' + locLabel + '</td>';
        html += '<td style="font-family:var(--mono);font-size:11px">' + escH(n.sourceid) + '</td>';
        html += '<td style="font-family:var(--mono);font-size:11px">' + matLabel + '</td>';
        var altHtml = '';
        if (n.isAltItem === 'X') {
          var parentSid = n.sourceid || '';
          // Search in parent's SOURCEID context — the node's sourceid links back to parent PSH
          // For leaf nodes without sourceid, look through all PSISUB entries
          var altSubs = [];
          // The PSISUB_BY_SID is indexed by the SOURCEID of the parent production source
          // We need to find entries where SPRDFR matches this node's PRDID
          Object.keys(PSISUB_BY_SID).forEach(function (ssid) {
            (PSISUB_BY_SID[ssid] || []).forEach(function (sub) {
              if (str(sub.SPRDFR) === n.prdid) altSubs.push(str(sub.PRDFR));
            });
          });
          var altTitle = altSubs.length > 0 ? 'Reemplaza a: ' + altSubs.join(', ') : 'Material de reemplazo';
          altHtml = '<span class="badge badge-alt" title="' + escH(altTitle) + '">X</span>';
        }
        html += '<td style="text-align:center">' + altHtml + '</td>';
        html += '<td style="text-align:right;font-family:var(--mono)">' + fmtDualCoef(n) + '</td>';
        html += '<td style="font-family:var(--mono);font-size:11px">' + escH(n.mattypeid) + '</td>';
        html += '<td>' + typeBadge + '</td>';
        html += '<td>' + resHtml + '</td>';
        html += '</tr>';

        if (n.coprods && n.coprods.length > 0 && isExp) {
          n.coprods.forEach(function (cp) {
            var cpMatLabel = escH(cp.prdid) + (cp.prddescr ? ' <span style="color:var(--text3);font-size:10px">— ' + escH(cp.prddescr) + '</span>' : '');
            html += '<tr class="rt-coprod">';
            html += '<td style="padding-left:' + (indent + 28) + 'px"></td><td></td><td></td><td></td>';
            html += '<td style="font-family:var(--mono);font-size:11px">' + cpMatLabel + '</td>';
            html += '<td></td>';
            html += '<td style="text-align:right;font-family:var(--mono)">' + fmtDualCoef(cp) + '</td>';
            html += '<td style="font-family:var(--mono);font-size:11px">' + escH(cp.mattypeid) + '</td>';
            html += '<td>' + (cp.sourcetype ? '<span class="badge ' + (cp.sourcetype === 'C' ? 'badge-coprod' : 'badge-psh') + '">' + escH(cp.sourcetype) + '</span>' : '') + '</td>';
            html += '<td></td></tr>';
          });
        }
        if (hasKids && isExp) {
          html += '<tr class="tr-comp-divider"><td style="padding-left:' + (indent + 28) + 'px"></td>';
          html += '<td colspan="9"><span class="divider-lbl">↓ Componentes PSI (' + n.children.length + ')</span></td></tr>';
        }
      });

      tbody.innerHTML = html;
      pane.querySelector('.bom-stat-roots').textContent = roots.length;
      pane.querySelector('.bom-stat-visible').textContent = rows.length;
      var md = 0;
      if (tab.tree) tab.tree.locids.forEach(function (l) { var s = tab.tree.stats[l]; if (s && s.max_depth > md) md = s.max_depth; });
      pane.querySelector('.bom-stat-depth').textContent = md;
      pane.querySelector('.bom-empty').classList.toggle('hidden', rows.length > 0);
    }

    function bomFlatten(roots, rows, expIds) {
      roots.forEach(function (node) {
        rows.push({ node: node });
        if (expIds[node.id] && node.children) {
          bomFlattenChildren(node.children, rows, expIds);
        }
      });
    }

    function bomFlattenChildren(children, rows, expIds) {
      sortedNodes(children).forEach(function (node) {
        rows.push({ node: node });
        if (expIds[node.id] && node.children) {
          bomFlattenChildren(node.children, rows, expIds);
        }
      });
    }

    /* ═══════════════════════════════════════════════════════════════
       LEGACY WRAPPERS — keep old functions working for initTableUI call
       ═══════════════════════════════════════════════════════════════ */
    function initTableUI() {
      bomInitTabs();
      if (TREE.cycles.length > 0) {
        document.getElementById('cycleBanner').style.display = 'block';
        document.getElementById('cycleList').textContent = TREE.cycles.join('; ');
      }
    }

    function getRoots() {
      if (BOM_ACTIVE_TAB) {
        var tab = bomGetTab(BOM_ACTIVE_TAB);
        if (tab) return bomGetRoots(tab);
      }
      return [];
    }

    function renderTable() {
      if (BOM_ACTIVE_TAB) bomRenderTable(BOM_ACTIVE_TAB);
    }

    function onProductSearch() {
      if (BOM_ACTIVE_TAB) bomOnSearch(BOM_ACTIVE_TAB);
    }

    async function selectProduct(prdid) {
      if (BOM_ACTIVE_TAB) await bomSelectProduct(BOM_ACTIVE_TAB, prdid);
    }

    function expandAll() {
      if (BOM_ACTIVE_TAB) bomExpandAll(BOM_ACTIVE_TAB);
    }

    function collapseAll() {
      if (BOM_ACTIVE_TAB) bomCollapseAll(BOM_ACTIVE_TAB);
    }

    function clearProductSearch() {
      if (BOM_ACTIVE_TAB) bomClearSearch(BOM_ACTIVE_TAB);
    }

    function sortedNodes(nodes) {
      return nodes.slice().sort(function (a, b) {
        var aHasKids = !!(a.children && a.children.length);
        var bHasKids = !!(b.children && b.children.length);
        if (aHasKids === bHasKids) return 0;
        return aHasKids ? 1 : -1;
      });
    }

    function flatten(roots, rows) {
      bomFlatten(roots, rows, expandedIds);
    }

    function flattenChildren(children, rows) {
      bomFlattenChildren(children, rows, expandedIds);
    }

