    /* ═══════════════════════════════════════════════════════════════
       TIMER UTILITY
       ═══════════════════════════════════════════════════════════════ */
    function createTimer() {
      var t0 = Date.now();
      return {
        ms: function () { return Date.now() - t0; },
        fmt: function () { return '[+' + (Date.now() - t0) + 'ms]'; }
      };
    }


    /* ═══════════════════════════════════════════════════════════════
       UTILITIES
       ═══════════════════════════════════════════════════════════════ */
    function str(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
    function escH(s) { var d = document.createElement('div'); d.textContent = str(s); return d.innerHTML; }
    function fmtCoef(v) { if (v === '' || v === null || v === undefined) return ''; var n = Number(v); return isNaN(n) ? str(v) : n.toLocaleString('es-CL', { maximumFractionDigits: 4 }); }

    /* Renders the coefficient cell for a node or co-product.
       - Both PSI (inputCoeff) and PSH (coefficient): shows ↓ consume · ↑ produce
       - Only one value: shows it plainly
       UOM (uomid) appended once, after both values. */
    function fmtDualCoef(n) {
      var hasIn = n.inputCoeff !== '' && n.inputCoeff != null;
      var hasOut = n.coefficient !== '' && n.coefficient != null;
      var uom = n.uomid ? ' <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">' + escH(n.uomid) + '</span>' : '';
      if (hasIn && hasOut) {
        return '<span title="Consume (PSI)" style="color:var(--blue)">↓ ' + fmtCoef(n.inputCoeff) + '</span>'
          + ' <span style="color:var(--text3)">·</span> '
          + '<span title="Produce (PSH)" style="color:#48c778">↑ ' + fmtCoef(n.coefficient) + '</span>'
          + uom;
      }
      return fmtCoef(hasIn ? n.inputCoeff : n.coefficient) + uom;
    }

    function log(el, cls, msg) {
      el.innerHTML += '<div class="' + cls + '">' + new Date().toLocaleTimeString() + ' · ' + escH(msg) + '</div>';
      el.scrollTop = el.scrollHeight;
    }


