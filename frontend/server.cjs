const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Static files
app.use(express.static(DIST));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend serving on port ${PORT}`);
});
