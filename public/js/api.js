    /* ═══════════════════════════════════════════════════════════════
       INDEXEDDB HELPERS
       All large datasets stream into IDB — JS heap holds only small
       per-product subtrees (BOM) and lookup tables (SN).
       ═══════════════════════════════════════════════════════════════ */
    function openDB() {
      return new Promise(function (resolve, reject) {
        var req = indexedDB.open('ibp_data', 2);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          // BOM stores
          if (!db.objectStoreNames.contains('bom_psh')) {
            var s = db.createObjectStore('bom_psh', { autoIncrement: true });
            s.createIndex('by_prdid', 'PRDID', { unique: false });
            s.createIndex('by_sourceid', 'SOURCEID', { unique: false });
          }
          if (!db.objectStoreNames.contains('bom_psi')) {
            db.createObjectStore('bom_psi', { autoIncrement: true })
              .createIndex('by_sourceid', 'SOURCEID', { unique: false });
          }
          if (!db.objectStoreNames.contains('bom_psr')) {
            db.createObjectStore('bom_psr', { autoIncrement: true })
              .createIndex('by_sourceid', 'SOURCEID', { unique: false });
          }
          if (!db.objectStoreNames.contains('bom_prd')) {
            db.createObjectStore('bom_prd', { keyPath: 'PRDID' });
          }
          // BOM Location master (lookup for LOCID→LOCDESCR in BOM tab)
          if (!db.objectStoreNames.contains('bom_loc')) {
            db.createObjectStore('bom_loc', { keyPath: 'LOCID' });
          }
          // SN edge stores (SN lookup tables stay in SN_IDX JS object — they are small)
          if (!db.objectStoreNames.contains('sn_loc')) {
            db.createObjectStore('sn_loc', { autoIncrement: true })
              .createIndex('by_prdid', 'PRDID', { unique: false });
          }
          if (!db.objectStoreNames.contains('sn_cust')) {
            db.createObjectStore('sn_cust', { autoIncrement: true })
              .createIndex('by_prdid', 'PRDID', { unique: false });
          }
          if (!db.objectStoreNames.contains('sn_plant')) {
            db.createObjectStore('sn_plant', { autoIncrement: true })
              .createIndex('by_prdid', 'PRDID', { unique: false });
          }
          // SN PSI — Production Source Item for SN Analyzer
          if (!db.objectStoreNames.contains('sn_psi')) {
            var snPsi = db.createObjectStore('sn_psi', { autoIncrement: true });
            snPsi.createIndex('by_prdid', 'PRDID', { unique: false });
            snPsi.createIndex('by_sourceid', 'SOURCEID', { unique: false });
          }
          // SN Location Product — large table, stored in IDB
          if (!db.objectStoreNames.contains('sn_loc_prod')) {
            var snLp = db.createObjectStore('sn_loc_prod', { autoIncrement: true });
            snLp.createIndex('by_prdid', 'PRDID', { unique: false });
            snLp.createIndex('by_locid', 'LOCID', { unique: false });
          }
          // SN Customer Product — large table, stored in IDB
          if (!db.objectStoreNames.contains('sn_cust_prod')) {
            var snCp = db.createObjectStore('sn_cust_prod', { autoIncrement: true });
            snCp.createIndex('by_prdid', 'PRDID', { unique: false });
            snCp.createIndex('by_custid', 'CUSTID', { unique: false });
          }
          // PA (Production Analyzer) stores
          if (!db.objectStoreNames.contains('pa_psh')) {
            var paPsh = db.createObjectStore('pa_psh', { autoIncrement: true });
            paPsh.createIndex('by_prdid', 'PRDID', { unique: false });
            paPsh.createIndex('by_locid', 'LOCID', { unique: false });
            paPsh.createIndex('by_sourceid', 'SOURCEID', { unique: false });
          }
          if (!db.objectStoreNames.contains('pa_psi')) {
            var paPsi = db.createObjectStore('pa_psi', { autoIncrement: true });
            paPsi.createIndex('by_sourceid', 'SOURCEID', { unique: false });
            paPsi.createIndex('by_prdid', 'PRDID', { unique: false });
          }
          if (!db.objectStoreNames.contains('pa_psr')) {
            db.createObjectStore('pa_psr', { autoIncrement: true })
              .createIndex('by_sourceid', 'SOURCEID', { unique: false });
          }
          if (!db.objectStoreNames.contains('pa_loc_prod')) {
            var paLp = db.createObjectStore('pa_loc_prod', { autoIncrement: true });
            paLp.createIndex('by_prdid', 'PRDID', { unique: false });
            paLp.createIndex('by_locid', 'LOCID', { unique: false });
          }
          if (!db.objectStoreNames.contains('pa_loc_src')) {
            var paLs = db.createObjectStore('pa_loc_src', { autoIncrement: true });
            paLs.createIndex('by_prdid', 'PRDID', { unique: false });
            paLs.createIndex('by_locfr', 'LOCFR', { unique: false });
          }
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }

    function idbClear(storeName) {
      return new Promise(function (resolve, reject) {
        var tx = IDB.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
    }

    function idbBulkPut(storeName, records) {
      if (!records || !records.length) return Promise.resolve();
      return new Promise(function (resolve, reject) {
        var tx = IDB.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        records.forEach(function (r) { store.put(r); });
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
    }

    function idbGetByIndex(storeName, indexName, key) {
      return new Promise(function (resolve, reject) {
        var tx = IDB.transaction(storeName, 'readonly');
        var req = tx.objectStore(storeName).index(indexName).getAll(key);
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }

    function idbGet(storeName, key) {
      return new Promise(function (resolve, reject) {
        var tx = IDB.transaction(storeName, 'readonly');
        var req = tx.objectStore(storeName).get(key);
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }

    function idbGetAll(storeName) {
      return new Promise(function (resolve, reject) {
        var tx = IDB.transaction(storeName, 'readonly');
        var req = tx.objectStore(storeName).getAll();
        req.onsuccess = function (e) { resolve(e.target.result || []); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }

    /* Itera todos los registros de un store con cursor (bajo consumo de RAM).
       onRecord(row) es síncrono — no acumula array, cada registro se descarta
       tras el callback. */
    function idbCursorEach(storeName, onRecord) {
      return new Promise(function (resolve, reject) {
        var tx  = IDB.transaction(storeName, 'readonly');
        var req = tx.objectStore(storeName).openCursor();
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (!cursor) { resolve(); return; }
          onRecord(cursor.value);
          cursor.continue();
        };
        req.onerror   = function (e) { reject(e.target.error); };
        tx.onerror    = function (e) { reject(e.target.error); };
      });
    }

    /* Builds prodSuggestions by iterating unique PRDID keys from bom_psh
       and looking up descriptions from bom_prd — single transaction, no N+1. */
    function idbBuildProdSuggestions() {
      return new Promise(function (resolve, reject) {
        var tx = IDB.transaction(['bom_psh', 'bom_prd'], 'readonly');
        var pshIdx = tx.objectStore('bom_psh').index('by_prdid');
        var prdStore = tx.objectStore('bom_prd');
        var list = [];
        var curReq = pshIdx.openKeyCursor(null, 'nextunique');
        curReq.onsuccess = function (e) {
          var cursor = e.target.result;
          if (!cursor) { resolve(list); return; }
          var pid = String(cursor.key);
          var gr = prdStore.get(pid);
          gr.onsuccess = function (e2) {
            var p = e2.target.result || {};
            list.push({ prdid: pid, prddescr: String(p.PRDDESCR || '').trim() });
            cursor.continue();
          };
        };
        curReq.onerror = function (e) { reject(e.target.error); };
      });
    }


    /* ═══════════════════════════════════════════════════════════════
       API HELPERS
       ═══════════════════════════════════════════════════════════════ */
    async function apiJson(url) {
      var resp = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, user: CFG.user, password: CFG.pass })
      });
      if (!resp.ok) {
        var err = await resp.json().catch(function () { return { error: resp.statusText }; });
        throw new Error(err.error || resp.statusText);
      }
      return resp.json();
    }

    async function apiXml(url) {
      var resp = await fetch('/api/proxy-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, user: CFG.user, password: CFG.pass })
      });
      if (!resp.ok) {
        var err = await resp.json().catch(function () { return { error: resp.statusText }; });
        throw new Error(err.error || resp.statusText);
      }
      return resp.text();
    }


    async function fetchAllPages(entityUrl, logEl, pverFilter, selectFields) {
      var all = [];
      var PAGE_SIZE = 5000;
      var page = 0;
      var filterParam = pverFilter ? '&$filter=' + encodeURIComponent(pverFilter) : '';
      var selectParam = selectFields ? '&$select=' + selectFields : '';
      var url = entityUrl + '?$format=json&$top=' + PAGE_SIZE + filterParam + selectParam;

      while (url) {
        page++;
        if (page > 1) {
          log(logEl, 'info', '  ↳ Pág.' + page + ' GET → ' + url);
        }
        var data = await apiJson(url);
        var results = (data.d && data.d.results) ? data.d.results : (data.value || []);
        all = all.concat(results);

        if (page > 1) {
          log(logEl, 'info', '  ↳ Pág.' + page + ': +' + results.length + ' (acumulado: ' + all.length + ')');
        }

        // OData v2 __next  /  OData v4 @odata.nextLink
        var next = (data.d && data.d.__next) ? data.d.__next : null;
        if (!next && data['@odata.nextLink']) next = data['@odata.nextLink'];

        if (next) {
          url = (next.indexOf('http') === 0) ? next : (CFG.url + next);
        } else if (results.length === PAGE_SIZE) {
          // Página completa sin link → fallback $skip para no perder registros
          var skip = all.length;
          url = entityUrl + '?$format=json&$top=' + PAGE_SIZE + '&$skip=' + skip + filterParam + selectParam;
          log(logEl, 'warn', '  ↳ Sin __next, fallback $skip=' + skip + ' → ' + url);
        } else {
          // Página parcial → fin de datos
          url = null;
        }
      }

      return all;
    }


