/* ═══════════════════════════════════════════════════════════════
       GLOBAL STATE
       ═══════════════════════════════════════════════════════════════ */
    var CFG = { url: '', user: '', pass: '', pa: '', service: '', pver: '', paEntities: [] };
    var IS_CONNECTED = false;
    var ENTITIES = [];       // [{name, fields:[]}]
    var RAW = {};            // legacy placeholder (no longer used for storage)
    var TREE = { locids: [], roots: {}, stats: {}, cycles: [] };
    var IDB = null;         // IndexedDB connection (opened lazily)
    // Supply Network indexes — edge tables live in IDB; only small lookups stay in JS
    var SN_IDX = {
      allPrds: {},   // prdid → true  (string keys only — tiny)
      prdLookup: {},   // prdid → { PRDID, PRDDESCR, MATTYPEID }
      locLookup: {},   // locid → { LOCID, LOCDESCR }
      custLookup: {}    // custid → { CUSTID, CUSTDESCR }
    };
    var expandedIds = {};
    var currentLoc = '';
    var searchTerm = '';
    var sourceFilter = '';
    var selectedPrdid = '';
    var prodSuggestions = [];
    var prdIndex = {};
    // BOM indexes (populated by doFetchAll streaming + finalizeHierarchy)
    var HDR_BY_PRD = {};  // PRDID    -> [headers]
    var HDR_BY_SID = {};  // SOURCEID -> header (P-type preferred)
    var ITM_BY_SID = {};  // SOURCEID -> [items]
    var RES_BY_SID = {};  // SOURCEID -> [RESID]
    var CPR_BY_SID = {};  // SOURCEID -> [co-product objects]
    var isCompAtLoc = {};  // "LOCID|PRDID" -> true  (built during item streaming)
    // BOM enrichment lookups (populated during loadBomSubtree)
    var LOC_BY_ID = {};   // locid → { LOCID, LOCDESCR }
    var RES_DESCR = {};   // resid → RESDESCR


