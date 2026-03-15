const express = require('express');
const path    = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app     = express();
const PORT    = process.env.PORT || 3000;
const DIST    = path.join(__dirname, 'dist');
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

console.log(`Frontend on port ${PORT}, proxying to: ${BACKEND}`);

// Proxy /api to backend — keep /api prefix intact
app.use('/api', createProxyMiddleware({
  target: BACKEND,
  changeOrigin: true,
  pathRewrite: { '^/api': '/api' }, // keep /api in the path
  on: {
    error: (err, req, res) => {
      console.error('[proxy error]', err.message);
      res.status(502).json({ error: 'Backend unreachable' });
    }
  }
}));

// Proxy socket.io
app.use('/socket.io', createProxyMiddleware({
  target: BACKEND,
  changeOrigin: true,
  ws: true,
}));

// Serve static files
app.use(express.static(DIST));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.listen(PORT, () => console.log(`Frontend ready on port ${PORT}`));
