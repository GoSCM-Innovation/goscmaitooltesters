/* ═══════════════════════════════════════════════════════════════
   GLOSARIO.JS — Guía de lectura del Excel para Production Analyzer
   y Supply Network Analyzer. Audiencia: consultor SAP IBP.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var _currentModule = 'pa';

  /* ─── MICRO-HELPERS ─────────────────────────────────────────── */
  function h(tag, cls, content) {
    return '<' + tag + (cls ? ' class="' + cls + '"' : '') + '>' + content + '</' + tag + '>';
  }
  function badge(sev) {
    var map = {
      red:    '<span class="glos-badge glos-red">⛔ Alerta</span>',
      yellow: '<span class="glos-badge glos-yellow">⚠ Advertencia</span>',
      ok:     '<span class="glos-badge glos-ok">✅ OK</span>',
      info:   '<span class="glos-badge glos-info">ℹ Info</span>'
    };
    return map[sev] || '';
  }
  function catBadge(cat) {
    var map = {
      finished: '<span class="glos-cat glos-cat-finished">Terminado</span>',
      semi:     '<span class="glos-cat glos-cat-semi">Semiterminado</span>',
      rawmat:   '<span class="glos-cat glos-cat-rawmat">Mat. Prima</span>',
      trading:  '<span class="glos-cat glos-cat-trading">Mercadería</span>',
      all:      '<span class="glos-cat glos-cat-all">Todos</span>'
    };
    return (cat || []).map(function (c) { return map[c] || ''; }).join(' ');
  }

  function obsTable(rows) {
    var header = '<tr><th>Texto en Excel</th><th>Estado</th><th>Aplica a</th><th>Por qué aparece</th><th>Qué revisar en IBP</th></tr>';
    var body = rows.map(function (r) {
      return '<tr class="glos-obs-' + r[1] + '">' +
        '<td><code class="glos-obs-code">' + r[0] + '</code></td>' +
        '<td>' + badge(r[1]) + '</td>' +
        '<td>' + catBadge(r[2]) + '</td>' +
        '<td class="glos-obs-cause">' + r[3] + '</td>' +
        '<td class="glos-obs-action">' + r[4] + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="glos-table-wrap"><table class="glos-obs-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function colTable(rows) {
    var header = '<tr><th>Columna</th><th>Qué significa</th></tr>';
    var body = rows.map(function (r) {
      return '<tr><td><strong class="glos-col-name">' + r[0] + '</strong></td><td>' + r[1] + '</td></tr>';
    }).join('');
    return '<div class="glos-table-wrap"><table class="glos-col-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function netStatusTable(rows) {
    var header = '<tr><th>Estado de la Red</th><th>Estado</th><th>Aplica a</th><th>Significado</th></tr>';
    var body = rows.map(function (r) {
      return '<tr class="glos-obs-' + r[1] + '">' +
        '<td><code class="glos-obs-code">' + r[0] + '</code></td>' +
        '<td>' + badge(r[1]) + '</td>' +
        '<td>' + catBadge(r[2]) + '</td>' +
        '<td class="glos-obs-cause">' + r[3] + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="glos-table-wrap"><table class="glos-obs-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function section(id, icon, title, content) {
    return '<section class="glos-section" id="' + id + '">' +
      '<h2 class="glos-section-title">' + icon + ' ' + title + '</h2>' +
      content + '</section>';
  }

  function sub(title, content) {
    return '<div class="glos-sub"><h3 class="glos-sub-title">' + title + '</h3>' + content + '</div>';
  }

  function callout(type, text) {
    return '<div class="glos-callout glos-callout-' + type + '">' + text + '</div>';
  }

  function p(text) { return '<p class="glos-p">' + text + '</p>'; }

  /* ─── LEGEND COMUN ──────────────────────────────────────────── */
  function legendEstados() {
    return sub('Estados del Excel',
      '<div class="glos-legend">' +
        '<div class="glos-legend-item">' + badge('red') + '<span>Problema crítico que bloquea o distorsiona la planificación en IBP. Requiere acción antes de ejecutar cualquier plan.</span></div>' +
        '<div class="glos-legend-item">' + badge('yellow') + '<span>Dato incompleto o sospechoso que conviene revisar. No bloquea IBP pero puede generar resultados incorrectos.</span></div>' +
        '<div class="glos-legend-item">' + badge('ok') + '<span>Todas las validaciones aplicables pasaron. El registro está correctamente configurado.</span></div>' +
        '<div class="glos-legend-item"><span class="glos-badge glos-dash">—</span><span>El dato no aplica para este registro (N/A). Por ejemplo, un insumo no tiene PLEADTIME.</span></div>' +
      '</div>'
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     PRODUCTION ANALYZER — SECCIONES
     ═══════════════════════════════════════════════════════════════ */

  var PA_SECTIONS = [

    /* ── INTRO ── */
    {
      id: 'pa-intro', icon: '📋', title: 'Introducción',
      content: function () {
        return p('El <strong>Production Analyzer</strong> analiza la configuración de producción en SAP IBP y exporta un Excel con hasta 8 hojas. Cada hoja examina una entidad distinta desde el punto de vista de su completitud y consistencia para la planificación.') +
          p('El análisis cruza diez entidades: Production Source Header (PSH), Production Source Item (PSI), Production Source Resource (PSR), Resource, Resource Location, Product, Location, Location Product y Location Source. Los hallazgos se expresan siempre en términos de qué falta o qué está mal configurado respecto a lo que IBP necesita para planificar correctamente.') +
          legendEstados() +
          callout('info', '<strong>Importante:</strong> Los resultados dependen de la categorización de tipos de material (MATTYPEID). Un mismo hallazgo puede ser ⛔ Alerta para un Producto Terminado y no aplicar para una Materia Prima. Ver sección <em>Tipos de Material</em>.');
      }
    },

    /* ── RESUMEN ── */
    {
      id: 'pa-resumen', icon: '📊', title: 'Hoja: Resumen',
      content: function () {
        return p('Una fila por cada hoja analizada. Permite ver de un vistazo la salud general de la configuración.') +
          colTable([
            ['#', 'Número de hoja en el libro Excel.'],
            ['Hoja', 'Nombre de la hoja analizada (Product, Location, Resource, etc.).'],
            ['Total registros', 'Cantidad de filas procesadas. Ej: 350 = se analizaron 350 productos.'],
            ['Alertas 🔴', 'Registros con problema crítico que bloquea o distorsiona la planificación.'],
            ['Advertencias 🟡', 'Registros con dato incompleto o sospechoso que conviene revisar.'],
            ['OK ✅', 'Registros sin hallazgos — todas las validaciones aplicables pasaron.'],
            ['% Consistencia', 'Porcentaje de registros OK sobre el total. Fórmula: OK / Total × 100. Una hoja con 85% de consistencia tiene el 15% restante con hallazgos.']
          ]) +
          callout('tip', '<strong>Lectura recomendada:</strong> Comienza por la hoja con menor % de Consistencia y mayor cantidad de Alertas 🔴. Eso indica dónde están los problemas más críticos para la planificación.');
      }
    },

    /* ── PRODUCT ── */
    {
      id: 'pa-product', icon: '🧪', title: 'Hoja: Product',
      content: function () {
        return p('Una fila por cada producto del maestro de materiales de SAP IBP. Esta hoja valida si cada producto tiene la configuración mínima necesaria para que IBP lo pueda planificar correctamente.') +
          sub('Columnas clave', colTable([
            ['Estado', '⛔ Alerta / ⚠ Advertencia / ✅ OK. El peor hallazgo del producto determina el color.'],
            ['Observacion', 'Texto detallado de todos los hallazgos encontrados, separados por |. Si el estado es OK, describe qué validaciones pasaron.'],
            ['PRDID', 'Código único del producto en SAP IBP.'],
            ['MATTYPEID', 'Tipo de material SAP. Determina qué validaciones aplican. Es el insumo principal para la categorización.'],
            ['En Location Product', 'Si/No — ¿El producto está habilitado en al menos una ubicación? Sin esto IBP ignora completamente el producto.'],
            ['En PSH (output)', 'Si/No — ¿El producto tiene fuente de producción propia (SOURCETYPE=P)?'],
            ['En PSI (componente)', 'Si/No — ¿Este producto es ingrediente en el BOM de algún otro producto?'],
            ['En Location Source', 'Si/No — ¿Tiene arcos de transferencia entre ubicaciones?'],
            ['# Opciones prod.', 'Cuántas recetas distintas (SOURCEIDs) producen este producto. Más de una implica multi-sourcing — verificar cuotas (PRATIO).'],
            ['# Plantas prod.', 'Número de plantas distintas donde se fabrica.'],
            ['# Componentes BOM', 'Total de ingredientes PSI definidos en todas sus recetas.'],
            ['# Recursos prod.', 'Máquinas/líneas asignadas vía PSR.'],
            ['# Plantas sin cobertura', 'Plantas que consumen este producto como insumo pero no tienen arco de abastecimiento configurado. Si > 0: falta Location Source. 🔴 crítico.'],
            ['# Productos que lo usan', 'Cuántos otros productos distintos requieren este material como componente.']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['Sin cobertura en Location Product', 'red', ['all'], 'El producto no está registrado en ninguna ubicación en Location Product.', 'Habilitar el producto en Location Product para cada planta y/o DC donde se requiera. Sin esto IBP lo ignora en planificación de demanda y producción.'],
            ['Sin fuente de producción propia (PSH)', 'red', ['finished', 'semi'], 'No existe ningún Production Source Header activo con SOURCETYPE=P para este producto.', 'Crear o activar la receta de producción en IBP (PSH con SOURCETYPE=P). Verificar que el Planning Area y Version sean correctos.'],
            ['PSH sin componentes PSI', 'red', ['finished', 'semi'], 'La receta de producción existe pero no tiene ingredientes definidos — BOM vacío.', 'Revisar el BOM en IBP y cargar los componentes (PSI) necesarios en la receta del SOURCEID indicado.'],
            ['PSH sin recursos PSR asignados', 'red', ['finished', 'semi'], 'La receta existe pero no tiene ninguna máquina o línea asignada en Production Source Resource.', 'Asignar al menos un recurso productivo (RESID) al SOURCEID vía Production Source Resource en IBP.'],
            ['Planta productora no es origen en Location Source', 'red', ['finished'], 'El producto se fabrica en la planta pero no hay arco de Location Source declarando esa planta como LOCFR.', 'Crear arco en Location Source con la planta productora como LOCFR para distribuir el producto hacia DCs o clientes.'],
            ['Sin arco de abastecimiento hacia: X, Y', 'red', ['rawmat'], 'El insumo se consume en las plantas indicadas pero no hay Location Source que lo lleve ahí.', 'Crear arco(s) en Location Source con el proveedor como LOCFR y la planta consumidora como LOCID para cada insumo sin cobertura.'],
            ['Sin arco de abastecimiento (no registrado en Location Source)', 'red', ['rawmat'], 'El insumo no tiene ningún arco de transferencia en Location Source.', 'Configurar Location Source con el proveedor o planta origen como LOCFR hacia la(s) planta(s) consumidora(s).'],
            ['Sin arcos en Location Source', 'red', ['trading'], 'El producto de tipo Mercadería no tiene arcos de distribución en Location Source.', 'Configurar Location Source con el proveedor/origen del producto para que IBP pueda planificar su flujo.'],
            ['Semiterminado sin consumo PSI en planta productora ni transferencia configurada', 'red', ['semi'], 'El semiterminado se produce pero nadie lo consume ni se transfiere a otra planta — producción sin destino.', 'Verificar que el semiterminado esté en el BOM (PSI) de algún terminado en la misma planta, o configurar Location Source para transferirlo al punto de consumo.'],
            ['Transfiere a N destino(s) sin consumo PSI en ningún punto: X', 'red', ['semi'], 'El semiterminado se transfiere a destinos donde no es consumido como ingrediente, y tampoco se usa en la planta de origen.', 'Agregar el semiterminado como componente PSI en la receta de la planta destino, o eliminar el arco de transferencia si es un error de configuración.'],
            ['Transfiere a N destino(s) sin consumo PSI (sí consume en planta origen): X', 'yellow', ['semi'], 'El semiterminado se consume localmente en la planta de origen, pero también se transfiere a destinos donde no se usa como ingrediente.', 'Verificar si la transferencia a los destinos indicados es intencional. Si no, eliminar el arco de Location Source hacia esas ubicaciones.'],
            ['PLEADTIME ausente o cero en N SOURCEID(s)', 'red', ['finished', 'semi'], 'El lead time de producción es 0 o está vacío en la(s) receta(s). IBP planifica como si la producción fuera instantánea.', 'Ingresar el PLEADTIME real en días en el Production Source Header de IBP para cada SOURCEID afectado. ⛔ para Terminado, ⚠ para Semiterminado.'],
            ['OUTPUTCOEFFICIENT ausente o cero en N SOURCEID(s)', 'red', ['finished', 'semi'], 'El coeficiente de salida de la receta es 0 o está vacío. IBP no sabe cuántas unidades produce cada corrida.', 'Revisar y corregir el OUTPUTCOEFFICIENT en el Production Source Header. ⛔ para Terminado, ⚠ para Semiterminado.'],
            ['Configurado solo como co-producto (SOURCETYPE=C) — falta PSH primario', 'yellow', ['finished', 'semi'], 'El producto aparece en recetas como subproducto (C) pero nunca como output principal (P).', 'Verificar si es intencional (es co-producto puro de otro proceso) o si falta crear la receta principal con SOURCETYPE=P.'],
            ['Tiene BOM de fabricación (PSH) — verificar categorización', 'yellow', ['rawmat', 'trading'], 'El producto tiene una receta de producción pero está categorizado como Mat. Prima o Mercadería, que no deberían fabricarse.', 'Revisar si la categoría del MATTYPEID es correcta, o si el PSH es un error de configuración en IBP.'],
            ['No consumido como componente en ningún BOM', 'yellow', ['semi', 'rawmat'], 'El producto existe como Semiterminado o Mat. Prima pero no aparece como ingrediente en ninguna receta PSI.', 'Verificar si el material todavía está vigente y si está correctamente vinculado en el BOM de los productos que lo consumen.'],
            ['TLEADTIME = 0 en todos los arcos de Location Source', 'yellow', ['all'], 'Todos los arcos de transferencia de este producto tienen lead time = 0. IBP planifica transferencias instantáneas.', 'Revisar y completar el TLEADTIME (en días) en los arcos de Location Source para este producto.'],
            ['Sin categoría [X] — sin hallazgos en modo permisivo', 'yellow', ['all'], 'El MATTYPEID del producto no tiene categoría asignada — se aplican reglas mínimas y los hallazgos reales pueden estar ocultos.', 'Asignar el MATTYPEID a una categoría (Terminado, Semiterminado, Mat. Prima, Mercadería) antes de interpretar los resultados de este producto.']
          ]));
      }
    },

    /* ── LOCATION ── */
    {
      id: 'pa-location', icon: '🏭', title: 'Hoja: Location',
      content: function () {
        return p('Una fila por cada ubicación (planta, DC, proveedor, etc.) detectada en los datos. El análisis infiere el <strong>rol real</strong> de cada ubicación según su comportamiento en los datos, independientemente del campo LOCTYPE de IBP.') +
          sub('Roles inferidos', colTable([
            ['Planta de producción', 'Tiene al menos un Production Source Header (PSH) asociado — fabrica productos.'],
            ['Proveedor', 'Aparece como LOCFR en Location Source enviando productos que se consumen como PSI en la planta destino — abastece insumos.'],
            ['Nodo de transferencia', 'Aparece como LOCFR en Location Source enviando productos que NO se consumen como PSI en el destino — redistribuye o distribuye.'],
            ['Nodo receptor', 'Solo aparece como LOCID (destino) en Location Source, sin producción propia ni envíos salientes — solo recibe.'],
            ['Nodo de recursos', 'Tiene recursos asignados en Resource Location pero sin producción ni transferencias activas.'],
            ['Sin actividad', 'Existe en el maestro de ubicaciones pero no aparece en ningún otro dato — ubicación inactiva o huérfana.']
          ])) +
          sub('Columnas clave', colTable([
            ['LOCID', 'Código único de la ubicación en SAP IBP.'],
            ['LOCTYPE', 'Tipo de ubicación del maestro (ej: 1010 = planta). Informativo — el rol real se infiere del comportamiento.'],
            ['Rol(es) inferido(s)', 'Uno o más roles detectados según participación real en PSH, Location Source y Customer Source.'],
            ['En Location Product', 'Si/No — ¿La ubicación está habilitada en Location Product? Sin esto IBP no planifica en esa ubicación.'],
            ['# BOMs sin PSI', 'SOURCEIDs de esta planta sin componentes PSI. Un BOM vacío impide planificar compra de insumos.'],
            ['# BOMs sin PSR', 'SOURCEIDs sin recurso asignado. Sin recurso IBP no puede planificar capacidad.'],
            ['# Componentes sin cobertura LocSrc', 'Insumos consumidos en esta planta que no tienen arco de abastecimiento configurado. Crítico para planificación de compras.'],
            ['# Recursos ociosos', 'Recursos asignados en Resource Location pero que no aparecen en ningún PSR activo — configuración sin uso.']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['N SOURCEID(s) sin PSI', 'red', ['finished', 'semi'], 'N recetas de producción de esta planta no tienen ingredientes definidos (BOM vacío). IBP no puede planificar compra de insumos para esas recetas.', 'Revisar y completar el BOM (PSI) de los SOURCEIDs indicados en la hoja Prod Source Header.'],
            ['N SOURCEID(s) sin PSR', 'red', ['finished', 'semi'], 'N recetas no tienen ningún recurso productivo asignado. IBP no evalúa capacidad para esas recetas.', 'Asignar un recurso (RESID) a cada SOURCEID indicado vía Production Source Resource en IBP.'],
            ['N componente(s) sin arco de abastecimiento', 'red', ['finished', 'semi'], 'N insumos que se consumen en esta planta no tienen arco en Location Source que los traiga hasta aquí.', 'Crear arcos en Location Source para los componentes indicados, con el proveedor como LOCFR y esta planta como LOCID.'],
            ['N SOURCEID(s) con PLEADTIME = 0', 'red', ['finished', 'semi'], 'N recetas tienen lead time de producción cero o vacío. IBP planifica esas producciones como instantáneas.', 'Ingresar el PLEADTIME real (en días) en el Production Source Header de cada SOURCEID afectado.'],
            ['N recurso(s) asignados sin uso en PSR', 'yellow', ['all'], 'N recursos tienen Resource Location configurado en esta planta pero no participan en ninguna receta activa.', 'Verificar si los recursos son obsoletos y deben eliminarse de Resource Location, o si falta asignarlos a algún PSR.'],
            ['N producto(s) Mat. Prima/Mercadería con BOM de fabricación en esta planta — verificar categorización', 'yellow', ['rawmat', 'trading'], 'Productos categorizados como Mat. Prima o Mercadería tienen PSH en esta planta — posible error de categorización.', 'Revisar la categoría del MATTYPEID o verificar si el PSH es un error de configuración en IBP.'],
            ['N producto(s) abastecidos sin consumo PSI en destino', 'yellow', ['rawmat', 'semi'], 'Esta ubicación envía productos hacia plantas donde no son consumidos como ingrediente en ninguna receta.', 'Verificar si el arco de Location Source es correcto o si falta agregar el componente en el BOM del destino.'],
            ['N producto(s) sin Location Product en planta destino', 'red', ['all'], 'Esta ubicación envía productos hacia plantas que no los tienen habilitados en Location Product — IBP no puede planificarlos ahí.', 'Habilitar los productos indicados en Location Product para la planta destino.'],
            ['N componente(s) Mat. Prima/Semiterminado transferido(s) a planta sin consumo PSI — verificar BOM', 'red', ['rawmat', 'semi'], 'Esta ubicación envía componentes a una planta donde ninguna receta los consume. El insumo llega sin destino productivo.', 'Revisar el BOM de la planta destino y agregar el componente como PSI, o eliminar el arco de Location Source si es un error.'],
            ['N componente(s) Mat. Prima/Semiterminado transferido(s) a nodo sin producción', 'yellow', ['rawmat', 'semi'], 'Esta ubicación envía componentes a una ubicación que no tiene producción — posible nodo intermedio o configuración incompleta.', 'Verificar si el nodo destino es un punto de cross-docking o si el arco de transferencia es un error.'],
            ['N producto(s) sin categoría transferidos sin consumo PSI en destino', 'yellow', ['all'], 'Productos sin categoría asignada se transfieren a destinos donde no se usan en ningún BOM.', 'Asignar categoría al MATTYPEID de los productos indicados para que el análisis pueda aplicar las reglas correctas.'],
            ['N producto(s) recibidos sin cobertura en Location Product', 'red', ['all'], 'Esta ubicación recibe productos por Location Source pero no los tiene habilitados en Location Product — IBP no puede planificarlos aquí.', 'Habilitar los productos indicados en Location Product para esta ubicación.'],
            ['N componente(s) Mat. Prima/Semiterminado recibidos en ubicación sin producción asociada', 'yellow', ['rawmat', 'semi'], 'Esta ubicación recibe insumos o semiterminados pero no tiene ninguna receta de producción — los insumos llegan sin uso productivo declarado.', 'Verificar si esta ubicación debería tener producción configurada o si los arcos de abastecimiento son incorrectos.'],
            ['Ubicación en maestro sin actividad en otros datos', 'info', ['all'], 'La ubicación existe en el maestro pero no aparece en ninguna entidad de red (PSH, Location Source, Customer Source, Location Product).', 'Verificar si la ubicación es obsoleta y puede depurarse del maestro, o si falta configurar su participación en la red.']
          ]));
      }
    },

    /* ── RESOURCE ── */
    {
      id: 'pa-resource', icon: '⚙️', title: 'Hoja: Resource',
      content: function () {
        return p('Una fila por cada recurso productivo (máquina, línea, horno, etc.) del maestro de recursos de SAP IBP. Valida que cada recurso tenga planta asignada y esté en uso en alguna receta.') +
          sub('Columnas clave', colTable([
            ['RESID', 'Código único del recurso en SAP IBP. Ej: LINEA-01, HORNO-A.'],
            ['RESDESCR', 'Descripción del recurso del maestro.'],
            ['En PSR', 'Si/No — ¿Este recurso está asignado a al menos una fuente de producción en Production Source Resource? Si No, IBP nunca lo usa para planificar capacidad.'],
            ['En Resource Location', 'Si/No — ¿Este recurso tiene al menos una planta configurada en Resource Location? Si No, IBP no sabe dónde opera físicamente.'],
            ['# Plantas asignadas', 'Número de plantas donde este recurso tiene Resource Location configurado.'],
            ['# Fuentes prod.', 'Número de SOURCEIDs a los que está asignado este recurso vía PSR.'],
            ['# Productos que fabrica', 'Número de productos distintos que este recurso ayuda a producir.']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['Recurso huérfano: sin uso en producción ni planta asignada', 'red', ['all'], 'El recurso existe en el maestro pero no aparece ni en PSR ni en Resource Location — completamente desconectado de la configuración productiva.', 'Verificar si el recurso es obsoleto y puede eliminarse del maestro, o si falta asignarlo a recetas (PSR) y a su planta (Resource Location).'],
            ['Sin uso en producción (no aparece en PSR)', 'yellow', ['all'], 'El recurso tiene planta asignada en Resource Location pero ninguna receta lo usa. IBP tiene el recurso ubicado pero nunca lo considera para planificar capacidad.', 'Asignar el recurso a al menos una receta (SOURCEID) vía Production Source Resource, o verificar si es obsoleto.'],
            ['Sin planta asignada en Resource Location', 'yellow', ['all'], 'El recurso participa en recetas (PSR) pero no tiene planta configurada en Resource Location. IBP no sabe en qué planta opera físicamente.', 'Agregar la combinación RESID+LOCID correspondiente en Resource Location en IBP.'],
            ['En uso en PSR y con planta asignada en Resource Location', 'ok', ['all'], 'El recurso está activo en al menos una receta y tiene su planta correctamente configurada.', 'Sin acción requerida.']
          ]));
      }
    },

    /* ── RESOURCE LOCATION ── */
    {
      id: 'pa-resloc', icon: '📍', title: 'Hoja: Resource Location',
      content: function () {
        return p('Una fila por cada combinación Recurso + Planta configurada en Resource Location. Valida si cada combinación está siendo efectivamente usada en alguna receta de producción.') +
          sub('Columnas clave', colTable([
            ['RESID', 'Código del recurso productivo.'],
            ['LOCID', 'Código de la planta donde está configurado este recurso.'],
            ['RESID+LOCID usado en PSR', 'Si/No — ¿Esta combinación aparece en al menos un Production Source Resource activo? Si No, el recurso está en el maestro de esa planta pero no participa en ninguna receta.']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['Recurso activo en PSR para esta planta', 'ok', ['all'], 'La combinación RESID+LOCID está en uso en al menos una receta de producción en esa planta.', 'Sin acción requerida.'],
            ['Recurso asignado a planta pero sin uso en PSR para esta planta', 'yellow', ['all'], 'El recurso está en el maestro de la planta (Resource Location) pero ninguna receta activa lo usa en esa planta. IBP lo conoce pero nunca lo considera para planificación de capacidad en ese sitio.', 'Verificar si el recurso es obsoleto para esa planta y puede eliminarse de Resource Location, o si falta asignarlo a alguna receta (PSR) en esa planta.']
          ]));
      }
    },

    /* ── PROD SOURCE HEADER ── */
    {
      id: 'pa-psh', icon: '📄', title: 'Hoja: Prod Source Header',
      content: function () {
        return p('Una fila por cada fuente de producción (SOURCEID) en SAP IBP. Cada SOURCEID representa una receta que transforma insumos en un producto terminado o semiterminado en una planta específica.') +
          sub('Columnas clave', colTable([
            ['SOURCEID', 'Identificador único de la receta de producción.'],
            ['PRDID output', 'Producto que produce esta receta (output principal).'],
            ['LOCID planta', 'Planta donde se ejecuta esta producción.'],
            ['SOURCETYPE(s)', 'P = fuente primaria (output principal) | C = co-producto (subproducto del mismo proceso). Una receta puede tener P y C simultáneamente.'],
            ['PLEADTIME', 'Lead time de producción en días. 0 o vacío → IBP planifica producción instantánea (⛔).'],
            ['OUTPUTCOEFFICIENT', 'Unidades del producto terminado por corrida de producción. Afecta el cálculo de cuántas corridas se necesitan para cubrir la demanda.'],
            ['PRATIO', 'Proporción asignada a esta fuente cuando hay múltiples SOURCEIDs para el mismo producto+planta. IBP usa este valor para distribuir la demanda entre recetas. Vacío = fuente única o sin cuota definida.'],
            ['PRDID+LOCID en Location Product', 'Si/No — ¿Esta combinación producto+planta está habilitada en Location Product? Sin esto la receta existe pero IBP no la activa.'],
            ['# Componentes PSI', 'Ingredientes definidos en el BOM. 0 = BOM vacío → IBP no planifica compra de insumos.'],
            ['# Recursos PSR', 'Recursos asignados a esta receta. 0 = sin capacidad modelada.'],
            ['# Componentes con alternativa', 'Ingredientes marcados como material de reemplazo (ISALTITEM=X). Útil para conocer la flexibilidad de sustitución del BOM.']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['BOM vacío: sin componentes PSI', 'red', ['finished', 'semi'], 'La receta no tiene ningún ingrediente definido. IBP no genera demanda de insumos para este producto.', 'Cargar los componentes (PSI) necesarios en el BOM del SOURCEID indicado en IBP.'],
            ['PLEADTIME = 0 o no definido', 'red', ['finished', 'semi'], 'El lead time de producción es cero o está vacío. IBP planifica como si el producto se fabricara de forma instantánea, lo que genera fechas de entrega incorrectas.', 'Ingresar el lead time real de producción (en días) en el campo PLEADTIME del Production Source Header en IBP.'],
            ['PRDID+LOCID sin cobertura en Location Product', 'red', ['all'], 'La combinación producto+planta de esta receta no está habilitada en Location Product. La receta existe pero IBP no la usa para planificar.', 'Habilitar la combinación PRDID+LOCID en Location Product en IBP.'],
            ['Sin recursos PSR asignados', 'red', ['finished', 'semi'], 'La receta no tiene ningún recurso productivo asignado. IBP no puede evaluar restricciones de capacidad para esta receta.', 'Asignar al menos un recurso (RESID) a este SOURCEID vía Production Source Resource en IBP.'],
            ['Sin registro SOURCETYPE=P', 'yellow', ['finished', 'semi'], 'La receta no tiene un registro con SOURCETYPE=P — solo tiene co-productos (C). No tiene un output principal definido.', 'Revisar la configuración del SOURCEID y agregar el registro con SOURCETYPE=P para el producto principal.'],
            ['Múltiples SOURCEIDs para mismo PRDID+LOCID — verificar cuotas', 'yellow', ['all'], 'Hay más de una receta para el mismo producto en la misma planta. IBP necesita PRATIO definido para distribuir correctamente la demanda entre las fuentes.', 'Revisar que los SOURCEIDs indicados tengan PRATIO definido y que la suma de cuotas sea coherente con la estrategia de producción.'],
            ['BOM con componentes PSI | Lead time definido | Habilitado en LP | SOURCETYPE=P presente | Recursos PSR asignados', 'ok', ['all'], 'La receta está completamente configurada.', 'Sin acción requerida.']
          ]));
      }
    },

    /* ── PROD SOURCE ITEM ── */
    {
      id: 'pa-psi', icon: '🧩', title: 'Hoja: Prod Source Item',
      content: function () {
        return p('Una fila por cada componente (ingrediente) en el BOM de una receta de producción. Valida que cada ingrediente tenga coeficiente definido y arco de abastecimiento configurado.') +
          sub('Columnas clave', colTable([
            ['SOURCEID', 'Receta a la que pertenece este componente.'],
            ['PRDID output', 'Producto que fabrica esa receta.'],
            ['PRDID componente', 'Material que se consume como ingrediente en esta receta.'],
            ['COMPONENTCOEFFICIENT', 'Unidades del componente consumidas por unidad de producto terminado. Si es 0, IBP no planifica la compra de este insumo.'],
            ['Tipo componente', 'Semielaborado = se fabrica en la misma planta (tiene PSH propio ahí) | Insumo = debe llegar desde fuera vía Location Source.'],
            ['PRDID comp+LOCID en Location Product', 'Si/No — ¿El componente está habilitado en Location Product para esta planta? Sin esto IBP no puede planificar su consumo aquí.'],
            ['En Location Source (insumo)', 'Si/No — ¿Hay arco de Location Source que traiga este insumo a esta planta? Muestra N/A para semielaborados (se producen localmente).'],
            ['Material de reemplazo (ISALTITEM)', 'X = este componente puede sustituir a otro material alternativo. Vacío = componente principal.']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['Coeficiente = 0 o no definido', 'red', ['all'], 'El coeficiente de consumo del componente es cero o está vacío. IBP no planifica la compra de este insumo aunque esté en el BOM.', 'Revisar y corregir el COMPONENTCOEFFICIENT en el Production Source Item en IBP.'],
            ['Insumo sin arco de abastecimiento en Location Source', 'red', ['all'], 'El componente es un insumo externo (no semielaborado) pero no hay ningún arco en Location Source que lo traiga a esta planta.', 'Crear arco en Location Source con el proveedor como LOCFR y esta planta como LOCID para el componente indicado.'],
            ['Componente no habilitado en Location Product para esta planta', 'red', ['all'], 'El componente no está registrado en Location Product para la planta donde se consume. IBP no puede planificar su consumo aquí.', 'Habilitar la combinación componente+planta en Location Product en IBP.'],
            ['SOURCEID no encontrado en PSH', 'yellow', ['all'], 'El SOURCEID de este componente no existe en el Production Source Header descargado. Puede ser un dato huérfano o un filtro de datos que excluye el PSH padre.', 'Verificar que el PSH del SOURCEID indicado exista y esté activo en IBP con el mismo Planning Area y Version.'],
            ['Material de reemplazo sin registro en Item Sub', 'yellow', ['all'], 'El componente está marcado como ISALTITEM=X (sustituto) pero no tiene registro en Production Source Item Sub que lo vincule al material que reemplaza.', 'Completar la configuración del sustituto en Production Source Item Sub en IBP.'],
            ['Semiterminado: trazabilidad en PSH', 'ok', ['semi'], 'El componente es un semiterminado que se fabrica en esta misma planta — se rastrea vía su propio PSH.', 'Sin acción requerida. No requiere arco de Location Source porque se produce localmente.'],
            ['SOURCEID válido en PSH | Coeficiente definido | Con arco de abastecimiento en Location Source | Habilitado en Location Product', 'ok', ['all'], 'El componente está correctamente configurado.', 'Sin acción requerida.']
          ]));
      }
    },

    /* ── PROD SOURCE RESOURCE ── */
    {
      id: 'pa-psr', icon: '🔧', title: 'Hoja: Prod Source Resource',
      content: function () {
        return p('Una fila por cada asignación Recurso + Receta (RESID + SOURCEID) en Production Source Resource. Valida que el recurso asignado a una receta también tenga configuración de planta en Resource Location.') +
          sub('Columnas clave', colTable([
            ['SOURCEID', 'Receta de producción a la que está asignado el recurso.'],
            ['PRDID output', 'Producto que fabrica esa receta.'],
            ['LOCID planta', 'Planta donde opera la receta.'],
            ['RESID', 'Recurso asignado a esta receta.'],
            ['RESID+LOCID en Resource Location', 'Si/No — ¿Esta combinación recurso+planta existe en Resource Location? Si No, hay inconsistencia: el recurso opera en una receta de esa planta pero no figura en el maestro de esa planta.'],
            ['# Plantas con este recurso asignado', 'Número de plantas donde el recurso tiene Resource Location configurado.']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['Recurso en producción sin asignación en Resource Location para planta X', 'yellow', ['all'], 'El recurso está asignado a una receta de la planta X pero no tiene Resource Location configurado para esa planta. IBP registra el uso del recurso en la receta pero no lo reconoce formalmente en ese sitio.', 'Agregar la combinación RESID+LOCID en Resource Location en IBP para formalizar la asignación del recurso a esa planta.'],
            ['SOURCEID no encontrado en PSH', 'yellow', ['all'], 'El SOURCEID del PSR no existe en el Production Source Header — dato huérfano.', 'Verificar que el PSH del SOURCEID exista y esté activo en IBP.'],
            ['Recurso X asignado en Resource Location para planta Y | Asociado a SOURCEID Z', 'ok', ['all'], 'La asignación recurso+planta es consistente entre PSR y Resource Location.', 'Sin acción requerida.']
          ]));
      }
    },

    /* ── TIPOS EXCLUIDOS ── */
    {
      id: 'pa-excluidos', icon: '🚫', title: 'Hoja: Tipos Excluidos',
      content: function () {
        return p('Solo aparece si el usuario excluyó algún tipo de material antes de ejecutar el análisis. Una fila por cada MATTYPEID excluido. Aunque un tipo esté excluido del análisis principal, sus productos siguen siendo validados <em>en contexto</em> si aparecen como componentes en el BOM de productos incluidos.') +
          sub('Columnas clave', colTable([
            ['MATTYPEID', 'Código del tipo de material excluido.'],
            ['# Productos', 'Cuántos productos del maestro tienen este tipo.'],
            ['Aparece como componente PSI en # SOURCEIDs', 'Cuántas recetas distintas usan productos de este tipo como ingrediente. Aunque el tipo esté excluido, se valida su configuración de abastecimiento cuando es componente.'],
            ['Componentes sin cobertura LocSrc', 'Cuántas combinaciones componente+planta (de este tipo excluido) no tienen arco de Location Source. Si > 0, hay insumos sin ruta de llegada a la planta que los consume.'],
            ['Observacion', 'Texto descriptivo del estado: indica si el tipo aparece como componente y si hay brechas de abastecimiento.']
          ])) +
          callout('info', 'Un tipo excluido que actúa como componente PSI de productos incluidos se valida igualmente. La exclusión solo omite el análisis principal de los productos de ese tipo, no su validación como ingrediente en otros BOMs.');
      }
    },

    /* ── TIPOS DE MATERIAL ── */
    {
      id: 'pa-mattypes', icon: '🏷️', title: 'Tipos de Material',
      content: function () {
        return p('Antes de ejecutar el análisis, el usuario asigna cada MATTYPEID a una o más categorías. Esta categorización determina <strong>qué validaciones aplican</strong> y <strong>qué severidad</strong> tienen los hallazgos. Un mismo dato faltante puede ser ⛔ Alerta para un Terminado y no generar ningún hallazgo para una Materia Prima.') +
          callout('warn', 'Si no se asigna ninguna categoría, el análisis aplica reglas en "modo permisivo" (todo se marca máximo ⚠ Advertencia) y puede ocultar problemas críticos reales. <strong>Se recomienda siempre categorizar antes de interpretar los resultados.</strong>') +
          sub('Categorías disponibles',
            '<div class="glos-mattype-grid">' +
              '<div class="glos-mattype-card">' +
                '<div class="glos-mattype-header" style="background:var(--accent)">' + catBadge(['finished']) + ' Producto Terminado</div>' +
                '<div class="glos-mattype-body">' +
                  '<p>Producto fabricado internamente. Requiere configuración completa para planificación de producción y distribución.</p>' +
                  '<ul>' +
                    '<li>Requiere BOM completo (PSH + PSI + PSR)</li>' +
                    '<li>PLEADTIME ausente o cero → ⛔ Alerta</li>' +
                    '<li>Sin Location Product → ⛔ Alerta</li>' +
                    '<li>Planta productora no es origen en Location Source → ⛔ Alerta</li>' +
                    '<li>Sin ruta a cliente → aplica detección de Ghost Nodes, Dead-ends y plantas aisladas</li>' +
                  '</ul>' +
                '</div>' +
              '</div>' +
              '<div class="glos-mattype-card">' +
                '<div class="glos-mattype-header" style="background:var(--cyan)">' + catBadge(['semi']) + ' Semiterminado</div>' +
                '<div class="glos-mattype-body">' +
                  '<p>Componente fabricado internamente que alimenta otro proceso. No llega directamente al cliente.</p>' +
                  '<ul>' +
                    '<li>Requiere BOM (PSH + PSI + PSR)</li>' +
                    '<li>PLEADTIME ausente o cero → ⚠ Advertencia (no ⛔)</li>' +
                    '<li>Consume en planta productora → ✅ OK (sin transferencia requerida)</li>' +
                    '<li>Transfiere sin consumo en destino → ⛔ Alerta</li>' +
                    '<li>No aplica detección de Ghost Nodes ni Dead-ends (no necesita llegar a cliente)</li>' +
                  '</ul>' +
                '</div>' +
              '</div>' +
              '<div class="glos-mattype-card">' +
                '<div class="glos-mattype-header" style="background:var(--green)">' + catBadge(['rawmat']) + ' Mat. Prima / Insumo</div>' +
                '<div class="glos-mattype-body">' +
                  '<p>Ítem adquirido externamente. No se fabrica ni transforma internamente.</p>' +
                  '<ul>' +
                    '<li>No requiere PSH, PSI ni PSR</li>' +
                    '<li>Debe tener arco de proveedor en Location Source → si falta = ⛔ Alerta</li>' +
                    '<li>No se evalúa PLEADTIME ni ruta a cliente</li>' +
                    '<li>Tener PSH es inusual → ⚠ Advertencia de categorización</li>' +
                  '</ul>' +
                '</div>' +
              '</div>' +
              '<div class="glos-mattype-card">' +
                '<div class="glos-mattype-header" style="background:var(--purple)">' + catBadge(['trading']) + ' Mercadería</div>' +
                '<div class="glos-mattype-body">' +
                  '<p>Producto comprado y revendido sin transformación interna.</p>' +
                  '<ul>' +
                    '<li>No requiere PSH, PSI ni PSR</li>' +
                    '<li>Debe tener Location Source definida → si falta = ⛔ Alerta</li>' +
                    '<li>Arcos LS y CS deben compartir ubicaciones → si no = ⛔ Red desconectada</li>' +
                    '<li>PLEADTIME no se evalúa</li>' +
                  '</ul>' +
                '</div>' +
              '</div>' +
            '</div>'
          ) +
          callout('info', '<strong>Multi-categoría:</strong> Un MATTYPEID puede pertenecer a más de una categoría. En ese caso, se aplica la regla más permisiva: si Terminado pide ⛔ y Semiterminado pide ⚠, el resultado es ⚠.');
      }
    }
  ];

  /* ═══════════════════════════════════════════════════════════════
     SUPPLY NETWORK ANALYZER — SECCIONES
     ═══════════════════════════════════════════════════════════════ */

  var SN_SECTIONS = [

    /* ── INTRO ── */
    {
      id: 'sn-intro', icon: '📋', title: 'Introducción',
      content: function () {
        return p('El <strong>Network Analyzer</strong> examina la red logística completa de SAP IBP: plantas, centros de distribución, clientes, arcos de transferencia (Location Source) y arcos de entrega (Customer Source). Para cada producto, construye el grafo de la red y detecta anomalías topológicas.') +
          p('El Excel de salida tiene 5 hojas orientadas a entidad: Product, Location, Customer, Location Source y Customer Source. Cada hoja analiza la entidad desde la perspectiva de conectividad, lead times y habilitación en Location Product.') +
          legendEstados() +
          callout('info', '<strong>Importante:</strong> Al igual que en Production Analyzer, los hallazgos dependen de la categorización de tipos de material. Un producto Terminado que no llega a ningún cliente genera ⛔ Alerta; el mismo problema en un Semiterminado puede no generar alerta porque no se espera que llegue directamente al cliente. Ver sección <em>Tipos de Material</em>.');
      }
    },

    /* ── PRODUCT ── */
    {
      id: 'sn-product', icon: '🧪', title: 'Hoja: Product',
      content: function () {
        return p('Una fila por cada producto presente en la red (Location Source, Customer Source, PSH o Location Product). Esta hoja es el corazón del análisis: construye el grafo completo de la red para cada producto y detecta anomalías de conectividad.') +
          sub('Columnas clave', colTable([
            ['Estado', '⛔ / ⚠ / ✅ según el hallazgo más grave encontrado.'],
            ['Observacion', 'Detalle de todos los hallazgos o, si está OK, descripción de qué validaciones pasaron.'],
            ['Estado de la Red', 'Clasificación sintética de la situación logística del producto. Ver tabla de estados más abajo.'],
            ['Health Score', 'Puntaje 0-100 calculado en base a rutas completas, anomalías y lead times. ≥80 = Healthy | ≥60 = Acceptable | ≥40 = Weak | <40 = Critical.'],
            ['Detalle Cálculo Health Score', 'Desglose paso a paso: bonificaciones (+) por rutas completas y lead times, penalizaciones (-) por Ghost Nodes, Dead-ends, ciclos y otros problemas.'],
            ['# Rutas completas', 'Cantidad de rutas de planta-a-cliente encontradas. 0 = el producto no llega a ningún cliente.'],
            ['# Ghost Nodes', 'Ubicaciones intermedias que reciben el producto pero cuyas salidas no llegan a ningún cliente.'],
            ['# Dead Ends', 'Ubicaciones que reciben el producto pero no tienen ninguna salida configurada.'],
            ['# Plantas aisladas', 'Plantas que producen el producto pero no tienen ninguna ruta hasta algún cliente.'],
            ['Multi-sourced?', 'Si/No — alguna ubicación destino recibe este producto desde más de un origen simultáneamente.'],
            ['TLT promedio (dias)', 'Promedio de TLEADTIME de todos los arcos de Location Source para este producto.'],
            ['CLT promedio (dias)', 'Promedio de CLEADTIME de todos los arcos de Customer Source para este producto.']
          ])) +
          sub('Estados de la Red', netStatusTable([
            ['Red Completa', 'ok', ['finished'], 'El producto tiene al menos una ruta completa desde una planta productora hasta un cliente. Configuración correcta.'],
            ['Sin Entrega a Cliente', 'red', ['finished'], 'El producto tiene producción (PSH) y arcos de distribución (Location Source) pero ninguno llega hasta un Customer Source — no se entrega a ningún cliente.'],
            ['Sin Distribución', 'red', ['finished'], 'El producto tiene producción (PSH) pero no hay arcos de distribución (Location Source) desde la planta. Sale de la planta sin ruta configurada.'],
            ['Distribución sin ruta completa', 'red', ['finished'], 'El producto tiene Customer Source configurado pero no existe ninguna ruta completa que conecte la producción con esa entrega al cliente.'],
            ['Solo Entrega', 'red', ['trading'], 'El producto tiene Customer Source (entrega a cliente) pero no tiene Location Source (distribución). Mercadería sin origen declarado.'],
            ['Solo Distribución', 'yellow', ['trading'], 'El producto tiene Location Source pero no tiene Customer Source — nunca llega a ningún cliente desde la red declarada.'],
            ['Solo Distribución + Entrega', 'ok', ['trading'], 'Mercadería con arcos de distribución (LS) y entrega (CS) correctamente configurados.'],
            ['Semiterminado Local', 'ok', ['semi'], 'El semiterminado se produce y consume en la misma planta. No requiere transferencia.'],
            ['Semiterminado con Transferencia', 'ok', ['semi'], 'El semiterminado se produce en una planta y se consume como PSI en la planta destino de la transferencia.'],
            ['Semiterminado Local con Transferencia', 'ok', ['semi'], 'El semiterminado se consume en la planta productora Y también se transfiere a otra planta donde también se consume.'],
            ['Sin Producción', 'red', ['semi'], 'El semiterminado no tiene PSH — no se está fabricando internamente.'],
            ['Sin Consumo PSI', 'red', ['semi'], 'El semiterminado tiene producción pero no aparece como componente en ningún BOM.'],
            ['Abastecimiento Completo', 'ok', ['rawmat'], 'El insumo tiene arcos de Location Source que llegan hasta al menos una planta productora.'],
            ['Abastecimiento Parcial', 'yellow', ['rawmat'], 'El insumo tiene Location Source pero ningún arco llega hasta una planta productora — posible configuración incompleta.'],
            ['Abastecimiento sin Consumo PSI', 'yellow', ['rawmat'], 'El insumo tiene Location Source pero no aparece en ningún BOM como componente — arco de abastecimiento sin uso productivo declarado.'],
            ['Sin Abastecimiento', 'red', ['rawmat'], 'El insumo no tiene ningún arco en Location Source — no tiene origen declarado en la red.'],
            ['Sin arcos de red', 'red', ['all'], 'El producto no tiene ningún arco en Location Source ni Customer Source — completamente desconectado de la red.'],
            ['Huérfano', 'red', ['all'], 'El producto solo existe en el maestro de materiales sin ninguna actividad en la red (no está en PSH, PSI, Location Source, Customer Source ni Location Product).']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['Ghost node: X', 'red', ['finished', 'trading'], 'La ubicación X recibe el producto pero todas sus salidas terminan en un callejón sin salida — no llega a ningún cliente.', 'Revisar la configuración de arcos salientes de la ubicación X en Location Source. Puede faltar un arco hacia el siguiente nodo o hacia un Customer Source.'],
            ['Dead-end: X', 'red', ['finished', 'trading'], 'La ubicación X recibe el producto por Location Source pero no tiene ninguna salida configurada — el producto llega y no puede continuar.', 'Agregar el arco de salida faltante en Location Source o en Customer Source desde la ubicación X, o verificar si ese nodo es el destino final (y entonces falta un Customer Source).'],
            ['Planta aislada: X', 'red', ['finished'], 'La planta X produce este producto pero no tiene ninguna ruta que llegue a algún cliente — producción sin mercado alcanzable.', 'Revisar arcos de distribución desde la planta X en Location Source. Puede faltar el arco inicial desde la planta hacia el primer nodo de distribución.'],
            ['Ciclo: X → Y → Z → X', 'red', ['all'], 'Se detectó un ciclo en la red: el producto puede circular indefinidamente entre estas ubicaciones sin llegar a ningún cliente.', 'Revisar los arcos de Location Source entre las ubicaciones del ciclo e identificar cuál está configurado en sentido incorrecto.'],
            ['PLEADTIME faltante: X', 'red', ['finished', 'semi'], 'La planta X produce este producto pero su PLEADTIME es 0 o está vacío. IBP planifica producción instantánea.', 'Ingresar el PLEADTIME real en días en el Production Source Header para la planta X y este producto.'],
            ['TLEADTIME faltante: X→Y', 'yellow', ['all'], 'El arco de transferencia X→Y tiene TLEADTIME = 0 o vacío. IBP planifica transferencias instantáneas en ese tramo.', 'Ingresar el TLEADTIME real en días en el arco de Location Source X→Y para este producto.'],
            ['CLEADTIME faltante: X→Y', 'yellow', ['finished', 'trading'], 'El arco de entrega X→Y (hacia cliente) tiene CLEADTIME = 0 o vacío. IBP planifica entregas instantáneas en ese tramo.', 'Ingresar el CLEADTIME real en días en el arco de Customer Source X→Y para este producto.'],
            ['Sin Location Product', 'yellow', ['all'], 'El producto está en PSH o en Location Source pero no está habilitado en Location Product en alguna ubicación de la red.', 'Habilitar el producto en Location Product para las ubicaciones donde participa activamente en la red.'],
            ['Sin Customer Product', 'yellow', ['all'], 'El producto tiene Customer Source (entrega a cliente) pero no está habilitado en Customer Product para ese cliente.', 'Habilitar la combinación producto+cliente en Customer Product en IBP.'],
            ['Red desconectada: arcos LS y CS no comparten ubicaciones', 'red', ['trading'], 'Los arcos de distribución (Location Source) y los arcos de entrega (Customer Source) no tienen ninguna ubicación en común — la red está partida en dos fragmentos desconectados.', 'Revisar que al menos una ubicación aparezca tanto en Location Source (como destino) como en Customer Source (como origen de entrega).'],
            ['Destino(s) de transferencia sin consumo PSI: X, Y', 'red', ['semi'], 'El semiterminado se transfiere a las ubicaciones X, Y pero en ninguna de ellas se consume como ingrediente en alguna receta.', 'Agregar el semiterminado como componente PSI en el BOM de la planta destino, o eliminar el arco de transferencia si es un error.'],
            ['Paths truncados (>50.000, red muy compleja)', 'yellow', ['all'], 'La red tiene más de 50.000 rutas posibles — se procesaron parcialmente para evitar bloqueo del sistema.', 'Esta advertencia es informativa. El análisis es representativo pero puede no detectar todas las anomalías. Considerar simplificar la red o analizar por subconjunto de productos.']
          ]));
      }
    },

    /* ── LOCATION ── */
    {
      id: 'sn-location', icon: '🏭', title: 'Hoja: Location',
      content: function () {
        return p('Una fila por cada ubicación detectada en la red. Acumula los hallazgos topológicos de todos los productos que pasan por esa ubicación.') +
          sub('Columnas clave', colTable([
            ['Rol inferido', 'Rol de la ubicación inferido de su comportamiento: Planta con Entrega, Planta, DC con Entrega Directa, DC, Punto de Entrega, Sin rol activo.'],
            ['En PSH?', 'Si/No — la ubicación tiene al menos una fuente de producción (fabrica algo).'],
            ['En Location Source?', 'Si/No — aparece como origen o destino en algún arco de transferencia.'],
            ['En Customer Source?', 'Si/No — aparece como ubicación de entrega a algún cliente.'],
            ['En Location Product?', 'Si/No — habilitada en Location Product. Sin esto IBP no planifica en esta ubicación.'],
            ['Es nodo crítico?', 'Si/No — su eliminación cortaría rutas de múltiples productos a clientes.'],
            ['# Productos impactados', 'Si es nodo crítico: cuántos productos dependen de este nodo.'],
            ['Nivel de riesgo', 'Critical (≥4 productos), High (2-3), Medium (1).']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['Ghost node (alimentado sin salida util)', 'red', ['finished', 'trading'], 'Esta ubicación recibe el producto desde algún origen pero todas sus salidas conducen a callejones sin salida — el producto nunca llega a un cliente a través de este nodo.', 'Revisar los arcos salientes de esta ubicación en Location Source y Customer Source. Puede faltar el arco final hacia un cliente o hacia el siguiente nodo de la cadena.'],
            ['Dead-end (recibe pero no reenvía)', 'red', ['finished', 'trading'], 'Esta ubicación recibe producto por Location Source pero no tiene ningún arco de salida configurado — el producto llega y no puede continuar.', 'Agregar el arco de salida faltante en Location Source o Customer Source, o verificar si esta ubicación es el destino final y falta el arco a un cliente.'],
            ['Planta aislada (sin ruta a ningun cliente)', 'red', ['finished'], 'Esta planta produce algún producto pero ninguna de sus rutas logísticas llega hasta algún cliente.', 'Revisar la configuración de Location Source desde esta planta e identificar el arco faltante que conecte la producción con la red de distribución.'],
            ['Participa en ciclo: X→Y→Z→X', 'red', ['all'], 'Esta ubicación forma parte de un ciclo en la red logística. El producto puede circular indefinidamente sin llegar a un cliente.', 'Identificar cuál de los arcos del ciclo está configurado en sentido incorrecto y corregirlo en Location Source.'],
            ['Sin Location Product', 'red', ['all'], 'Esta ubicación participa activamente en la red (PSH o Location Source) pero no está habilitada en Location Product. IBP no puede planificar en ella.', 'Habilitar la ubicación en Location Product para los productos que la utilizan.'],
            ['Nodo critico: N prod, N clientes', 'yellow', ['all'], 'Esta ubicación es un punto único de falla: si desaparece, N productos dejarían de llegar a N clientes. No es un error de configuración sino un riesgo de resiliencia.', 'Evaluar si se justifica agregar una ruta alternativa que no dependa de este nodo para los productos críticos.'],
            ['Solo en maestro de ubicaciones, sin actividad en la red', 'yellow', ['all'], 'La ubicación existe en el maestro pero no aparece en ninguna entidad de red.', 'Verificar si la ubicación es obsoleta o si falta configurar su participación en la red de abastecimiento.']
          ]));
      }
    },

    /* ── CUSTOMER ── */
    {
      id: 'sn-customer', icon: '👤', title: 'Hoja: Customer',
      content: function () {
        return p('Una fila por cada cliente detectado en la red (Customer Source o Customer Product). Analiza si cada cliente puede recibir productos a través de rutas completas desde la producción.') +
          sub('Columnas clave', colTable([
            ['CUSTID', 'Código único del cliente en SAP IBP.'],
            ['En Customer Source?', 'Si/No — el cliente tiene al menos un arco de entrega configurado.'],
            ['En Customer Product?', 'Si/No — habilitado en Customer Product. Sin esto IBP ignora al cliente en planificación.'],
            ['# Productos recibidos', 'Número de productos distintos que este cliente puede recibir según Customer Source.'],
            ['# Ubicaciones proveedoras', 'Número de ubicaciones desde las que se despacha al cliente.'],
            ['# Paths que llegan', 'Total de rutas completas de planta a este cliente (suma de todos sus productos).'],
            ['Resiliencia predominante', 'Single Path = algún producto llega solo por una ruta | Single Node Dependency = hay un nodo único cuyo fallo corta el abastecimiento | Resilient = todos los productos tienen rutas alternativas.']
          ])) +
          sub('Observaciones posibles', obsTable([
            ['Sin productos alcanzables desde produccion', 'red', ['all'], 'El cliente tiene Customer Source configurado pero ninguna ruta completa conecta la producción con sus arcos de entrega.', 'Revisar la red de distribución hacia este cliente e identificar los arcos faltantes en Location Source o Customer Source.'],
            ['Sin Customer Product', 'yellow', ['all'], 'El cliente tiene arcos de entrega (Customer Source) pero no está habilitado en Customer Product. IBP lo ignora en la planificación.', 'Habilitar las combinaciones cliente+producto correspondientes en Customer Product en IBP.'],
            ['N producto(s) con unica ruta', 'yellow', ['all'], 'N productos llegan a este cliente por una sola ruta completa. Si esa ruta falla, el abastecimiento se corta.', 'Evaluar si se justifica agregar una ruta alternativa para los productos indicados, para aumentar la resiliencia del abastecimiento.'],
            ['N producto(s) con nodo critico unico', 'yellow', ['all'], 'N productos tienen una ruta única que pasa por un nodo crítico. Si ese nodo falla, el cliente queda sin abastecimiento.', 'Identificar el nodo crítico indicado y evaluar agregar una ruta alternativa que evite ese único punto de falla.'],
            ['Solo en maestro, sin uso en red', 'info', ['all'], 'El cliente existe en el maestro pero no tiene arcos de entrega en Customer Source.', 'Verificar si el cliente es obsoleto o si falta configurar sus arcos de entrega.']
          ]));
      }
    },

    /* ── LOCATION SOURCE ── */
    {
      id: 'sn-ls', icon: '↗️', title: 'Hoja: Location Source',
      content: function () {
        return p('Una fila por cada arco de transferencia en Location Source (combinación PRDID + LOCFR + LOCID). Analiza si cada arco tiene lead time definido, si los nodos extremos están habilitados en Location Product, y si el arco pertenece a alguna ruta completa.') +
          sub('Columnas clave', colTable([
            ['PRDID', 'Producto transferido en este arco.'],
            ['LOCFR', 'Ubicación de origen del arco de transferencia.'],
            ['LOCID', 'Ubicación de destino del arco de transferencia.'],
            ['TLEADTIME', 'Lead time de transferencia en días. 0 o vacío genera ⚠ Advertencia.'],
            ['LOCFR+PRDID en Location Product?', 'Si/No — el origen está habilitado para este producto en Location Product.'],
            ['LOCID+PRDID en Location Product?', 'Si/No — el destino está habilitado para este producto en Location Product.'],
            ['Arco en ruta completa?', 'Si/No — este arco forma parte de al menos una ruta que llega a un cliente.'],
            ['Arco inverso?', 'Si/No — existe un arco configurado en dirección opuesta (LOCID→LOCFR) para el mismo producto. Puede indicar un ciclo.'],
            ['Lead Time Status', 'OK = lead time > 0 | Zero = TLEADTIME = 0 | Missing = sin valor definido.'],
            ['SPOF arco?', 'Si/No — Single Point of Failure: el destino LOCID tiene un único origen (este). Si falla este arco, el destino queda sin abastecimiento del producto.']
          ])) +
          callout('tip', '<strong>Lectura clave:</strong> Los arcos con <em>Arco en ruta completa = No</em> son candidatos a revisión — están configurados pero no contribuyen a ninguna ruta de planta a cliente. Pueden ser arcos obsoletos o pueden indicar una brecha en la red.');
      }
    },

    /* ── CUSTOMER SOURCE ── */
    {
      id: 'sn-cs', icon: '📦', title: 'Hoja: Customer Source',
      content: function () {
        return p('Una fila por cada arco de entrega a cliente en Customer Source (combinación PRDID + LOCID + CUSTID). Analiza si cada entrega tiene lead time definido, si los extremos están habilitados, y si existe una ruta completa que la abastezca.') +
          sub('Columnas clave', colTable([
            ['PRDID', 'Producto entregado al cliente.'],
            ['LOCID', 'Ubicación de despacho desde donde sale el producto al cliente.'],
            ['CUSTID', 'Cliente receptor.'],
            ['CLEADTIME', 'Lead time de entrega al cliente en días. 0 o vacío genera ⚠ Advertencia.'],
            ['LOCID+PRDID en Location Product?', 'Si/No — la ubicación de despacho está habilitada para este producto en Location Product.'],
            ['CUSTID+PRDID en Customer Product?', 'Si/No — el cliente está habilitado para este producto en Customer Product.'],
            ['Entrega alcanzable desde produccion?', 'Si/No — existe una ruta completa de producción que llega hasta este arco de entrega.'],
            ['Lead Time Status', 'OK = lead time > 0 | Zero = CLEADTIME = 0 | Missing = sin valor definido.']
          ])) +
          callout('tip', '<strong>Lectura clave:</strong> Los arcos con <em>Entrega alcanzable = No</em> indican que el cliente tiene arcos de entrega configurados pero la producción nunca llega hasta ese punto — hay una brecha en la red de distribución.');
      }
    },

    /* ── TIPOS DE MATERIAL SN ── */
    {
      id: 'sn-mattypes', icon: '🏷️', title: 'Tipos de Material',
      content: function () {
        return p('La categorización de MATTYPEID afecta directamente qué hallazgos se generan y cuál es su severidad en la hoja Product del Network Analyzer. La misma ausencia de ruta a cliente puede ser ⛔ Alerta para un Terminado y no generar ningún hallazgo para un Semiterminado.') +
          sub('Impacto por categoría en Network Analyzer',
            '<div class="glos-table-wrap"><table class="glos-col-table"><thead><tr><th>Regla de análisis</th>' +
              '<th style="color:var(--accent)">Terminado</th>' +
              '<th style="color:var(--cyan)">Semiterminado</th>' +
              '<th style="color:var(--green)">Mat. Prima</th>' +
              '<th style="color:var(--purple)">Mercadería</th>' +
            '</tr></thead><tbody>' +
              '<tr><td>Necesita ruta completa a cliente</td><td>⛔ Alerta</td><td>No aplica</td><td>No aplica</td><td>⛔ Alerta</td></tr>' +
              '<tr><td>Ghost Nodes / Dead-ends</td><td>⛔ Detecta</td><td>No detecta</td><td>No detecta</td><td>⛔ Detecta</td></tr>' +
              '<tr><td>Plantas aisladas</td><td>⛔ Detecta</td><td>No detecta</td><td>No detecta</td><td>⛔ Detecta</td></tr>' +
              '<tr><td>PLEADTIME faltante</td><td>⛔ Alerta</td><td>⚠ Advertencia</td><td>No aplica</td><td>No aplica</td></tr>' +
              '<tr><td>TLEADTIME faltante</td><td>⚠ Advertencia</td><td>⚠ Advertencia</td><td>⚠ Advertencia</td><td>⚠ Advertencia</td></tr>' +
              '<tr><td>CLEADTIME faltante</td><td>⚠ Advertencia</td><td>No aplica</td><td>No aplica</td><td>⚠ Advertencia</td></tr>' +
              '<tr><td>Necesita PSH propio</td><td>⛔ Alerta</td><td>⛔ Alerta</td><td>No aplica</td><td>No aplica</td></tr>' +
              '<tr><td>Necesita consumo PSI en destino (semi)</td><td>No aplica</td><td>⛔ Alerta</td><td>No aplica</td><td>No aplica</td></tr>' +
              '<tr><td>Necesita arco de abastecimiento</td><td>No aplica</td><td>No aplica</td><td>⛔ Alerta</td><td>No aplica</td></tr>' +
              '<tr><td>Arcos LS + CS conectados</td><td>No aplica</td><td>No aplica</td><td>No aplica</td><td>⛔ Alerta</td></tr>' +
            '</tbody></table></div>'
          ) +
          callout('warn', '<strong>Tipo excluido:</strong> Los productos excluidos no generan filas en la hoja Product del Network Analyzer. Sin embargo, si son componentes PSI de productos incluidos, sus arcos de abastecimiento sí se validan en la hoja Product del producto consumidor.') +
          callout('info', '<strong>Sin categoría (uncategorized):</strong> Se aplica el modo más permisivo: todos los hallazgos se limitan a ⚠ Advertencia, nunca ⛔ Alerta. Esto puede ocultar problemas críticos reales. Se recomienda siempre categorizar antes de interpretar resultados.');
      }
    }
  ];

  /* ─── RENDER ─────────────────────────────────────────────────── */

  function renderNav(sections) {
    var nav = document.getElementById('glosarioSidenav');
    if (!nav) return;
    nav.innerHTML = sections.map(function (s) {
      return '<a class="glos-nav-link" href="#' + s.id + '" onclick="glosarioNavClick(event,\'' + s.id + '\')">' +
        s.icon + ' ' + s.title + '</a>';
    }).join('');
  }

  function renderContent(sections) {
    var cont = document.getElementById('glosarioContent');
    if (!cont) return;
    cont.innerHTML = sections.map(function (s) {
      return section(s.id, s.icon, s.title, s.content());
    }).join('<hr class="glos-hr">');
    cont.scrollTop = 0;
  }

  /* ─── PUBLIC API ─────────────────────────────────────────────── */

  window.glosarioSwitchModule = function (mod) {
    _currentModule = mod;
    document.querySelectorAll('.glosario-mod-btn').forEach(function (b) {
      b.classList.toggle('active', b.id === 'glosModBtn-' + mod);
    });
    var sections = mod === 'pa' ? PA_SECTIONS : SN_SECTIONS;
    renderNav(sections);
    renderContent(sections);
  };

  window.glosarioNavClick = function (e, id) {
    e.preventDefault();
    var el = document.getElementById(id);
    var cont = document.getElementById('glosarioContent');
    if (el && cont) cont.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' });
    document.querySelectorAll('.glos-nav-link').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + id);
    });
  };

  /* Scrollspy */
  function initScrollspy() {
    var cont = document.getElementById('glosarioContent');
    if (!cont) return;
    cont.addEventListener('scroll', function () {
      var sections = cont.querySelectorAll('.glos-section');
      var scrollTop = cont.scrollTop + 40;
      var activeId = null;
      sections.forEach(function (s) {
        if (s.offsetTop <= scrollTop) activeId = s.id;
      });
      document.querySelectorAll('.glos-nav-link').forEach(function (a) {
        a.classList.toggle('active', activeId && a.getAttribute('href') === '#' + activeId);
      });
    });
  }

  /* Auto-init when tab is shown */
  var _initialized = false;
  var _origSwitch = null;

  function hookSwitchTab() {
    if (typeof window.switchTab !== 'function') return;
    if (_origSwitch) return;
    _origSwitch = window.switchTab;
    window.switchTab = function (tabId) {
      _origSwitch(tabId);
      if (tabId === 'glosario' && !_initialized) {
        _initialized = true;
        glosarioSwitchModule('pa');
        setTimeout(initScrollspy, 100);
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookSwitchTab);
  } else {
    hookSwitchTab();
  }

})();
