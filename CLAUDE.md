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
- Permite subir archivos ZIP de SAP CIDS conteniendo integraciones en formato XML.
- Analiza y extrae especificaciones de integración: orígenes de datos, destinos, mapeos de campos, filtros de transformación y uso de funciones (lookups).
- Utiliza `JSZip` y el `DOMParser` nativo del navegador para el procesamiento cliente-servidor (100% frontend).
- Ensambla toda la documentación y descarga un archivo de Excel nativo (`.xlsx`) completamente estructurado usando JSZip sin dependencias pesadas.

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
- El cliente nunca envía URLs completas al proxy — solo componentes estructurados: `{ base, service, path, query }`
- El servidor valida cada componente por separado: dominio en allowlist, service en allowlist, path con regex estricto
- Para agregar un nuevo servicio SAP permitido, actualizar `ALLOWED_SERVICES` en `server.js`
- Los links de paginación SAP (`__next`) usan el endpoint `/api/proxy-next`, nunca `/api/proxy`

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
- **Destinatario:** gerardo.ahumada@go-scm.com
