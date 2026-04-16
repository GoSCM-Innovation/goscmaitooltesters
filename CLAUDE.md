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
Dos modos seleccionables con toggle en la parte superior:

#### Modo ZIP (original)
- Sube archivos ZIP de SAP CI-DS con integraciones en formato XML.
- Analiza y extrae: orígenes de datos, destinos, mapeos de campos, filtros y lookups.
- 100% frontend: `JSZip` + `DOMParser` nativo.
- Genera Excel nativo (`.xlsx`) con hoja Parámetros + una hoja de detalle por integración.

#### Modo Application Jobs
- Conecta a SAP IBP vía `BC_EXT_APPJOB_MANAGEMENT;v=0002` (Communication Arrangement `SAP_COM_0326`).
- Obtiene los Application Jobs y sus pasos desde `JobTemplateSet` / `JobTemplateSequenceSet`.
- El usuario selecciona los jobs deseados; la app carga sus pasos con `JobSequenceText` y `JceText`.
- Pasos CI-DS (`JceText` contiene `"DATA INTEGRATION"`) se cruzan contra ATL y ZIPs subidos.
- Pasos no-CI-DS (Copy Operator, Rule-Based, etc.) se incluyen como filas informativas sin hoja de detalle.
- **Matching de integraciones** (en `matchATLtoIntegrations` + bloque de tareas directas):
  - Pass 1: `atl.sessionName === step.text` (exact, case-insensitive) por GUID o display name.
  - Pass 2: contains parcial si el paso 1 falla.
  - Tareas directas: si un paso CI-DS no tiene ATL correspondiente, se cruza contra `parsed.jobName` de los ZIPs.
- **ATL es opcional**: jobs que solo tienen tareas directas (sin procesos) no requieren subir ATL.
- **Orden de filas** en el Excel: selección del usuario → posición del paso (`JobSequencePosition`) → orden ATL.
- **Columnas en hoja Parámetros** (modo jobs): Dato | Tipo | Job IBP | Step | Tipo de paso | Grupo | Task CI-DS | Descripción | Dataflow | Fuente | Destino.
- `FLOWof_` se elimina automáticamente del nombre de grupo ATL.
- Funciones principales en `docs.js`:
  - `fetchAndDisplayJobs()` — consulta IBP y muestra lista de jobs.
  - `generateFromJobs()` — orquesta fetch de pasos, parse de ATLs/ZIPs, cruce y generación del Excel.
  - `parseATL(text)` — parsea archivo ATL de SAP Data Services: extrae grupos, dataflows, GVs.
  - `matchATLtoIntegrations(atlParsed, parsedInts)` — cruza sesiones ATL con integraciones de los ZIPs.
  - `parseBatchCsv(zip)` — extrae `batch.csv` del ZIP (helper compartido con modo ZIP).

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
