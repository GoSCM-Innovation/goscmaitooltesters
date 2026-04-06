/**
 * IBP BOM v7 — Express Proxy Server
 * Forwards OData requests to SAP IBP, handling CORS and authentication.
 *
 * Usage:
 *   npm install
 *   npm run dev   (local, requires .env)
 *   npm start     (production / Vercel)
 */

const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── OData constants ──────────────────────────────────────────────
const ALLOWED_SERVICES = ['MASTER_DATA_API_SRV', 'PLANNING_DATA_API_SRV'];
const ODATA_PREFIX = '/sap/opu/odata/IBP/';

// ─── Security headers ────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate limiting ───────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minuto
  max: 60,              // máx 60 requests/min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta de nuevo en un minuto' }
});
app.use('/api/', apiLimiter);

// ─── Validation helpers ───────────────────────────────────────────

// Validates the base URL: must be HTTPS and end with the allowed host suffix.
// Blocks loopback and private IP ranges (RFC 1918 / RFC 5735).
function validateProxyUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return 'URL inválida'; }

  if (parsed.protocol !== 'https:') return 'Solo se permite HTTPS';

  const host = parsed.hostname;

  // Block loopback and private ranges
  if (/^(localhost|127\.|10\.|169\.254\.|::1$)/.test(host)) return 'Host no permitido';
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'Host no permitido';
  if (/^192\.168\./.test(host)) return 'Host no permitido';

  // Allowlist: only SAP IBP domains (override via ALLOWED_HOST_SUFFIX env var)
  const suffix = process.env.ALLOWED_HOST_SUFFIX || '.ondemand.com';
  if (!host.endsWith(suffix)) return 'Host no permitido';

  return null;
}

// Validates that the OData service name is in the allowed list.
function validateService(service) {
  if (!service || !ALLOWED_SERVICES.includes(service)) return 'Servicio no permitido';
  return null;
}

// Validates the entity path: alphanumeric + underscores only, or $metadata.
// Prevents path traversal (../, extra slashes, special chars).
function validateEntityPath(entityPath) {
  if (!entityPath) return 'Path requerido';
  if (!/^\$?[a-zA-Z][a-zA-Z0-9_]*$/.test(entityPath)) return 'Path de entidad inválido';
  return null;
}

// ─── /api/proxy — OData JSON requests ────────────────────────────
// Body: { base, service, path, query, user, password }
// Server reconstructs: ${base}/sap/opu/odata/IBP/${service}/${path}?${query}
app.post('/api/proxy', async (req, res) => {
  const { base, service, path: entityPath, query, user, password } = req.body;

  if (!base || !service || !entityPath || !user || !password) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos' });
  }

  const baseError = validateProxyUrl(base + '/');
  const svcError  = validateService(service);
  const pathError = validateEntityPath(entityPath);

  if (baseError) return res.status(400).json({ error: baseError });
  if (svcError)  return res.status(400).json({ error: svcError });
  if (pathError) return res.status(400).json({ error: pathError });

  const url = `${base}${ODATA_PREFIX}${service}/${entityPath}${query ? '?' + query : ''}`;

  try {
    const auth = Buffer.from(`${user}:${password}`).toString('base64');
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[proxy] SAP error', resp.status, text.substring(0, 200));
      return res.status(resp.status).json({
        error: `Error al conectar con SAP IBP (${resp.status})`
      });
    }

    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('[proxy error]', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── /api/proxy-xml — OData $metadata requests ───────────────────
// Body: { base, service, user, password }
// Path is always $metadata — hardcoded server-side.
app.post('/api/proxy-xml', async (req, res) => {
  const { base, service, user, password } = req.body;

  if (!base || !service || !user || !password) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos' });
  }

  const baseError = validateProxyUrl(base + '/');
  const svcError  = validateService(service);

  if (baseError) return res.status(400).json({ error: baseError });
  if (svcError)  return res.status(400).json({ error: svcError });

  const url = `${base}${ODATA_PREFIX}${service}/$metadata`;

  try {
    const auth = Buffer.from(`${user}:${password}`).toString('base64');
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/xml'
      },
      timeout: 60000
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[proxy-xml] SAP error', resp.status, text.substring(0, 200));
      return res.status(resp.status).json({
        error: `Error al conectar con SAP IBP (${resp.status})`
      });
    }

    const text = await resp.text();
    res.type('text/xml').send(text);
  } catch (err) {
    console.error('[proxy-xml error]', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── /api/proxy-next — OData pagination next links ───────────────
// Used exclusively for __next / @odata.nextLink URLs returned by SAP IBP.
// Body: { url, user, password }
// Validates domain + that path starts with the expected OData prefix.
app.post('/api/proxy-next', async (req, res) => {
  const { url, user, password } = req.body;

  if (!url || !user || !password) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos' });
  }

  const urlError = validateProxyUrl(url);
  if (urlError) return res.status(400).json({ error: urlError });

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'URL inválida' }); }

  if (!parsed.pathname.startsWith(ODATA_PREFIX)) {
    return res.status(400).json({ error: 'Path no permitido' });
  }

  try {
    const auth = Buffer.from(`${user}:${password}`).toString('base64');
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[proxy-next] SAP error', resp.status, text.substring(0, 200));
      return res.status(resp.status).json({
        error: `Error al conectar con SAP IBP (${resp.status})`
      });
    }

    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('[proxy-next error]', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── /api/send-feedback ───────────────────────────────────────────
// Body: { name, app, type, description }
// Sends feedback email via EmailJS REST API using server-side credentials.
app.post('/api/send-feedback', async (req, res) => {
  const { name, app: appName, type, description } = req.body || {};

  if (!name || !description) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:      process.env.EMAILJS_SERVICE_ID,
        template_id:     process.env.EMAILJS_TEMPLATE_ID,
        user_id:         process.env.EMAILJS_PUBLIC_KEY,
        accessToken:     process.env.EMAILJS_PRIVATE_KEY,
        template_params: { from_name: name, app: appName, type, description }
      })
    });

    if (resp.ok) return res.json({ ok: true });

    const errBody = await resp.text();
    console.error('[feedback] EmailJS error:', resp.status, errBody);
    res.status(500).json({ error: 'Error al enviar feedback', detail: errBody });
  } catch (err) {
    console.error('[feedback error]', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║  IBP BOM Hierarchy v7                    ║`);
    console.log(`  ║  http://localhost:${PORT}                    ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  });
}

module.exports = app;
