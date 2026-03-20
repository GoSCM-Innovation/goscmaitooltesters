# CLAUDE.md — GoSCM · Production Hierarchy & Supply Network

Contexto completo del proyecto para sesiones de Claude Code.

---

## Proyecto

**Nombre:** GoSCM — Production Hierarchy & Supply Network Analysis
**URL producción:** https://ibp-bom-v7.vercel.app
**Repositorio GitHub:** https://github.com/gahumadatoledo-cmyk/ibp-bom-v7 (privado)
**Stack:** HTML + CSS + JavaScript (single file `public/index.html`) + Node.js backend en Vercel (`api/proxy.js`)

---

## Reglas de deploy

- **NUNCA** levantar servidor local (`npm run dev`, `preview_start`, `localhost`)
- **SIEMPRE** deployar con `git push` — Vercel despliega automáticamente al detectar el push
- Flujo: editar → commit → `git push` → Vercel despliega en producción automáticamente
- Repositorio conectado a Vercel para CI/CD automático

---

## Arquitectura

### Frontend
- Todo el UI y JS vive en un solo archivo: `public/index.html` (~4000+ líneas)
- Sin frameworks frontend (vanilla JS, CSS custom)
- Librerías externas via CDN:
  - `vis-network` — diagramas de red (Visualizer)
  - `exceljs` — exportación a Excel
  - `emailjs/browser` — envío de feedback por mail

### Backend (Vercel Serverless)
- `api/proxy.js` — proxy para llamadas a SAP IBP (evita CORS)
  - Recibe `{ url, user, password, body?, method? }` vía POST
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

### 4. Requisitos técnicos (header)
- Panel desplegable en el header
- 5 pestañas: Conexión, Usuario SAP IBP, Communication Arrangement, Entidades OData, Permisos de red
- Visible sin necesidad de conectarse

### 5. Feedback (botón flotante)
- Botón fijo esquina inferior derecha
- Panel lateral con formulario: Nombre, App, Tipo, Descripción
- Envío via EmailJS (service: `service_tw7qns4`, template: `template_hd02kde`)
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

- **Service ID:** service_tw7qns4
- **Template ID:** template_hd02kde
- **Public Key:** DoHbN3x-66upumtbm
- **Destinatario:** gerardo.ahumada@go-scm.com
