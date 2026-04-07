const express = require('express');
const {
  clearAuthCookie,
  getAuthState,
  getSafeRedirectPath,
  isAllowedEmail,
  isAuthConfigured,
  isAuthEnabled,
  renderLoginPage,
  setAuthCookie,
  validateSharedPassword,
} = require('../services/auth');

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/login', (req, res) => {
  const authState = getAuthState(req);
  const nextPath = getSafeRedirectPath(req.query.next || '/');

  if (!authState.enabled) {
    return res.redirect(nextPath);
  }

  if (authState.authenticated) {
    return res.redirect(nextPath);
  }

  return res.status(authState.configured ? 200 : 503).send(renderLoginPage({
    nextPath,
    errorMessage: authState.configured ? '' : 'Authentication is enabled, but the shared password or session secret is not configured yet.',
    statusCode: authState.configured ? 200 : 503,
  }));
});

router.get('/api/auth/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json(getAuthState(req));
});

router.post('/api/auth/login', (req, res) => {
  const authState = getAuthState(req);
  const enabled = authState.enabled;
  const configured = authState.configured;
  const nextPath = getSafeRedirectPath(req.body?.next || req.query.next || '/');
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');

  if (!enabled) {
    return res.json({ success: true, redirectTo: nextPath, authEnabled: false });
  }

  if (!configured) {
    return res.status(503).json({ error: 'Authentication is enabled but not configured.' });
  }

  if (!isAllowedEmail(email) || !validateSharedPassword(password)) {
    return res.status(401).json({
      error: `Use your @${authState.allowedDomain} email and the shared access password.`,
    });
  }

  setAuthCookie(res, email);
  return res.json({
    success: true,
    redirectTo: nextPath,
    user: { email: email.trim().toLowerCase() },
  });
});

router.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  return res.json({ success: true });
});

module.exports = router;
