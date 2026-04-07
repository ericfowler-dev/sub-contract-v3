const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const packageJson = require('../../package.json');
const { loadDb, saveDb } = require('../services/db');
const {
  computeSummary,
  computeSpendOverTime,
  computeJobsiteBreakdown,
  computeVendorAnalysis,
  computeTypeBreakdown,
  applyFilters,
  applyProjectionFilters,
} = require('../services/analytics');
const {
  parseProjectionImportFile,
  buildProjectionCsv,
  createProjectionImportKey,
  getLatestActualMonth,
  getProjectionStartMonth,
  isProjectionMonthAllowed,
  pruneStaleProjections,
} = require('../services/projections');

const router = express.Router();
const projectionImportUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.app.locals.uploadsDir),
    filename: (req, file, cb) => cb(null, `projection-import-${Date.now()}-${file.originalname}`),
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      return cb(new Error('Only .xlsx, .xls, and .csv files are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Parse filter params from query string
function getFilters(query) {
  return {
    startDate: query.startDate || null,
    endDate: query.endDate || null,
    jobsites: query.jobsites ? query.jobsites.split(',') : null,
    vendors: query.vendors ? query.vendors.split(',') : null,
    types: query.types ? query.types.split(',') : null,
    excludeVendors: query.excludeVendors ? query.excludeVendors.split(',') : null,
  };
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalizeSearchText(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, ' ');
}

function compareSortValues(a, b, dir = 1) {
  const isNumeric = typeof a === 'number' || typeof b === 'number';
  if (isNumeric) {
    const aNum = Number(a) || 0;
    const bNum = Number(b) || 0;
    if (aNum === bNum) return 0;
    return aNum < bNum ? -1 * dir : 1 * dir;
  }

  const aText = cleanText(a).toLowerCase();
  const bText = cleanText(b).toLowerCase();
  return aText.localeCompare(bText, undefined, { numeric: true, sensitivity: 'base' }) * dir;
}

function getTransactionSortValue(transaction, sortBy, jobsiteMapping = {}) {
  switch (sortBy) {
    case 'jobsite':
      return cleanText(jobsiteMapping[transaction.baseJob] || transaction.baseJob);
    case 'serviceOrder':
      return cleanText(transaction.serviceOrder);
    case 'category':
      return cleanText(transaction.category);
    case 'vendor':
      return cleanText(transaction.vendorName);
    case 'description':
      return cleanText(transaction.description);
    case 'debit':
      return Number(transaction.debit) || 0;
    case 'credit':
      return Number(transaction.credit) || 0;
    case 'net':
      return Number(transaction.net) || 0;
    case 'ref':
      return cleanText(transaction.ref);
    case 'date':
    default:
      return cleanText(transaction.date);
  }
}

function filterTransactionsBySearch(transactions, search, jobsiteMapping = {}) {
  const query = normalizeSearchText(search);
  if (!query) return transactions;

  return transactions.filter((transaction) => {
    const searchableFields = [
      transaction.date,
      jobsiteMapping[transaction.baseJob] || '',
      transaction.baseJob,
      transaction.serviceOrder,
      transaction.category,
      transaction.type,
      transaction.vendorName,
      transaction.description,
      transaction.ref,
    ];

    return searchableFields.some((value) => normalizeSearchText(value).includes(query));
  });
}

function filterProjectionsBySearch(projections, search, jobsiteMapping = {}) {
  const query = normalizeSearchText(search);
  if (!query) return projections;

  return projections.filter((projection) => {
    const searchableFields = [
      projection.month,
      jobsiteMapping[projection.baseJob] || '',
      projection.baseJob,
      projection.vendorName,
      projection.description,
      projection.descriptionDisplay,
      projection.invoiceNumber,
      projection.poNumber,
      projection.quoteNumber,
      projection.type,
    ];

    return searchableFields.some((value) => normalizeSearchText(value).includes(query));
  });
}

function extractProjectionReferences(description) {
  const source = cleanText(description);
  const invoiceMatch = source.match(/\b(?:inv(?:oice)?\.?\s*#?\s*:?\s*)([A-Za-z0-9-]+)/i);
  const poMatch = source.match(/\b(?:po\.?\s*#?\s*:?\s*)([A-Za-z0-9-]+)/i);

  let descriptionDisplay = source;
  if (invoiceMatch) descriptionDisplay = descriptionDisplay.replace(invoiceMatch[0], ' ');
  if (poMatch) descriptionDisplay = descriptionDisplay.replace(poMatch[0], ' ');

  descriptionDisplay = descriptionDisplay
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*[-:;,]+\s*$/g, '')
    .trim();

  return {
    invoiceNumber: invoiceMatch?.[1] || '',
    poNumber: poMatch?.[1] || '',
    descriptionDisplay,
  };
}

function normalizeProjection(projection) {
  const description = cleanText(projection.description);
  const derivedRefs = extractProjectionReferences(description);

  return {
    ...projection,
    description,
    descriptionDisplay: derivedRefs.descriptionDisplay || description,
    invoiceNumber: cleanText(projection.invoiceNumber || projection.invoice) || derivedRefs.invoiceNumber,
    poNumber: cleanText(projection.poNumber || projection.po) || derivedRefs.poNumber,
    quoteNumber: cleanText(projection.quoteNumber || projection.quote),
  };
}

function sanitizeProjectionInput(input = {}) {
  const sanitized = {};

  if (Object.prototype.hasOwnProperty.call(input, 'month')) sanitized.month = cleanText(input.month);
  if (Object.prototype.hasOwnProperty.call(input, 'baseJob')) sanitized.baseJob = cleanText(input.baseJob);
  if (Object.prototype.hasOwnProperty.call(input, 'vendorName')) sanitized.vendorName = cleanText(input.vendorName);
  if (Object.prototype.hasOwnProperty.call(input, 'description')) sanitized.description = cleanText(input.description);
  if (Object.prototype.hasOwnProperty.call(input, 'invoiceNumber') || Object.prototype.hasOwnProperty.call(input, 'invoice')) {
    sanitized.invoiceNumber = cleanText(input.invoiceNumber ?? input.invoice);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'poNumber') || Object.prototype.hasOwnProperty.call(input, 'po')) {
    sanitized.poNumber = cleanText(input.poNumber ?? input.po);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'quoteNumber') || Object.prototype.hasOwnProperty.call(input, 'quote')) {
    sanitized.quoteNumber = cleanText(input.quoteNumber ?? input.quote);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'amount')) sanitized.amount = Number(input.amount) || 0;
  if (Object.prototype.hasOwnProperty.call(input, 'type')) sanitized.type = cleanText(input.type) || 'PUR-SUB';

  return sanitized;
}

function createProjectionRecord(input = {}) {
  const sanitized = sanitizeProjectionInput(input);
  const [year, monthNum] = (sanitized.month || '').split('-').map(Number);

  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    month: sanitized.month,
    year: Number.isFinite(year) ? year : null,
    monthNum: Number.isFinite(monthNum) ? monthNum : null,
    baseJob: sanitized.baseJob || '',
    vendorName: sanitized.vendorName || '',
    description: sanitized.description || '',
    invoiceNumber: sanitized.invoiceNumber || '',
    poNumber: sanitized.poNumber || '',
    quoteNumber: sanitized.quoteNumber || '',
    amount: Number(sanitized.amount) || 0,
    type: sanitized.type || 'PUR-SUB',
    createdAt: new Date().toISOString(),
  };
}

function syncValidProjections(req, db) {
  const projectionState = pruneStaleProjections(db.projections || [], db.transactions || []);
  if (projectionState.removed) {
    db.projections = projectionState.projections;
    saveDb(req.app.locals.dataDir, db);
  }
  return projectionState;
}

// GET /api/summary
router.get('/summary', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const { projections } = syncValidProjections(req, db);
  const filters = getFilters(req.query);
  const filtered = applyFilters(db.transactions, filters);
  const filteredProjections = applyProjectionFilters(projections, filters);
  res.json(computeSummary(filtered, db.jobsiteMapping, filteredProjections));
});

// GET /api/spend-over-time
router.get('/spend-over-time', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const { projections } = syncValidProjections(req, db);
  const filters = getFilters(req.query);
  const filtered = applyFilters(db.transactions, filters);
  const actuals = computeSpendOverTime(filtered);
  const filteredProjections = applyProjectionFilters(projections, filters);

  // Aggregate projected line items by month
  const projByMonth = {};
  for (const p of filteredProjections) {
    if (!p.month || !p.amount) continue;
    if (!projByMonth[p.month]) projByMonth[p.month] = 0;
    projByMonth[p.month] += p.amount;
  }

  // Merge into timeline
  const allMonths = new Set(actuals.map(a => a.month));
  for (const month of Object.keys(projByMonth)) {
    allMonths.add(month);
  }
  const sortedMonths = [...allMonths].sort();

  let cumulativeNet = 0;
  const result = sortedMonths.map(month => {
    const actual = actuals.find(a => a.month === month) || {
      month, grossSpend: 0, customerCredits: 0, accountingAdj: 0, net: 0, stockMaterial: 0, purchaseAdj: 0,
    };
    const projected = projByMonth[month] || 0;
    const monthlyNet = Math.round((actual.net + projected) * 100) / 100;
    cumulativeNet = Math.round((cumulativeNet + monthlyNet) * 100) / 100;
    return {
      ...actual,
      projected: projected || null,
      monthlyNet,
      cumulativeNet,
    };
  });

  res.json(result);
});

// GET /api/jobsite-breakdown
router.get('/jobsite-breakdown', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const filtered = applyFilters(db.transactions, getFilters(req.query));
  res.json(computeJobsiteBreakdown(filtered, db.jobsiteMapping));
});

// GET /api/vendor-analysis
router.get('/vendor-analysis', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const filtered = applyFilters(db.transactions, getFilters(req.query));
  res.json(computeVendorAnalysis(filtered));
});

// GET /api/type-breakdown
router.get('/type-breakdown', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const filtered = applyFilters(db.transactions, getFilters(req.query));
  res.json(computeTypeBreakdown(filtered));
});

// GET /api/transactions
router.get('/transactions', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const filtered = applyFilters(db.transactions, getFilters(req.query));
  const searched = filterTransactionsBySearch(filtered, req.query.search, db.jobsiteMapping);

  // Pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const start = (page - 1) * limit;

  // Sorting
  const sortBy = req.query.sortBy || 'date';
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1;
  const sorted = [...searched].sort((a, b) => {
    const aVal = getTransactionSortValue(a, sortBy, db.jobsiteMapping);
    const bVal = getTransactionSortValue(b, sortBy, db.jobsiteMapping);
    return compareSortValues(aVal, bVal, sortDir);
  });

  res.json({
    data: sorted.slice(start, start + limit),
    total: sorted.length,
    page,
    limit,
    totalPages: Math.ceil(sorted.length / limit),
  });
});

// GET /api/filter-options
router.get('/filter-options', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const txns = db.transactions;
  const latestActualMonth = getLatestActualMonth(txns);
  const projectionStartMonth = getProjectionStartMonth(txns);
  const projections = Array.isArray(db.projections) ? db.projections : [];

  const jobsites = [...new Set([
    ...txns.map(t => t.baseJob),
    ...projections.map(p => p.baseJob).filter(Boolean),
  ])].sort().map(j => ({
    value: j,
    label: db.jobsiteMapping[j] || j,
  }));

  const vendors = [...new Set([
    ...txns.map(t => t.vendorName),
    ...projections.map(p => cleanText(p.vendorName)).filter(Boolean),
  ])].sort().map(v => ({
    value: v,
    label: v,
  }));

  const types = [...new Set([
    ...txns.map(t => t.type),
    ...projections.map(p => cleanText(p.type)).filter(Boolean),
  ])].sort();

  const dates = [
    ...txns.map(t => t.date).filter(Boolean),
    ...projections.map(p => p.month ? `${p.month}-01` : '').filter(Boolean),
  ].sort();

  res.json({
    jobsites,
    vendors,
    types,
    dateRange: {
      min: dates[0] || null,
      max: dates[dates.length - 1] || null,
    },
    latestActualMonth,
    projectionStartMonth,
  });
});

// GET /api/jobsite-mapping
router.get('/jobsite-mapping', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  res.json(db.jobsiteMapping);
});

// PUT /api/jobsite-mapping
router.put('/jobsite-mapping', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const updates = req.body;
  if (typeof updates !== 'object') {
    return res.status(400).json({ error: 'Expected JSON object of job number -> name mappings' });
  }
  Object.assign(db.jobsiteMapping, updates);
  saveDb(req.app.locals.dataDir, db);
  res.json({ success: true, mapping: db.jobsiteMapping });
});

// GET /api/projections
router.get('/projections', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const { projections } = syncValidProjections(req, db);
  const filteredProjections = applyProjectionFilters(projections, getFilters(req.query));
  const normalized = filteredProjections.map(normalizeProjection);
  res.json(filterProjectionsBySearch(normalized, req.query.search, db.jobsiteMapping));
});

// GET /api/projections/export
router.get('/projections/export', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const { projections } = syncValidProjections(req, db);
  const filteredProjections = applyProjectionFilters(projections, getFilters(req.query));
  const normalized = filteredProjections.map(normalizeProjection);
  const searched = filterProjectionsBySearch(normalized, req.query.search, db.jobsiteMapping);
  const csv = buildProjectionCsv(searched, db.jobsiteMapping);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=projected-costs-export.csv');
  res.send(csv);
});

// POST /api/projections/import
router.post('/projections/import', (req, res) => {
  projectionImportUpload.single('file')(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }

    let uploadedPath = req.file?.path;

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No projection import file uploaded.' });
      }

      const mode = req.body.mode === 'replace' ? 'replace' : 'append';
      const db = loadDb(req.app.locals.dataDir);
      if (!Array.isArray(db.projections)) db.projections = [];
      const projectionState = syncValidProjections(req, db);
      const projectionStartMonth = projectionState.projectionStartMonth;

      const parsed = parseProjectionImportFile(uploadedPath, db.jobsiteMapping);
      if (!parsed.rows.length && !parsed.errors.length) {
        return res.status(400).json({ error: 'The file did not contain any projection rows to import.' });
      }
      if (parsed.errors.length) {
        return res.status(400).json({
          error: `Projection import failed. ${parsed.errors.slice(0, 10).join(' ')}`,
        });
      }

      const eligibleRows = parsed.rows.filter((row) => isProjectionMonthAllowed(row.month, db.transactions));
      const rowsSkippedPastMonths = parsed.rows.length - eligibleRows.length;
      const importedItems = eligibleRows.map(createProjectionRecord);

      let rowsAdded = 0;
      let rowsSkippedDuplicates = 0;

      if (mode === 'replace') {
        db.projections = importedItems;
        rowsAdded = importedItems.length;
      } else {
        const existingKeys = new Set(db.projections.map(createProjectionImportKey));
        for (const item of importedItems) {
          const key = createProjectionImportKey(item);
          if (existingKeys.has(key)) {
            rowsSkippedDuplicates++;
            continue;
          }
          db.projections.push(item);
          existingKeys.add(key);
          rowsAdded++;
        }
      }

      saveDb(req.app.locals.dataDir, db);

      res.json({
        success: true,
        mode,
        fileName: req.file.originalname,
        rowsParsed: parsed.rows.length,
        rowsAdded,
        rowsSkipped: rowsSkippedDuplicates + rowsSkippedPastMonths,
        rowsSkippedDuplicates,
        rowsSkippedPastMonths,
        totalRows: db.projections.length,
        projectionStartMonth,
      });
    } catch (err) {
      console.error('Projection import error:', err);
      res.status(500).json({ error: err.message });
    } finally {
      if (uploadedPath && fs.existsSync(uploadedPath)) {
        fs.unlinkSync(uploadedPath);
      }
    }
  });
});

// POST /api/projections - add a new projected line item
router.post('/projections', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  if (!Array.isArray(db.projections)) db.projections = [];
  const p = sanitizeProjectionInput(req.body);
  const projectionStartMonth = getProjectionStartMonth(db.transactions);
  if (!/^\d{4}-\d{2}$/.test(p.month || '')) {
    return res.status(400).json({ error: 'Expected month in YYYY-MM format.' });
  }
  if (!isProjectionMonthAllowed(p.month, db.transactions)) {
    return res.status(400).json({
      error: projectionStartMonth
        ? `Projected month must be ${projectionStartMonth} or later.`
        : 'Projected month must be in YYYY-MM format.',
    });
  }
  if (!(p.amount > 0)) {
    return res.status(400).json({ error: 'Amount must be greater than zero.' });
  }
  const item = createProjectionRecord(p);
  db.projections.push(item);
  saveDb(req.app.locals.dataDir, db);
  res.json({ success: true, projection: normalizeProjection(item), total: db.projections.length });
});

// PUT /api/projections/:id - update a projected line item
router.put('/projections/:id', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  if (!Array.isArray(db.projections)) db.projections = [];
  const idx = db.projections.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Projection not found' });
  const updates = sanitizeProjectionInput(req.body);
  if (Object.prototype.hasOwnProperty.call(updates, 'month') && updates.month && !/^\d{4}-\d{2}$/.test(updates.month)) {
    return res.status(400).json({ error: 'Expected month in YYYY-MM format.' });
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'amount') && !(updates.amount > 0)) {
    return res.status(400).json({ error: 'Amount must be greater than zero.' });
  }
  const nextProjection = { ...db.projections[idx], ...updates };
  const projectionStartMonth = getProjectionStartMonth(db.transactions);
  if (!isProjectionMonthAllowed(nextProjection.month, db.transactions)) {
    return res.status(400).json({
      error: projectionStartMonth
        ? `Projected month must be ${projectionStartMonth} or later.`
        : 'Projected month must be in YYYY-MM format.',
    });
  }
  Object.assign(db.projections[idx], updates);
  // Recalculate year/monthNum if month changed
  if (updates.month) {
    db.projections[idx].year = parseInt(updates.month.split('-')[0]);
    db.projections[idx].monthNum = parseInt(updates.month.split('-')[1]);
  }
  saveDb(req.app.locals.dataDir, db);
  res.json({ success: true, projection: normalizeProjection(db.projections[idx]) });
});

// DELETE /api/projections - clear all projected line items
router.delete('/projections', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  if (!Array.isArray(db.projections)) db.projections = [];
  const removed = db.projections.length;
  db.projections = [];
  saveDb(req.app.locals.dataDir, db);
  res.json({ success: true, removed });
});

// DELETE /api/projections/:id
router.delete('/projections/:id', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  if (!Array.isArray(db.projections)) db.projections = [];
  db.projections = db.projections.filter(p => p.id !== req.params.id);
  saveDb(req.app.locals.dataDir, db);
  res.json({ success: true });
});

// GET /api/metadata
router.get('/metadata', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const projectionState = syncValidProjections(req, db);
  res.json({
    ...db.metadata,
    appVersion: packageJson.version,
    latestActualMonth: getLatestActualMonth(db.transactions),
    projectionStartMonth: projectionState.projectionStartMonth,
    totalProjections: projectionState.projections.length,
  });
});

// GET /api/export
router.get('/export', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const filtered = applyFilters(db.transactions, getFilters(req.query));
  const searched = filterTransactionsBySearch(filtered, req.query.search, db.jobsiteMapping);

  const csvHeaders = ['Date', 'Jobsite Name', 'Service Order', 'Category', 'Type', 'Vendor', 'Description', 'Debit', 'Credit', 'Net', 'Ref'];
  const csvRows = searched.map(t => [
    t.date,
    db.jobsiteMapping[t.baseJob] || t.baseJob,
    t.serviceOrder,
    t.category,
    t.type,
    t.vendorName,
    `"${(t.description || '').replace(/"/g, '""')}"`,
    t.debit,
    t.credit,
    t.net,
    `"${(t.ref || '').replace(/"/g, '""')}"`,
  ]);

  const csv = [csvHeaders.join(','), ...csvRows.map(r => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=subcontract-export.csv');
  res.send(csv);
});

module.exports = router;
