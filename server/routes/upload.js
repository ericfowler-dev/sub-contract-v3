const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parseExcelFile } = require('../services/ingestion');
const { loadDb, saveDb } = require('../services/db');
const { pruneStaleProjections } = require('../services/projections');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, req.app.locals.uploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      return cb(new Error('Only .xlsx and .xls files are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

router.post('/', upload.single('file'), (req, res) => {
  const filePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const mode = req.body.mode || 'append'; // 'append' or 'replace'
    const fileName = req.file.originalname;

    // Parse the Excel file
    const newRows = parseExcelFile(filePath);

    const db = loadDb(req.app.locals.dataDir);

    let added = 0;
    let skipped = 0;
    const ingestedAt = new Date().toISOString();

    if (mode === 'replace') {
      // Reuse parsed row objects instead of allocating a second full collection.
      for (const row of newRows) {
        row.fileSource = fileName;
        row.ingestedAt = ingestedAt;
      }
      db.transactions = newRows;
      added = newRows.length;
    } else {
      // Append with dedup
      const existingKeys = new Set();
      for (const transaction of db.transactions) {
        existingKeys.add(transaction.compositeKey);
      }

      for (const row of newRows) {
        if (existingKeys.has(row.compositeKey)) {
          skipped++;
        } else {
          row.fileSource = fileName;
          row.ingestedAt = ingestedAt;
          db.transactions.push(row);
          existingKeys.add(row.compositeKey);
          added++;
        }
      }
    }

    // Update metadata
    db.metadata.lastUpload = new Date().toISOString();
    db.metadata.totalRows = db.transactions.length;
    db.metadata.uploadHistory.push({
      fileName,
      uploadedAt: new Date().toISOString(),
      mode,
      rowsParsed: newRows.length,
      rowsAdded: added,
      rowsSkipped: skipped,
    });

    // Auto-add new job numbers to mapping
    for (const row of newRows) {
      if (row.baseJob && !db.jobsiteMapping[row.baseJob]) {
        db.jobsiteMapping[row.baseJob] = `Unknown - ${row.baseJob}`;
      }
    }

    const projectionState = pruneStaleProjections(db.projections || [], db.transactions || []);
    db.projections = projectionState.projections;

    saveDb(req.app.locals.dataDir, db);

    res.json({
      success: true,
      fileName,
      mode,
      rowsParsed: newRows.length,
      rowsAdded: added,
      rowsSkipped: skipped,
      totalRows: db.transactions.length,
      staleProjectionsRemoved: projectionState.removed,
      projectionStartMonth: projectionState.projectionStartMonth,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // Uploads are only staging files. Keep them off the persistent disk after
    // both successful ingestion and recoverable parsing/database failures.
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        if (cleanupErr.code !== 'ENOENT') {
          console.error(`Unable to remove uploaded file ${filePath}:`, cleanupErr);
        }
      }
    }
  }
});

module.exports = router;
