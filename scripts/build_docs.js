const fs = require('fs');
const path = require('path');

const testFile = path.join(__dirname, '..', 'test_apps', 'sap_cids_doc_generator(6).html');
const lines = fs.readFileSync(testFile, 'utf8').split('\n');

// 1. Extract CSS (lines 62 to 144) - we skip the basic resets and .card rules.
// Wait, let's target the exact CSS rules needed:
const cssRules = `
/* ── Doc Generator CSS ── */
.drop-zone {
  border: 1.5px dashed var(--border2);
  border-radius: 10px;
  padding: 44px 32px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  background: var(--surface2);
}
.drop-zone:hover, .drop-zone.drag-over {
  border-color: var(--accent);
  background: rgba(247, 168, 0, 0.05); /* adapted to --accent */
  box-shadow: 0 0 0 3px rgba(247, 168, 0, 0.12);
}
.drop-zone input[type="file"] {
  position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
}
.drop-icon { font-size: 2.4rem; margin-bottom: 12px; display: block; }
.drop-title { font-size: 1rem; font-weight: 600; margin-bottom: 5px; }
.drop-hint { font-size: 0.82rem; color: var(--text2); }
.drop-hint b { color: var(--accent); font-weight: 600; }
#file-list { margin-top: 14px; display: flex; flex-direction: column; gap: 7px; }
.file-tag {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 7px; padding: 9px 14px; font-size: 0.85rem;
}
.file-tag .ico { color: var(--amber); }
.file-tag .name { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-tag .size { color: var(--text3); font-size: 0.78rem; flex-shrink: 0; }
.file-tag .rm {
  background: none; border: none; cursor: pointer; color: var(--text3);
  font-size: 0.88rem; padding: 3px 7px; border-radius: 5px; transition: all 0.15s; flex-shrink: 0;
}
.file-tag .rm:hover { color: var(--red); background: rgba(255, 107, 107, 0.12); }
.progress-wrap {
  display: none; margin-top: 16px;
  background: var(--surface); border-radius: 999px; height: 4px; overflow: hidden;
}
.progress-wrap .progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--accent2), var(--accent));
  border-radius: 999px; transition: width 0.25s ease; width: 0%;
}
.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.stat-box {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 8px; padding: 16px 12px; text-align: center;
}
.stat-num { font-size: 1.9rem; font-weight: 700; display: block; line-height: 1; margin-bottom: 5px; }
.stat-num.blue { color: var(--cyan); }
.stat-num.purple { color: var(--purple); }
.stat-num.green { color: var(--green); }
.stat-label { font-size: 0.71rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text3); }

/* Adapting the internal log specifically for docs to mirror main app styles */
#docs-log {
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px 14px; max-height: 200px; overflow-y: auto;
  font-family: var(--mono);
  font-size: 11px; line-height: 1.7; display: none; margin-top: 12px;
}
.l-line { color: var(--text2); }
.l-ok   { color: var(--green); }
.l-warn { color: var(--amber); }
.l-err  { color: var(--red); }
.l-info { color: var(--cyan); }
.docs-hint { color: var(--text3); font-size: 11px; margin-top: 8px; }
`;

const stylesPath = path.join(__dirname, '..', 'public', 'css', 'styles.css');
fs.appendFileSync(stylesPath, '\n' + cssRules);

// 2. Extract Javascript exactly from line 184 to 1200
let jsLogic = lines.slice(183, 1200).join('\n'); // 1-indexed to 0-indexed

// Rename conflicts to avoid polluting global namespace or breaking the app:
// log -> docsLog
// logEl -> docsLogEl
// logHint -> docsLogHint
jsLogic = jsLogic.replace(/function log\(/g, 'function docsLog(');
jsLogic = jsLogic.replace(/log\(/g, 'docsLog(');
jsLogic = jsLogic.replace(/logEl/g, 'docsLogEl');
jsLogic = jsLogic.replace(/logHint/g, 'docsLogHint');
jsLogic = jsLogic.replace(/'log'/g, "'docs-log'");
jsLogic = jsLogic.replace(/'log-hint'/g, "'docs-log-hint'");

// Wrap in IIFE to protect scope? No, generate() and downloadExcel() need to be globally accessible for html buttons
// Let's just keep them global since they don't conflict (generate, downloadExcel don't exist in main app).

const jsPath = path.join(__dirname, '..', 'public', 'js', 'docs.js');
fs.writeFileSync(jsPath, jsLogic);

// 3. Update index.html
const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const htmlSnippetsToInject = `
    <!-- MAIN UPLOAD PANEL -->
    <div class="panel">
      <div class="panel-title">📦 Archivos ZIP de entrada</div>
      <div class="drop-zone" id="dz">
        <input type="file" id="fi" accept=".zip" multiple>
        <span class="drop-icon">🗂️</span>
        <p class="drop-title">Arrastra los ZIP aquí</p>
        <p class="drop-hint">o haz click para seleccionar &nbsp;·&nbsp; <b>Múltiples archivos</b> permitidos</p>
      </div>
      <div id="file-list"></div>
      <div class="progress-wrap" id="pw"><div class="progress-bar" id="pb"></div></div>
      <div class="btn-row">
        <button class="btn btn-primary" id="gen-btn" disabled onclick="generate()">⚙️ Generar Excel</button>
        <button class="btn btn-primary" id="dl-btn" style="display:none; background: var(--green);" onclick="downloadExcel()">⬇️ Descargar Excel</button>
      </div>
    </div>

    <!-- RESULTS PANEL -->
    <div class="panel" id="stats-card" style="display:none">
      <div class="panel-title">📊 Resultado</div>
      <div class="stats-grid">
        <div class="stat-box"><span class="stat-num blue" id="s-jobs">0</span><span class="stat-label">Integraciones</span></div>
        <div class="stat-box"><span class="stat-num purple" id="s-maps">0</span><span class="stat-label">Mapeos</span></div>
        <div class="stat-box"><span class="stat-num green" id="s-filt">0</span><span class="stat-label">Filtros</span></div>
      </div>
    </div>

    <!-- LOGS PANEL -->
    <div class="panel">
      <div class="panel-title">📋 Log de procesamiento</div>
      <div id="docs-log"></div>
      <p class="docs-hint" id="docs-log-hint">Sube un ZIP para comenzar</p>
    </div>
`;
// Replace the empty state inside tab-docs
const targetStr = `
    <div class="empty-state" style="margin-top: 40px; display: flex;">
      <div class="icon">🚧</div>
      Módulo en construcción. Próximamente disponible.
    </div>`;
html = html.replace(targetStr, htmlSnippetsToInject);

// Insert jszip before styles
if (!html.includes('jszip')) {
  html = html.replace('<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>', 
                      '<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>\n  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>');
}

// Insert docs.js near other js files
if (!html.includes('js/docs.js')) {
  html = html.replace('<script src="js/main.js"></script>', '<script src="js/main.js"></script>\n  <script src="js/docs.js"></script>');
}

fs.writeFileSync(htmlPath, html);
console.log('Build completed!');
