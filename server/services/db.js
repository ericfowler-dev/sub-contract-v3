const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { getDefaultDb } = require('../models/schema');

let dbCache = null;
let cachedPath = null;

function getDbPath(dataDir) {
  return path.resolve(dataDir, 'db.json');
}

function validateDb(data) {
  if (!data || !Array.isArray(data.transactions) ||
      (data.projections !== undefined && !Array.isArray(data.projections)) ||
      !data.jobsiteMapping || typeof data.jobsiteMapping !== 'object' ||
      !data.metadata || !Array.isArray(data.metadata.uploadHistory)) {
    throw new Error('Database structure is invalid. Existing data has been preserved; restore a verified backup.');
  }
}

function loadDb(dataDir) {
  const dbPath = getDbPath(dataDir);
  if (dbCache && cachedPath === dbPath) return structuredClone(dbCache);

  try {
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf-8');
      const data = JSON.parse(raw);
      validateDb(data);
      dbCache = data;
      cachedPath = dbPath;
    } else {
      const backupsDir = path.join(dataDir, 'backups');
      if (fs.existsSync(backupsDir) && fs.readdirSync(backupsDir).some(name => name.endsWith('.json'))) {
        throw new Error('Database is missing but backups exist. Restore a verified backup before continuing.');
      }
      saveDb(dataDir, getDefaultDb());
    }
  } catch (err) {
    throw new Error(`Unable to load database. Existing files have not been reset. ${err.message}`);
  }
  // Routes edit their own copy. A failed save must not change the dashboard cache.
  return structuredClone(dbCache);
}

function saveDb(dataDir, data) {
  const dbPath = getDbPath(dataDir);
  validateDb(data);
  const serialized = JSON.stringify(data);
  const nextCache = JSON.parse(serialized);
  validateDb(nextCache);
  fs.mkdirSync(dataDir, { recursive: true });
  const tempPath = `${dbPath}.${randomUUID()}.tmp`;
  try {
    // Write and flush a complete file before replacing the current database.
    const fd = fs.openSync(tempPath, 'wx');
    try {
      fs.writeFileSync(fd, serialized, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(dbPath)) {
      validateDb(JSON.parse(fs.readFileSync(dbPath, 'utf-8')));
      const backupsDir = path.join(dataDir, 'backups');
      fs.mkdirSync(backupsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/:/g, '-');
      fs.copyFileSync(dbPath, path.join(backupsDir, `db-${stamp}-${randomUUID()}.json`), fs.constants.COPYFILE_EXCL);
    }
    fs.renameSync(tempPath, dbPath);
    dbCache = nextCache;
    cachedPath = dbPath;
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function invalidateCache() {
  dbCache = null;
  cachedPath = null;
}

module.exports = { loadDb, saveDb, invalidateCache };
