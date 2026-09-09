const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const XLSX = require('xlsx');
const { buildQualityReport, buildQualityReportCsv } = require('../server/services/quality-report');
const { getDefaultDb } = require('../server/models/schema');
const { saveDb, invalidateCache } = require('../server/services/db');

const transactions = [
  { date: '2026-01-04', net: 100.12, vendorName: 'Vendor A' },
  { date: '2026-01-10', net: -20.11, vendorName: 'Internal / Non-Vendor' },
  { date: '2026-02-05', net: 35.50, vendorName: 'Rock Enterprises Inc' },
  { date: '2026-03-05', net: -10, vendorName: 'Vendor A' },
  { date: '2025-12-01', net: 999, vendorName: 'Vendor A' },
];

test('monthly net costs include offsets, zero-fill gaps and total exact cents', () => {
  const report = buildQualityReport(transactions, { year: 2026, throughMonth: 3, excludeRock: true });
  assert.deepEqual(report.months.map(month => month.net), [80.01, 0, -10]);
  assert.equal(report.total, 70.01);
  assert.equal(report.transactionCount, 3);
  assert.equal(report.latestDate, '2026-03-05');
  assert.equal(buildQualityReport(transactions, { year: 2026, throughMonth: 1 }).total, 80.01);
  assert.equal(buildQualityReport(transactions, { year: 2026, throughMonth: 3 }).total, 105.51);
});

test('year defaults, empty years and invalid selections are handled explicitly', () => {
  assert.equal(buildQualityReport(transactions).year, 2026);
  assert.equal(buildQualityReport(transactions).throughMonth, 3);
  const empty = buildQualityReport(transactions, { year: 2024, throughMonth: 7 });
  assert.equal(empty.transactionCount, 0);
  assert.equal(empty.total, 0);
  assert.equal(empty.latestDate, null);
  assert.throws(() => buildQualityReport(transactions, { year: 'bad' }), /valid report year/);
  assert.throws(() => buildQualityReport(transactions, { throughMonth: 13 }), /Select a month/);
});

test('summary CSV preserves cents and identifies the report basis and exclusions', () => {
  const report = buildQualityReport(transactions, { year: 2026, throughMonth: 3, excludeRock: true });
  const csv = buildQualityReportCsv(report);
  assert.match(csv, /projected costs excluded/);
  assert.match(csv, /Excludes Rock Enterprises/);
  const workbook = XLSX.read(csv, { type: 'string', raw: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
  assert.deepEqual(rows.at(-1), ['Net cost (USD)', '80.01', '0.00', '-10.00', '70.01']);
});

test('quality API ignores projected costs and matches the filtered transaction export', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-report-test-'));
  const db = getDefaultDb();
  db.transactions = transactions;
  db.projections = [{ month: '2026-01', amount: 500000, type: 'PUR-SUB' }];
  saveDb(dir, db);
  const app = express();
  app.locals.dataDir = dir;
  app.use('/api', require('../server/routes/api'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    invalidateCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const report = await (await fetch(`${base}/api/quality-report?year=2026&throughMonth=3&excludeRock=1`)).json();
  assert.equal(report.total, 70.01);
  const csv = await (await fetch(`${base}/api/export?startDate=2026-01-01&endDate=2026-03-31&excludeVendors=Rock%20Enterprises`)).text();
  const workbook = XLSX.read(csv, { type: 'string', raw: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  assert.equal(rows.reduce((sum, row) => sum + Math.round(Number(row.Net) * 100), 0), Math.round(report.total * 100));
  assert.equal((await fetch(`${base}/api/quality-report?year=invalid`)).status, 400);
  const exported = await fetch(`${base}/api/quality-report?year=2026&throughMonth=3&excludeRock=1&format=csv`);
  assert.match(exported.headers.get('content-disposition'), /quality-report-2026-03.csv/);
  assert.equal(await exported.text(), buildQualityReportCsv(report));
});
