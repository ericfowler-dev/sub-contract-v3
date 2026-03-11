const express = require('express');
const { loadDb, saveDb } = require('../services/db');
const {
  computeSummary,
  computeSpendOverTime,
  computeJobsiteBreakdown,
  computeVendorAnalysis,
  computeTypeBreakdown,
  applyFilters,
} = require('../services/analytics');

const router = express.Router();

// Parse filter params from query string
function getFilters(query) {
  return {
    startDate: query.startDate || null,
    endDate: query.endDate || null,
    jobsites: query.jobsites ? query.jobsites.split(',') : null,
    vendors: query.vendors ? query.vendors.split(',') : null,
    types: query.types ? query.types.split(',') : null,
  };
}

// GET /api/summary
router.get('/summary', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const filtered = applyFilters(db.transactions, getFilters(req.query));
  res.json(computeSummary(filtered, db.jobsiteMapping));
});

// GET /api/spend-over-time
router.get('/spend-over-time', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const filtered = applyFilters(db.transactions, getFilters(req.query));
  const actuals = computeSpendOverTime(filtered);
  const projections = Array.isArray(db.projections) ? db.projections : [];

  // Aggregate projected line items by month
  const projByMonth = {};
  for (const p of projections) {
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

  const result = sortedMonths.map(month => {
    const actual = actuals.find(a => a.month === month) || {
      month, grossSpend: 0, customerCredits: 0, accountingAdj: 0, net: 0, stockMaterial: 0, purchaseAdj: 0,
    };
    return {
      ...actual,
      projected: projByMonth[month] || null,
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

  // Pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const start = (page - 1) * limit;

  // Sorting
  const sortBy = req.query.sortBy || 'date';
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    if (aVal < bVal) return -1 * sortDir;
    if (aVal > bVal) return 1 * sortDir;
    return 0;
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

  const jobsites = [...new Set(txns.map(t => t.baseJob))].sort().map(j => ({
    value: j,
    label: db.jobsiteMapping[j] || j,
  }));

  const vendors = [...new Set(txns.map(t => t.vendorName))].sort().map(v => ({
    value: v,
    label: v,
  }));

  const types = [...new Set(txns.map(t => t.type))].sort();

  const dates = txns.map(t => t.date).filter(Boolean).sort();

  res.json({
    jobsites,
    vendors,
    types,
    dateRange: {
      min: dates[0] || null,
      max: dates[dates.length - 1] || null,
    },
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
  res.json(db.projections || []);
});

// POST /api/projections - add a new projected line item
router.post('/projections', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  if (!Array.isArray(db.projections)) db.projections = [];
  const p = req.body;
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    month: p.month,
    year: p.year || parseInt(p.month?.split('-')[0]),
    monthNum: p.monthNum || parseInt(p.month?.split('-')[1]),
    baseJob: p.baseJob || '',
    vendorName: p.vendorName || '',
    description: p.description || '',
    amount: Number(p.amount) || 0,
    type: p.type || 'PUR-SUB',
    createdAt: new Date().toISOString(),
  };
  db.projections.push(item);
  saveDb(req.app.locals.dataDir, db);
  res.json({ success: true, projection: item, total: db.projections.length });
});

// PUT /api/projections/:id - update a projected line item
router.put('/projections/:id', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  if (!Array.isArray(db.projections)) db.projections = [];
  const idx = db.projections.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Projection not found' });
  const updates = req.body;
  Object.assign(db.projections[idx], updates);
  // Recalculate year/monthNum if month changed
  if (updates.month) {
    db.projections[idx].year = parseInt(updates.month.split('-')[0]);
    db.projections[idx].monthNum = parseInt(updates.month.split('-')[1]);
  }
  saveDb(req.app.locals.dataDir, db);
  res.json({ success: true, projection: db.projections[idx] });
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
  res.json(db.metadata);
});

// GET /api/export
router.get('/export', (req, res) => {
  const db = loadDb(req.app.locals.dataDir);
  const filtered = applyFilters(db.transactions, getFilters(req.query));

  const csvHeaders = ['Date', 'Jobsite Name', 'Service Order', 'Category', 'Type', 'Vendor', 'Description', 'Debit', 'Credit', 'Net', 'Ref'];
  const csvRows = filtered.map(t => [
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
