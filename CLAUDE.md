# CLAUDE.md — GoSCM · Production Hierarchy & Supply Network

Contexto completo del proyecto para sesiones de Claude Code.

---

## Proyecto

**Nombre:** GoSCM — Production Hierarchy & Supply Network Analysis
**URL producción:** https://ibp-bom-v7.vercel.app
**Repositorio GitHub:** https://github.com/gahumadatoledo-cmyk/ibp-bom-v7 (privado)
**Stack:** HTML + CSS (`public/css/`) + JavaScript modular (`public/js/`) + Node.js backend en Vercel (`api/proxy.js`)

---

## Reglas de deploy

- **NUNCA** levantar servidor local (`npm run dev`, `preview_start`, `localhost`)
- **SIEMPRE** deployar con `git push` — Vercel despliega automáticamente al detectar el push
- Flujo: editar → commit → `git push` → Vercel despliega en producción automáticamente
- Repositorio conectado a Vercel para CI/CD automático

---

## Arquitectura

### Frontend
- Todo el UI de la app vive de forma estructural en `public/index.html`
- Lógica separada por directrices en `public/js/` (`api.js`, `state.js`, `utils.js`, `bom.js`, `analyzer.js`, `visualizer.js`, `main.js`, `docs.js`)
- Todos los estilos centralizados en `public/css/styles.css`
- Sin frameworks frontend modernos, puro Vanilla JS
- Librerías externas via CDN:
  - `vis-network` — diagramas de red (Visualizer)
  - `jszip` — creación nativa de excel en frontend (.xlsx)
  - `exceljs` — exportación manual a Excel

### Backend (Vercel Serverless)
- `server.js` — proxy para llamadas a SAP IBP (evita CORS)
  - Recibe `{ base, service, path, query, user, password }` vía POST en `/api/proxy`
  - Valida dominio, service y path antes de construir la URL destino
  - Reenvía la request a SAP IBP con Basic Auth
  - Devuelve la respuesta JSON al frontend

---

## SAP IBP — Conexión y APIs

### Credenciales (ingresadas por el usuario en la UI, nunca almacenadas)
- API Base URL: `https://{instancia}-api.scmibp.ondemand.com`
- Usuario: Communication User
- Contraseña
- Planning Area ID
- Versión (opcional, vacío = Baseline)

### Communication Arrangement requerido
- Escenario: `SAP_COM_0720`
- Activa: `/IBP/MASTER_DATA_API_SRV` y `/IBP/PLANNING_DATA_API_SRV`

### Entidades OData utilizadas
| Entidad | Uso |
|---|---|
| Production Source Header | BOM raíz, SOURCETYPE, PLEADTIME |
| Production Source Item | Ítems BOM, coeficientes |
| Production Source Resource | Recursos productivos |
| Location Source | Transferencias entre ubicaciones, TLEADTIME |
| Customer Source | Entrega a clientes, CLEADTIME |
| Product | Maestro de productos |
| Location | Maestro de ubicaciones |
| Customer | Maestro de clientes |

### Campos clave por entidad
- **PSH:** `SOURCEID`, `PRDID`, `LOCID`, `SOURCETYPE` (P=primario, C=co-producto), `PLEADTIME`, `OUTPUTCOEFFICIENT`
- **Location Source:** `PRDID`, `LOCFR`, `LOCID`, `TLEADTIME`
- **Customer Source:** `PRDID`, `LOCID`, `CUSTID`, `CLEADTIME`

### Helper de fetch paginado
```javascript
fetchAllPages(url, logEl, filter, select)
// Maneja $skiptoken, $filter, $select automáticamente
// Usa /api/proxy para evitar CORS
```

---

## Módulos de la aplicación

### 1. Production Hierarchy (pestaña)
- Carga BOM completo de SAP IBP (Production Source Header + Item)
- Construye árbol recursivo con `buildSourceNode(sid, level, visitedSids, displayPrdid, rootLocid)`
- Índices globales: `HDR_BY_SID`, `HDR_BY_PRD`, `CPR_BY_SID`
- Badge SOURCETYPE: `badge-psh` (verde) para P, `badge-coprod` (morado) para C
- Exporta a Excel con ExcelJS

### 2. Supply Network Analyzer (pestaña)
- Analiza la red logística completa: plantas, ubicaciones, clientes
- Detecta hallazgos de calidad de red:
  - **Ghost nodes:** recibe producto, tiene salidas, pero ninguna llega a cliente
  - **Dead-ends:** recibe producto, sin ninguna salida
  - **Plantas sin ruta a cliente**
  - **Clientes sin ruta de abastecimiento**
  - **Lead times faltantes** (TLEADTIME, CLEADTIME)
  - **Ciclos en la red**
  - **Múltiples fuentes sin cuota**
- Hallazgos con severidad: 🔴 Alto / 🟡 Medio / ℹ️ Info
- Exporta análisis a Excel

### 3. Visualizer (pestaña)
- Visualización interactiva de la red logística de un producto
- Fetch filtrado por PRDID al cargar un producto específico
- Motor de renderizado: `vis-network` con `physics: false`
- Layout manual con `vizAssignPositions(nodes)`:
  - Columnas LR: Producto | Plantas | Ubicaciones (N cols, max 8/col) | Clientes
- Tipos de nodo: `plant` (amarillo #F59E0B), `location` (cyan #06B6D4), `customer` (verde #10B981)
- Lead times en tooltip al hacer click en arcos (PLEADTIME, TLEADTIME, CLEADTIME)
- Modal de filtros con búsqueda glob (`*T1`, `T1*`, `*T1*`)
- Auto-umbral: si nodos > 50, oculta clientes sobrantes automáticamente
- Panel de análisis integrado (misma lógica que Analyzer, filtrado por producto)
- Funciones principales:
  - `vizLoadNetwork()` — fetch + build + render
  - `vizBuildGraph(prdid, data)` — construye nodos/edges
  - `vizMakeNetwork(container, nodes, edges)` — crea vis.js Network
  - `vizAssignPositions(nodes)` — layout manual columnas
  - `vizToggleType(type, visible)` — toggle visibilidad por tipo
  - `vizGlobMatch(text, pattern)` — matching con wildcards

### 4. Doc Generator (pestaña)
Tres modos seleccionables con toggle en la parte superior: ZIP, Application Jobs, ZIP + Jobs.

#### Modo ZIP
- El usuario sube uno o más archivos ZIP exportados desde SAP CI-DS. Cada ZIP contiene XMLs de integraciones y un `batch.csv` con metadatos de datastores.
- El parser extrae por cada dataflow: `jobName`, `dataflowName`, `dataflowGuid`, `srcDSName`, `dstDSName`, `targetTable`, `mappings`, `filters`, `lookups`, `variables`.
- 100% frontend: `JSZip` + `DOMParser` nativo.
- **ATL opcional:** el usuario puede además subir archivos `.atl` de SAP Data Services. Si lo hace, cada dataflow del ATL se asocia a su integración ZIP mediante:
  - **Primario (GUID):** `CALL DATAFLOW name::'guid'` del ATL vs atributo `guid` del `<DataFlow>` en el XML del ZIP.
  - **Fallback (nombre):** `displayName` del dataflow ATL vs `dataflowName` del ZIP, case-insensitive.
  - El resultado enriquece cada fila con el nombre del proceso ATL (`sessionName`) y el grupo (`displayName` del `<Plan>`, sin prefijo `FLOWof_`).
- Genera Excel `.xlsx` con hoja Parámetros + una hoja de detalle por integración.
- **Columnas en hoja Parámetros** (modo ZIP): Dato | Tipo | Proceso | Grupo | Task CI-DS | Descripción | Dataflow | Fuente | Destino.
  - Proceso y Grupo quedan vacíos si no se suben ATLs.
- Estado ATL en modo ZIP: `zipAtlFiles = [{name, text}]`.
- Funciones principales en `docs.js`:
  - `generate()` — escanea los ZIPs, construye `parsedIntegrations` y muestra la lista de selección.
  - `buildExcel()` — si hay ATLs, ejecuta el enriquecimiento antes de generar las hojas.
  - `initZipAtlDropZone()` / `addZipAtlFiles()` / `renderZipAtlFiles()` — manejo del drop zone ATL.
  - `parseBatchCsv(zip)` — extrae `batch.csv` del ZIP (helper compartido entre todos los modos).

#### Modo Application Jobs
- Conecta a SAP IBP vía `BC_EXT_APPJOB_MANAGEMENT;v=0002` (Communication Arrangement `SAP_COM_0326`).
- Obtiene los Application Jobs desde `JobTemplateSet` y sus pasos desde `JobTemplateSequenceSet`.
- El usuario selecciona los jobs deseados. Los pasos CI-DS se identifican por `JceText` conteniendo `"DATA INTEGRATION"`.
- **Identificación del task CI-DS por `P_TSKID`:** para cada job seleccionado, una sola call a `JobTemplateParameterValueDataSet` con filtro `startswith(JobTemplateParameterName,'P_TSKID')` devuelve todos los task IDs técnicos. El campo `Low` de cada entrada contiene el nombre real del task CI-DS (ej. `IBP_001_PROCESS_PRERREQUISITOS`), invariable aunque el usuario haya renombrado el paso en IBP. La clave de extracción es `JobTemplateParameterName` = `"P_TSKID " + JobSequenceName`.
- Pasos no-CI-DS (Copy Operator, Rule-Based, etc.) se incluyen como filas informativas sin hoja de detalle.
- **Matching ATL → step IBP:** cada ATL subido se asocia al step IBP cuyo `P_TSKID` (primario) o `JobSequenceText` (fallback) coincide con `atl.sessionName`.
- **Matching dataflows:** `matchATLtoIntegrations(atl, parsedInts)` recibe un ATL individual; se llama en loop, una vez por ATL. Asocia cada dataflow del ATL a su integración ZIP por GUID (primario) o nombre (fallback).
- **Tareas directas:** pasos CI-DS sin ATL se cruzan contra `parsed.jobName` de los ZIPs usando el `P_TSKID` como clave (fallback a `JobSequenceText`).
- **ATL es opcional:** jobs con solo tareas directas no requieren ATL.
- **Orden de filas** en el Excel: selección del usuario → posición del paso (`JobSequencePosition`) → orden ATL.
- **Columnas en hoja Parámetros** (modo Jobs): Dato | Tipo | Job IBP | Step | Tipo de paso | Grupo | Task CI-DS | Descripción | Dataflow | Fuente | Destino.
- `FLOWof_` se elimina automáticamente del nombre de grupo ATL.
- Funciones principales en `docs.js`:
  - `fetchAndDisplayJobs()` — consulta IBP y muestra lista de jobs.
  - `generateFromJobs()` — orquesta fetch de pasos, resolución de P_TSKID, parse de ATLs/ZIPs, cruce y generación del Excel.
  - `parseATL(text)` — parsea un archivo ATL de SAP Data Services; devuelve `{ sessionName, groups: [{ displayName, dataflows: [{ fullName, guid, displayName }] }] }`.
  - `matchATLtoIntegrations(atl, parsedInts)` — asocia dataflows de un ATL con integraciones ZIP; devuelve array con `atlGroup` añadido.

#### Modo ZIP + Jobs
- El usuario sube ZIPs de CI-DS y la app se conecta a IBP para obtener la estructura de jobs automáticamente (sin necesidad de subir ATL).
- Resuelve el `P_TSKID` de cada step en una sola call a `JobTemplateParameterValueDataSet` con filtro `startswith(JobTemplateParameterName,'P_TSKID')`.
- Construye un índice `taskId.toUpperCase() → step info` y matchea cada integración ZIP por `parsed.jobName` contra ese índice.
- Genera el mismo Excel que el modo Jobs pero sin requerir archivos ATL.
- Función principal: `generateZipJobs()`.

#### Constantes del módulo (docs.js)
```javascript
const SVC_APPJOB   = '/sap/opu/odata/sap/BC_EXT_APPJOB_MANAGEMENT;v=0002';
const JCE_DATA_INT = 'DATA INTEGRATION';  // identifica pasos CI-DS por JceText
const ATL_NO_GROUP = 'Sin grupo ATL';
```

#### proxy en server.js — soporte multi-namespace
- `api/proxy` acepta campo `prefix` (`"IBP"` o `"SAP"`) para seleccionar el prefijo OData correcto.
- `ALLOWED_SERVICES` incluye `BC_EXT_APPJOB_MANAGEMENT` (sin versión — el strip de `;v=...` ocurre en `validateService`).
- `proxy-next` acepta URLs con path `/sap/opu/odata/ibp/` o `/sap/opu/odata/sap/`.

### 5. Requisitos técnicos (header)
- Panel desplegable en el header
- 5 pestañas: Conexión, Usuario SAP IBP, Communication Arrangement, Entidades OData, Permisos de red
- Visible sin necesidad de conectarse

### 5. Integration Explorer (pestaña)
Explorador visual de integraciones SAP CI-DS. No requiere conexión IBP — 100% frontend.

#### Flujo de uso
1. El usuario sube uno o más ZIPs exportados desde SAP CI-DS.
2. El módulo reutiliza `parseBatchCsv(zip)` y `parseIntegration(xmlStr, batchEntry)` de `docs.js` (funciones globales, sin IIFE).
3. Se muestran todas las integraciones en una vista master-detail con buscador global y dimensiones pivotadas.
4. Se detectan automáticamente cadenas consecutivas y se visualizan en un grafo jerárquico (vis-network).

#### Namespace
Todo el módulo vive en el IIFE `const Explorer = (function(){ ... })()` para evitar colisiones con las variables globales de `docs.js` (`files`, `dz`, `addFiles`, etc.). Las variables internas usan el prefijo `ex` (`exFiles`, `integrations`, etc.).

#### Estado interno (`explorer.js`)
```javascript
let exFiles      = [];  // [{name, data: ArrayBuffer}]
let integrations = [];  // parsed planos; cada uno tiene _idx, _zipName
let filtered     = [];  // subconjunto post-búsqueda
let indexes      = {};  // byDstTable, bySrcTable, byDstField, bySrcField, searchTokens
let chainEdges   = [];  // [{from, to, via: 'table'|'file'|'lookup', label}]
let selectedIdx  = null;
let currentView  = 'list';  // 'list' | 'graph'
let currentDim   = 'integration';
let visNetwork   = null;
```

#### Estructura del objeto parsed (por dataflow)
Igual que el del Doc Generator; campos relevantes para el Explorer:
- `jobName` — nombre del task CI-DS (mostrado como título principal)
- `dataflowName` — nombre del dataflow dentro del job (subtítulo cuando difiere)
- `tipoIntegracion` — `'MD'` | `'KF'` | `'FILE'`
- `targetTable` — nombre de la tabla o formato de archivo destino
- `fileLoaderFileName` — ruta/nombre del archivo físico (puede estar vacío)
- `srcDSName`, `dstDSName` — nombres de datastore origen/destino (de `batch.csv`)
- `mappings`, `filters`, `lookups`, `variables`

#### Detección de cadenas (`detectChains`)
Tres mecanismos; cada par A→B se registra solo una vez (más específico primero):

| Mecanismo | Condición | Color en grafo |
|---|---|---|
| **Tabla (DB)** | `normTableKey(m.srcDS, m.srcTable)` de B coincide con `normTableKey(a.dstDSName, a.targetTable)` de A (L1 exacto). L2 (solo tabla sin DS) solo aplica si ninguno de los dos es tipo FILE. | Verde `#34d399`, línea sólida |
| **Archivo** | A es tipo FILE; el nombre de formato (`targetTable`) coincide con `m.srcTable` de B, y `m.srcDS` de B es tipo archivo. | Naranja `#E8622A`, línea punteada |
| **Lookup** | B tiene expresiones `lookup(DS."archivo.csv", ...)`. Se extraen pares `{ds, file}` con `extractLookupPairs()`. El DS debe coincidir con `a.targetTable`; si A tiene `fileLoaderFileName` y el lookup provee nombre de archivo, ambos nombres base (sin extensión) deben coincidir. | Morado `#a78bfa`, línea dash-dot |

**Regla crítica de archivos:** para cadenas que involucran integraciones FILE, se requiere que TANTO la tabla destino como el nombre de archivo de A sean iguales a la tabla origen y nombre de archivo de B. Esto evita falsos positivos cuando el mismo esquema de formato se usa con archivos físicos distintos.

#### Dimensiones de exploración
Además de la vista por integración, hay cuatro vistas pivotadas construidas sobre `indexes`:
- **Tabla Destino** (`byDstTable`): agrupa por `normTableKey(dstDS, dstTable)`
- **Tabla Origen** (`bySrcTable`): agrupa por `normTableKey(srcDS, srcTable)`
- **Campo Destino** (`byDstField`): agrupa por nombre de campo destino (uppercase)
- **Campo Origen** (`bySrcField`): agrupa por nombre de campo origen (uppercase)

#### Grafo (vis-network)
- Layout jerárquico LR, `physics: false`
- Nodos coloreados por `tipoIntegracion`: MD=#F7A800, KF=#29ABE2, FILE=#E8622A
- Leyenda flotante superpuesta en esquina inferior derecha del contenedor del grafo
- Click en nodo → `switchView('list')` + `renderDetail(idx)`
- Función: `renderGraph()` en `explorer.js`

#### Funciones principales (`explorer.js`)
- `Explorer.analyze()` — parsea todos los ZIPs, construye índices y cadenas, renderiza lista
- `Explorer.renderDetail(idx)` — detalle de una integración: header, cadenas, mappings, filtros, lookups, variables
- `Explorer.applySearch(q)` — filtro client-side sobre tokens indexados
- `Explorer.switchView(v)` — alterna entre 'list' y 'graph'
- `Explorer.switchDimension(dim)` — cambia la dimensión activa en la vista lista
- `Explorer.renderGraph()` — construye o re-renderiza el grafo vis-network
- `extractLookupPairs(lookups)` — extrae `[{ds, file}]` de expresiones `lookup(...)`
- `normTableKey(ds, tbl)` / `normFileKey(file)` — normalización de claves para matching

#### Archivo
`public/js/explorer.js` — cargado después de `docs.js` en `index.html` para acceder a las funciones globales del parser.

---

### 6. Feedback (botón flotante)
- Botón fijo esquina inferior derecha
- Panel lateral con formulario: Nombre, App, Tipo, Descripción
- Envío via `POST /api/send-feedback` → server llama a EmailJS REST API con credenciales de env vars
- Destinatario: gerardo.ahumada@go-scm.com

---

## Variables globales clave

```javascript
var CFG = { base, user, pass, pa, pver };  // Configuración de conexión
var vizNetwork = null;                      // vis.js Network principal
var vizNetworkFull = null;                  // vis.js Network fullscreen
var vizCurrentPrd = '';                     // Producto seleccionado en Visualizer
var VIZ_DATA = null;                        // Datos cargados del producto
var VIZ_VISIBLE = { plant, location, customer }; // Visibilidad por tipo
var VIZ_HIDDEN_LOC = new Set();             // Ubicaciones ocultas por filtro
var VIZ_HIDDEN_CUST = new Set();            // Clientes ocultos por filtro
var HDR_BY_SID = {};                        // PSH por SOURCEID
var HDR_BY_PRD = {};                        // PSH por PRDID
var CPR_BY_SID = {};                        // Co-productos por SOURCEID

// Doc Generator — estado por modo (en docs.js)
let files          = [];  // ZIPs del modo ZIP:         [{name, data: ArrayBuffer}]
let zipAtlFiles    = [];  // ATLs del modo ZIP:         [{name, text}] — opcional
let atlFiles       = [];  // ATLs del modo Jobs:        [{name, text}]
let jobsFiles      = [];  // ZIPs del modo Jobs:        [{name, data: ArrayBuffer}]
let zipjobsFiles   = [];  // ZIPs del modo ZIP+Jobs:    [{name, data: ArrayBuffer}]
let parsedIntegrations = []; // [{sheetName, pkg, parsed, paramRow}]
```

---

## Convenciones de código

- `str(val)` — helper para convertir a string limpio (trim, null-safe)
- `escH(str)` — escape HTML
- `log(el, type, msg)` — log en área de logs técnicos (`ok`, `info`, `warn`, `error`)
- `fetchAllPages(url, logEl, filter, select)` — fetch paginado via proxy
- Tabs controlados con `switchTab(name)` — `bom`, `sn`, `viz`
- Panels controlados con `id="panel*"` + clase `hidden`

---

## Directrices de Seguridad

### Secretos y credenciales
- Nunca hardcodear API keys, tokens ni credenciales en código cliente ni en CLAUDE.md
- Toda información sensible va en variables de entorno de Vercel (Dashboard → Settings → Environment Variables)
- Usar `.env` local para desarrollo; `.env.example` con placeholders genéricos para documentar las variables requeridas

### Proxy al backend (server.js)
- El cliente nunca envía URLs completas al proxy — solo componentes estructurados: `{ base, service, path, query, prefix }`
- `prefix` es `"IBP"` o `"SAP"` según el namespace OData; el servidor lo usa para seleccionar el prefijo de path correcto vía `PREFIX_MAP`.
- El servidor valida cada componente por separado: dominio en allowlist, service en allowlist (strip de `;v=...` antes de comparar), path con regex estricto.
- Para agregar un nuevo servicio SAP permitido, actualizar `ALLOWED_SERVICES` en `server.js`.
- Los links de paginación SAP (`__next`) usan el endpoint `/api/proxy-next`, nunca `/api/proxy`.

### Frontend — renderizado de datos externos
- Todo valor proveniente de fuentes externas (archivos subidos, respuestas de API, localStorage) debe escaparse con `escH()` antes de insertarse en `innerHTML`
- No usar `innerHTML` con template literals que contengan datos no escapados; preferir `textContent` o `escH()`

### Librerías externas (CDN)
- Fijar versión exacta en cada `<script src="...">` de CDN
- Incluir atributo `integrity` (SRI hash) y `crossorigin="anonymous"` en todos los scripts de CDN
- Para obtener el hash SRI: https://www.srihash.org/

### Nuevos endpoints en server.js
Al agregar un endpoint nuevo:
1. Validar todos los inputs antes de usarlos
2. Respuestas de error al cliente: mensajes genéricos — los detalles van solo a `console.error()`
3. Si el endpoint hace fetch a un servicio externo, validar el dominio destino
4. El rate limiter `apiLimiter` ya cubre todas las rutas `/api/` automáticamente

---

## Paleta de colores

```css
--bg: #0b1120        /* fondo principal */
--accent: #F7A800    /* dorado — highlight primario */
--accent2: #E8622A   /* naranja — highlight secundario */
--cyan: #29ABE2      /* azul cielo */
--green: #34d399
--red: #ff6b6b
--purple: #a78bfa
```

---

## EmailJS

- Las credenciales se configuran como variables de entorno en Vercel Dashboard → Settings → Environment Variables
- Variables requeridas: `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`
- Ver `.env.example` para la lista completa de variables con placeholders
