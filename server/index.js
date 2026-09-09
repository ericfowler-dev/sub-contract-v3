const express = require('express');
const path = require('path');
const fs = require('fs');

const authRouter = require('./routes/auth');
const uploadRouter = require('./routes/upload');
const apiRouter = require('./routes/api');
const healthRouter = require('./routes/health');
const { getAuthState, isAuthConfigured, isAuthEnabled, renderLoginPage } = require('./services/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directories exist
const isHosted = process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID) || Boolean(process.env.RENDER_EXTERNAL_URL);
const dataDir = process.env.DATA_DIR || (isHosted || process.env.NODE_ENV === 'production' ? '/data' : path.join(__dirname, 'data'));
if (isHosted && !fs.existsSync(dataDir)) {
  throw new Error(`Persistent data directory ${dataDir} is unavailable. Refusing to use temporary storage.`);
}
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Make dataDir available to routes
app.locals.dataDir = dataDir;
app.locals.uploadsDir = uploadsDir;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/health', healthRouter);
app.use(authRouter);

app.use((req, res, next) => {
  if (!isAuthEnabled()) {
    return next();
  }

  const authState = getAuthState(req);
  if (authState.authenticated) {
    req.user = authState.user;
    return next();
  }

  if (!isAuthConfigured()) {
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({ error: 'Authentication is enabled but not configured.' });
    }
    return res.status(503).send(renderLoginPage({
      nextPath: req.originalUrl,
      errorMessage: 'Authentication is enabled, but the shared password or session secret is not configured yet.',
      statusCode: 503,
    }));
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const nextParam = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${nextParam}`);
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'client')));

app.use('/api/upload', uploadRouter);
app.use('/api', apiRouter);

app.use((err, req, res, next) => {
  console.error('Request failed:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`PSI Sub-Contract Dashboard running on port ${PORT}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Auth enabled: ${isAuthEnabled() ? 'yes' : 'no'}`);
  console.log(`Auth configured: ${isAuthConfigured() ? 'yes' : 'no'}`);
});
