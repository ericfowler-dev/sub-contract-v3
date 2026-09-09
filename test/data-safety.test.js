const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const XLSX = require('xlsx');
const { getDefaultDb } = require('../server/models/schema');
const { loadDb, saveDb, invalidateCache } = require('../server/services/db');
const { parseExcelFile } = require('../server/services/ingestion');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcontract-test-'));
  t.after(() => { invalidateCache(); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

function fixture(filePath, { service = 'Service', net = 100, error = false, type = 'PUR-SUB', job = '200834-S1' } = {}) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Inventory WIP Reconciliation Report'], [], [],
    ['Account', 'Date', 'Type', 'Posted', 'Job', 'Debit', 'Credit', 'Net', 'Ref', 'Date_2', 'Part', 'Description', 'Month', 'YEAR', 'Vendor', 'Vendor Name', 'Pivot', 'Service'],
    ['WIP', 46023, type, 'Y', job, 100, 0, net, 'Supplier: 1 PS: 123', '', '', '', 1, 2026, 1, 'Vendor', '', service],
  ]);
  if (error) sheet.H5 = { t: 'e', v: 7 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'SubContract Detail');
  XLSX.writeFile(workbook, filePath);
}

test('corrupt database is never reset or overwritten', t => {
  const dir = tempDir(t);
  const dbPath = path.join(dir, 'db.json');
  fs.writeFileSync(dbPath, '{"transactions":');
  assert.throws(() => loadDb(dir), /not been reset/);
  assert.throws(() => saveDb(dir, getDefaultDb()));
  assert.equal(fs.readFileSync(dbPath, 'utf8'), '{"transactions":');
});

test('failed disk replacement preserves persisted and cached projected costs', t => {
  const dir = tempDir(t);
  const db = getDefaultDb();
  db.projections = [{ id: 'saved', amount: 1234 }];
  saveDb(dir, db);
  const edited = loadDb(dir);
  edited.projections = [];
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated disk failure'); };
  try { assert.throws(() => saveDb(dir, edited), /disk failure/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(loadDb(dir).projections, db.projections);
  invalidateCache();
  assert.deepEqual(loadDb(dir).projections, db.projections);
});

test('successful save retains a complete previous database backup', t => {
  const dir = tempDir(t);
  const original = getDefaultDb();
  original.projections = [{ id: 'saved', amount: 1234 }];
  saveDb(dir, original);
  const next = loadDb(dir);
  next.projections = [];
  saveDb(dir, next);
  const files = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(files.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'backups', files[0]))), original);
  fs.unlinkSync(path.join(dir, 'db.json'));
  invalidateCache();
  assert.throws(() => loadDb(dir), /backups exist/);
});

test('database caches are isolated by directory and from unsaved edits', t => {
  const one = tempDir(t), two = tempDir(t);
  const data = getDefaultDb();
  data.projections = [{ amount: 1234 }];
  saveDb(one, data);
  saveDb(two, getDefaultDb());
  assert.equal(loadDb(one).projections.length, 1);
  loadDb(one).projections.length = 0;
  assert.equal(loadDb(one).projections.length, 1);
  assert.equal(loadDb(two).projections.length, 0);
});

test('empty, erroneous and unreconciled workbooks are rejected', t => {
  const dir = tempDir(t), file = path.join(dir, 'input.xlsx');
  fixture(file, { service: '' });
  assert.throws(() => parseExcelFile(file), /No Service transactions/);
  fixture(file, { error: true });
  assert.throws(() => parseExcelFile(file), /Row 5: Net contains an Excel error/);
  fixture(file, { net: 99 });
  assert.throws(() => parseExcelFile(file), /Net does not equal/);
});

test('untagged service credits are included, while production and untagged spend stay excluded', t => {
  const dir = tempDir(t), file = path.join(dir, 'input.xlsx');
  for (const type of ['MFG-CUS', 'MFG-VAR']) {
    fixture(file, { service: '', type });
    assert.equal(parseExcelFile(file).length, 1);
  }
  fixture(file, { service: '', type: 'MFG-CUS', job: '200834-12' });
  assert.throws(() => parseExcelFile(file), /No Service transactions/);
  fixture(file, { service: 'Production', type: 'MFG-CUS' });
  assert.throws(() => parseExcelFile(file), /No Service transactions/);
  fixture(file, { service: '' });
  assert.throws(() => parseExcelFile(file), /No Service transactions/);
});

test('upload failures and successful replacements preserve projections', async t => {
  const dir = tempDir(t);
  const data = getDefaultDb();
  data.projections = [{ id: 'saved', month: '2026-03', amount: 1234 }];
  data.transactions = [{ compositeKey: 'old' }];
  saveDb(dir, data);
  const app = express();
  app.locals.dataDir = dir;
  app.locals.uploadsDir = path.join(dir, 'uploads');
  fs.mkdirSync(app.locals.uploadsDir);
  app.use('/api/upload', require('../server/routes/upload'));
  app.get('/health', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function upload(file, mode = 'replace') {
    const form = new FormData();
    form.set('mode', mode);
    form.set('file', new Blob([fs.readFileSync(file)]), path.basename(file));
    return fetch(`${base}/api/upload`, { method: 'POST', body: form });
  }
  const empty = path.join(dir, 'empty.xlsx');
  fixture(empty, { service: '' });
  assert.equal((await upload(empty)).status, 500);
  assert.deepEqual(loadDb(dir), data);

  const historical = path.resolve('SubContract Detail - 9.4.26.xlsx');
  const sample = path.join(dir, 'sample.xlsx');
  fixture(sample);
  const file = fs.existsSync(historical) ? historical : sample;
  const pending = upload(file);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  const response = await pending;
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  // Replace mode retains every source row, including identical legitimate lines.
  assert.equal(result.rowsAdded, file === historical ? 483 : 1);
  assert.deepEqual(loadDb(dir).projections, data.projections);
  assert.equal(loadDb(dir).metadata.totalRows, result.rowsAdded);
  assert.deepEqual(fs.readdirSync(app.locals.uploadsDir), []);
});
