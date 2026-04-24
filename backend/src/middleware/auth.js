'use strict';

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  // Allow internal server-to-server calls
  if (req.headers['x-internal'] === 'true') {
    req.user = { id: 0, isAdmin: true, internal: true };
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, isAdmin }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
