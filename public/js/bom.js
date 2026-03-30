    /* ═══════════════════════════════════════════════════════════════
       LOAD BOM SUBTREE FROM IDB (async BFS)
       Populates the small in-memory BOM indexes for ONE selected product.
       Traverses the full tree: co-products and multi-level components.
       ═══════════════════════════════════════════════════════════════ */
    async function loadBomSubtree(prdid) {
      // Reset BOM indexes — will hold only this product's subtree
      HDR_BY_PRD = {}; HDR_BY_SID = {}; ITM_BY_SID = {};
      RES_BY_SID = {}; CPR_BY_SID = {};
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
       STEP 4: RENDER TABLE
       ═══════════════════════════════════════════════════════════════ */
    function initTableUI() {
      document.getElementById('controlsBar').classList.remove('hidden');
      document.getElementById('promptState').style.display = 'block';

      if (TREE.cycles.length > 0) {
        document.getElementById('cycleBanner').style.display = 'block';
        document.getElementById('cycleList').textContent = TREE.cycles.join('; ');
      }

      // prodSuggestions already built from IDB in doFetchAll — no rebuild needed here

      // Wire product search events
      var inp = document.getElementById('inpSearch');
      var suggList = document.getElementById('prodSuggList');
      var newInp = inp.cloneNode(true);  // remove old listeners
      inp.parentNode.replaceChild(newInp, inp);
      inp = newInp;
      inp.addEventListener('input', onProductSearch);
      inp.addEventListener('focus', function () { if (inp.value.trim()) onProductSearch(); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') suggList.classList.remove('open');
      });
      suggList.addEventListener('mousedown', function (e) {
        var opt = e.target.closest('[data-prdid]');
        if (!opt) return;
        e.preventDefault();
        selectProduct(opt.dataset.prdid);
      });

      selectedPrdid = '';
      expandedIds = {};
      searchTerm = '';

      // Fix: use .closest() for robust expand/collapse detection
      document.getElementById('bomBody').addEventListener('click', function (e) {
        var btn = e.target.closest('.exp-btn');
        if (btn && !btn.classList.contains('no-ch')) {
          var nid = btn.getAttribute('data-nodeid');
          if (nid) {
            if (expandedIds[nid]) delete expandedIds[nid];
            else expandedIds[nid] = true;
            renderTable();
          }
        }
      });

      renderTable();
    }

    function getRoots() {
      if (selectedPrdid) {
        // Buscar en todas las plantas (o sólo en currentLoc si el usuario filtró manualmente)
        var targetLoc = currentLoc;
        var locsToSearch = targetLoc ? [targetLoc] : TREE.locids;
        var all = [];

        locsToSearch.forEach(function (loc) {
          (TREE.roots[loc] || []).forEach(function (root) {
            if (root.prdid === selectedPrdid ||
              (root.coprods && root.coprods.some(function (cp) { return cp.prdid === selectedPrdid; }))) {
              all.push(root);
            }
          });
        });
        if (all.length) return all;

        // Producto sólo aparece como componente — construir nodos de todas las plantas
        var seenSids = {};
        var hdrs = HDR_BY_PRD[selectedPrdid] || [];
        if (targetLoc) hdrs = hdrs.filter(function (h) { return str(h.LOCID) === targetLoc; });
        hdrs.forEach(function (h) {
          var sid = str(h.SOURCEID);
          if (seenSids[sid]) return;
          seenSids[sid] = true;
          var node = buildSourceNode(sid, 1, {}, selectedPrdid);
          if (node) { node.type = 'MAIN'; all.push(node); }
        });
        return all;
      }

      // No product selected — show all (or filter by currentLoc if set)
      var all = [];
      var locsToShow = currentLoc ? [currentLoc] : TREE.locids;
      locsToShow.forEach(function (loc) {
        if (TREE.roots[loc]) all = all.concat(TREE.roots[loc]);
      });
      return all;
    }

    function renderTable() {
      var promptEl = document.getElementById('promptState');
      var tableWrap = document.getElementById('tableWrap');

      if (!selectedPrdid) {
        promptEl.style.display = 'block';
        tableWrap.classList.add('hidden');
        document.getElementById('statRoots').textContent = '-';
        document.getElementById('statVisible').textContent = '-';
        document.getElementById('statDepth').textContent = '-';
        return;
      }

      promptEl.style.display = 'none';
      tableWrap.classList.remove('hidden');

      var roots = getRoots();
      var rows = [];
      flatten(roots, rows);

      var tbody = document.getElementById('bomBody');
      var html = '';

      rows.forEach(function (r) {
        var n = r.node;
        var indent = (n.level - 1) * 20;
        var hasKids = n.children && n.children.length > 0;
        var isExp = !!expandedIds[n.id];

        var rowClass = 'rt-leaf';
        if (n.type === 'MAIN') rowClass = 'rt-root';
        else if (n.type === 'CYCLE') rowClass = 'rt-cycle';
        else if (hasKids) rowClass = 'rt-subprod';

        // Expand button
        var expHtml = '';
        if (hasKids) {
          expHtml = '<button class="exp-btn" data-nodeid="' + escH(n.id) + '">' + (isExp ? '▼' : '▶') + '</button>';
        } else {
          expHtml = '<button class="exp-btn no-ch">·</button>';
        }

        // Type badge — SOURCETYPE value only (P = principal output, C = co-product)
        var stVal = n.sourcetype || '';
        var typeBadge = stVal
          ? '<span class="badge ' + (stVal === 'C' ? 'badge-coprod' : 'badge-psh') + '">' + escH(stVal) + '</span>'
          : '';

        // Resources with RESDESCR tooltip
        var resHtml = '';
        if (n.resids && n.resids.length) {
          resHtml = n.resids.map(function (rid) {
            var rdesc = RES_DESCR[rid] || '';
            var title = rdesc ? ' title="' + escH(rdesc) + '"' : '';
            return '<span class="badge badge-res"' + title + '>' + escH(rid) + '</span>';
          }).join('');
        }

        // Plant: LOCID — LOCDESCR
        var locRec = LOC_BY_ID[n.locid] || {};
        var locLabel = n.locid
          ? escH(n.locid) + (locRec.LOCDESCR ? ' <span style="color:var(--text3);font-size:10px">— ' + escH(locRec.LOCDESCR) + '</span>' : '')
          : '';

        // Material: PRDID — PRDDESCR
        var matLabel = escH(n.prdid) + (n.prddescr ? ' <span style="color:var(--text3);font-size:10px">— ' + escH(n.prddescr) + '</span>' : '');

        html += '<tr class="' + rowClass + '">';
        html += '<td style="padding-left:' + (indent + 6) + 'px">' + expHtml + '</td>';
        html += '<td>' + n.level + '</td>';
        html += '<td style="font-family:var(--mono);font-size:11px">' + locLabel + '</td>';
        html += '<td style="font-family:var(--mono);font-size:11px">' + escH(n.sourceid) + '</td>';
        html += '<td style="font-family:var(--mono);font-size:11px">' + matLabel + '</td>';
        html += '<td style="text-align:right;font-family:var(--mono)">' + fmtDualCoef(n) + '</td>';
        html += '<td style="font-family:var(--mono);font-size:11px">' + escH(n.mattypeid) + '</td>';
        html += '<td>' + typeBadge + '</td>';
        html += '<td>' + resHtml + '</td>';
        html += '</tr>';

        // Render co-products (PSH SOURCETYPE=C) as sub-rows if expanded
        if (n.coprods && n.coprods.length > 0 && isExp) {
          n.coprods.forEach(function (cp) {
            var cpMatLabel = escH(cp.prdid) + (cp.prddescr ? ' <span style="color:var(--text3);font-size:10px">— ' + escH(cp.prddescr) + '</span>' : '');
            html += '<tr class="rt-coprod">';
            html += '<td style="padding-left:' + (indent + 28) + 'px"></td>';
            html += '<td></td>';
            html += '<td></td>';
            html += '<td></td>';
            html += '<td style="font-family:var(--mono);font-size:11px">' + cpMatLabel + '</td>';
            html += '<td style="text-align:right;font-family:var(--mono)">' + fmtDualCoef(cp) + '</td>';
            html += '<td style="font-family:var(--mono);font-size:11px">' + escH(cp.mattypeid) + '</td>';
            html += '<td>' + (cp.sourcetype ? '<span class="badge ' + (cp.sourcetype === 'C' ? 'badge-coprod' : 'badge-psh') + '">' + escH(cp.sourcetype) + '</span>' : '') + '</td>';
            html += '<td></td>';
            html += '</tr>';
          });
        }

        // Divider: appears after co-products (PSH) and before PSI children
        if (hasKids && isExp) {
          html += '<tr class="tr-comp-divider">';
          html += '<td style="padding-left:' + (indent + 28) + 'px"></td>';
          html += '<td colspan="8"><span class="divider-lbl">↓ Componentes PSI (' + n.children.length + ')</span></td>';
          html += '</tr>';
        }
      });

      tbody.innerHTML = html;

      // Stats
      document.getElementById('statRoots').textContent = getRoots().length;
      document.getElementById('statVisible').textContent = rows.length;
      var md = 0;
      TREE.locids.forEach(function (l) { var s = TREE.stats[l]; if (s && s.max_depth > md) md = s.max_depth; });
      document.getElementById('statDepth').textContent = md;

      document.getElementById('emptyState').classList.toggle('hidden', rows.length > 0);
    }

    function sortedNodes(nodes) {
      // Nodes with children always sink to the bottom of their sibling group (level 2+)
      return nodes.slice().sort(function (a, b) {
        var aHasKids = !!(a.children && a.children.length);
        var bHasKids = !!(b.children && b.children.length);
        if (aHasKids === bHasKids) return 0;
        return aHasKids ? 1 : -1;
      });
    }

    function flatten(roots, rows) {
      roots.forEach(function (node) {
        rows.push({ node: node });
        if (expandedIds[node.id] && node.children) {
          flattenChildren(node.children, rows);
        }
      });
    }

    function flattenChildren(children, rows) {
      sortedNodes(children).forEach(function (node) {
        rows.push({ node: node });
        if (expandedIds[node.id] && node.children) {
          flattenChildren(node.children, rows);
        }
      });
    }

    /* ── Product search ── */
    function onProductSearch() {
      var val = document.getElementById('inpSearch').value.trim();
      var list = document.getElementById('prodSuggList');
      if (!val) {
        list.classList.remove('open');
        if (selectedPrdid) { selectedPrdid = ''; expandedIds = {}; renderTable(); }
        return;
      }
      var f = val.toLowerCase();
      var matches = prodSuggestions.filter(function (p) {
        return p.prdid.toLowerCase().indexOf(f) >= 0 || p.prddescr.toLowerCase().indexOf(f) >= 0;
      }).slice(0, 30);
      list.innerHTML = '';
      if (!matches.length) {
        var noRes = document.createElement('div');
        noRes.className = 'ss-none';
        noRes.textContent = 'Sin coincidencias';
        list.appendChild(noRes);
      } else {
        matches.forEach(function (p) {
          var div = document.createElement('div');
          div.className = 'ss-opt';
          div.innerHTML = '<span style="color:var(--accent);font-weight:600">' + escH(p.prdid) + '</span>'
            + (p.prddescr ? ' <span style="color:var(--text3);font-size:10px">· ' + escH(p.prddescr) + '</span>' : '');
          div.dataset.prdid = p.prdid;
          list.appendChild(div);
        });
      }
      list.classList.add('open');
    }

    async function selectProduct(prdid) {
      // Load BOM subtree for this product from IDB into small in-memory indexes
      setStatus('info', 'Cargando BOM para ' + prdid + '...');
      try {
        await loadBomSubtree(prdid);
      } catch (e) {
        setStatus('err', 'Error cargando BOM: ' + e.message);
        return;
      }

      // Mostrar todas las plantas donde existe el producto — no filtrar por planta inicial
      currentLoc = '';

      // Build TREE for this product's subtree only
      finalizeHierarchy();
      setStatus('ok', '¡Listo! ' + TREE.locids.length + ' plantas · profundidad máx: ' + maxDepthGlobal());

      var p = prodSuggestions.find(function (x) { return x.prdid === prdid; });
      document.getElementById('inpSearch').value = prdid + (p && p.prddescr ? '  ·  ' + p.prddescr : '');
      document.getElementById('prodSuggList').classList.remove('open');
      selectedPrdid = prdid;
      searchTerm = '';
      expandedIds = {};
      renderTable();
    }

    function expandAll() {
      if (!selectedPrdid) return;
      expandedIds = {};
      function expNode(node) {
        if (node.children && node.children.length > 0) {
          expandedIds[node.id] = true;
          node.children.forEach(expNode);
        }
      }
      getRoots().forEach(expNode);
      renderTable();
    }

    function collapseAll() {
      expandedIds = {};
      renderTable();
    }

    function clearProductSearch() {
      document.getElementById('inpSearch').value = '';
      document.getElementById('prodSuggList').classList.remove('open');
      selectedPrdid = '';
      currentLoc = '';   // PARTE 1: reset locid_base on clear
      searchTerm = '';
      expandedIds = {};
      renderTable();
    }


