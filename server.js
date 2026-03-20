/**
 * IBP BOM v6 — Express Proxy Server
 * Forwards OData requests to SAP IBP, handling CORS and authentication.
 * 
 * Usage:
 *   npm install
 *   npm start
 *   Open http://localhost:3000
 */

const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Proxy endpoint ───────────────────────────────────────────────
// POST /api/proxy
// Body: { url, user, password }
// Forwards GET request to the SAP IBP OData URL with Basic Auth
app.post('/api/proxy', async (req, res) => {
  const { url, user, password } = req.body;

  if (!url || !user || !password) {
    return res.status(400).json({ error: 'Missing url, user, or password' });
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
      return res.status(resp.status).json({
        error: `SAP IBP returned ${resp.status}`,
        detail: text.substring(0, 500)
      });
    }

    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Proxy for $metadata (returns XML) ────────────────────────────
app.post('/api/proxy-xml', async (req, res) => {
  const { url, user, password } = req.body;

  if (!url || !user || !password) {
    return res.status(400).json({ error: 'Missing url, user, or password' });
  }

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
      return res.status(resp.status).json({
        error: `SAP IBP returned ${resp.status}`,
        detail: text.substring(0, 500)
      });
    }

    const text = await resp.text();
    res.type('text/xml').send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║  IBP BOM Hierarchy v6                    ║`);
    console.log(`  ║  http://localhost:${PORT}                    ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  });
}

module.exports = app;
