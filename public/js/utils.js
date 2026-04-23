    /* ═══════════════════════════════════════════════════════════════
       TIMER UTILITY
       ═══════════════════════════════════════════════════════════════ */
    function fmtDuration(ms) {
      if (ms < 60000) return Math.round(ms / 1000) + ' s';
      var m = Math.floor(ms / 60000);
      var s = Math.round((ms % 60000) / 1000);
      return m + ' min' + (s > 0 ? ' ' + s + ' s' : '');
    }

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
       Format: ↓ 2.5 (PSI) · ↑ 1.0 (PSH) KG
       PSI = consumed component coefficient, PSH = produced output coefficient. */
    function fmtDualCoef(n) {
      var hasIn = n.inputCoeff !== '' && n.inputCoeff != null;
      var hasOut = n.coefficient !== '' && n.coefficient != null;
      var uom = n.uomid ? ' <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">' + escH(n.uomid) + '</span>' : '';
      var lbl = '<span style="font-size:10px;opacity:.65;font-weight:600">';
      if (hasIn && hasOut) {
        return '<span style="color:var(--blue)">↓ ' + fmtCoef(n.inputCoeff) + ' ' + lbl + '(PSI)</span></span>'
          + ' <span style="color:var(--text3)">·</span> '
          + '<span style="color:#48c778">↑ ' + fmtCoef(n.coefficient) + ' ' + lbl + '(PSH)</span></span>'
          + uom;
      }
      if (hasIn) {
        return '<span style="color:var(--blue)">↓ ' + fmtCoef(n.inputCoeff) + ' ' + lbl + '(PSI)</span></span>' + uom;
      }
      if (hasOut) {
        return '<span style="color:#48c778">↑ ' + fmtCoef(n.coefficient) + ' ' + lbl + '(PSH)</span></span>' + uom;
      }
      return uom;
    }

    function log(el, cls, msg) {
      el.innerHTML += '<div class="' + cls + '">' + new Date().toLocaleTimeString() + ' · ' + escH(msg) + '</div>';
      el.scrollTop = el.scrollHeight;
    }


