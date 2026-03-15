const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');

app.use(express.static(DIST));
app.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.listen(PORT, () => console.log(`Frontend serving on port ${PORT}`));
