const express = require('express');
const multer = require('multer');
const path = require('path');
const { parseExcelFile } = require('../services/ingestion');
const { loadDb, saveDb } = require('../services/db');

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
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const mode = req.body.mode || 'append'; // 'append' or 'replace'
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // Parse the Excel file
    const newRows = parseExcelFile(filePath);

    const db = loadDb(req.app.locals.dataDir);

    let added = 0;
    let skipped = 0;

    if (mode === 'replace') {
      db.transactions = newRows.map(r => ({
        ...r,
        fileSource: fileName,
        ingestedAt: new Date().toISOString(),
      }));
      added = newRows.length;
    } else {
      // Append with dedup
      const existingKeys = new Set(db.transactions.map(t => t.compositeKey));
      for (const row of newRows) {
        if (existingKeys.has(row.compositeKey)) {
          skipped++;
        } else {
          db.transactions.push({
            ...row,
            fileSource: fileName,
            ingestedAt: new Date().toISOString(),
          });
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

    saveDb(req.app.locals.dataDir, db);

    res.json({
      success: true,
      fileName,
      mode,
      rowsParsed: newRows.length,
      rowsAdded: added,
      rowsSkipped: skipped,
      totalRows: db.transactions.length,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
