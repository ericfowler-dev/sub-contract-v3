const express = require('express');
const path = require('path');
const fs = require('fs');

const uploadRouter = require('./routes/upload');
const apiRouter = require('./routes/api');
const healthRouter = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directories exist
const dataDir = process.env.NODE_ENV === 'production' ? '/data' : path.join(__dirname, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Make dataDir available to routes
app.locals.dataDir = dataDir;
app.locals.uploadsDir = uploadsDir;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'client')));

// Routes
app.use('/api/health', healthRouter);
app.use('/api/upload', uploadRouter);
app.use('/api', apiRouter);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`PSI Sub-Contract Dashboard running on port ${PORT}`);
  console.log(`Data directory: ${dataDir}`);
});
