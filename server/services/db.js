const fs = require('fs');
const path = require('path');
const { getDefaultDb } = require('../models/schema');

let dbCache = null;

function getDbPath(dataDir) {
  return path.join(dataDir, 'db.json');
}

function loadDb(dataDir) {
  const dbPath = getDbPath(dataDir);
  if (dbCache) return dbCache;

  try {
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf-8');
      dbCache = JSON.parse(raw);
    } else {
      dbCache = getDefaultDb();
      saveDb(dataDir, dbCache);
    }
  } catch (err) {
    console.error('Error loading db, resetting:', err.message);
    dbCache = getDefaultDb();
    saveDb(dataDir, dbCache);
  }
  return dbCache;
}

function saveDb(dataDir, data) {
  const dbPath = getDbPath(dataDir);
  dbCache = data;
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
}

function invalidateCache() {
  dbCache = null;
}

module.exports = { loadDb, saveDb, invalidateCache };
