# SAP IBP BOM Hierarchy Explorer v6

Aplicación web que se conecta directamente a la API OData de SAP IBP para visualizar la jerarquía de producción (BOM) de forma interactiva.

## Arquitectura

```
┌─────────────────────────────────┐
│  Navegador (public/index.html)  │
│  - Formulario de conexión       │
│  - Auto-detección de entidades  │
│  - Visualizador BOM interactivo │
└──────────────┬──────────────────┘
               │ POST /api/proxy
               │ POST /api/proxy-xml
┌──────────────▼──────────────────┐
│  Express Proxy (server.js)      │
│  - Maneja CORS                  │
│  - Inyecta Basic Auth           │
│  - Reenvía a SAP IBP            │
└──────────────┬──────────────────┘
               │ HTTPS
┌──────────────▼──────────────────┐
│  SAP IBP OData API              │
│  UNIFIED_PLANNING_SRV           │
│  - $metadata                    │
│  - Production Source Header     │
│  - Production Source Item       │
│  - Production Source Resource   │
│  - Product                      │
└─────────────────────────────────┘
```

## Requisitos

- **Node.js** 14 o superior
- Acceso a la API OData de SAP IBP (URL, usuario, contraseña)

## Instalación y uso

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor
npm start

# 3. Abrir en navegador
# http://localhost:3000
```

## Flujo de uso

1. **Conectar** — Ingresa la URL del tenant, usuario, contraseña y Planning Area
2. **Detectar entidades** — El sistema lee $metadata y auto-detecta qué entidad es Header, Item, Resource y Product
3. **Descargar datos** — Descarga todos los registros con paginación automática
4. **Explorar jerarquía** — Navega el árbol BOM interactivo por planta

## Funcionalidades

- ✅ Conexión directa a SAP IBP via OData (sin Excel)
- ✅ Auto-detección de Master Data Types por scoring (prioriza prefijo del Planning Area)
- ✅ Paginación automática (maneja el límite de 5000 registros por batch)
- ✅ Jerarquía multinivel con trazabilidad por planta (LOCID)
- ✅ Co-producción: SOURCETYPE P (principal) y C (co-producto)
- ✅ Filtros por PRDID/descripción y por SOURCEID
- ✅ Expandir/colapsar individual y global
- ✅ Detección de ciclos
- ✅ Badges para recursos (RESID) y tipos de material
