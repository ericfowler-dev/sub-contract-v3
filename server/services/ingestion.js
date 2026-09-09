const XLSX = require('xlsx');
const { normalizeRow } = require('./normalization');

function parseExcelFile(filePath) {
  // XLSX files are compressed archives. Parsing every worksheet can consume
  // many times the uploaded file size, so only inflate the sheet we ingest.
  const workbook = XLSX.readFile(filePath, {
    sheets: 'SubContract Detail',
    dense: true,
    cellFormula: false,
    cellHTML: false,
    cellText: false,
  });

  if (!workbook.SheetNames.includes('SubContract Detail')) {
    throw new Error('Sheet "SubContract Detail" not found. Available sheets: ' + workbook.SheetNames.join(', '));
  }

  const sheet = workbook.Sheets['SubContract Detail'];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Header row is at index 3 (0-based)
  const headers = rawData[3];
  if (!headers || !headers.includes('Account')) {
    throw new Error('Could not find expected header row at index 3');
  }

  // Map header names to indices
  const headerMap = {};
  headers.forEach((h, i) => { headerMap[String(h).trim()] = i; });

  const required = ['Date', 'Type', 'Job', 'Debit', 'Credit', 'Net', 'Ref', 'Month', 'YEAR', 'Service'];
  const missing = required.filter(name => headerMap[name] === undefined);
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}. No data was changed.`);

  const serviceColIdx = headerMap['Service'];
  if (serviceColIdx === undefined) {
    throw new Error('Could not find "Service" column in headers');
  }

  // Filter and transform rows
  const rows = [];
  for (let i = 4; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    if (sheet[i]?.[serviceColIdx]?.t === 'e') {
      throw new Error(`Row ${i + 1}: Service contains an Excel error. Correct it before uploading. No data was changed.`);
    }

    const serviceVal = String(row[serviceColIdx] || '').trim();
    // Accounting exports can omit the Service tag on service-order credits
    // and variances. Include those offsets so net costs are not overstated.
    const serviceJob = /^\d{6}-S\d+$/i.test(String(row[headerMap['Job']] || '').trim());
    const type = String(row[headerMap['Type']] || '').trim();
    const untaggedServiceOffset = !serviceVal && serviceJob && ['MFG-CUS', 'MFG-VAR'].includes(type);
    if (serviceVal !== 'Service' && !untaggedServiceOffset) continue;

    for (const name of required) {
      if (sheet[i]?.[headerMap[name]]?.t === 'e') {
        throw new Error(`Row ${i + 1}: ${name} contains an Excel error. No data was changed.`);
      }
    }
    for (const name of ['Debit', 'Credit', 'Net']) {
      const value = row[headerMap[name]];
      if (!Number.isFinite(Number(value))) {
        throw new Error(`Row ${i + 1}: ${name} must be a number. No data was changed.`);
      }
    }

    const parsed = {
      date: excelDateToISO(row[headerMap['Date']]),
      type: String(row[headerMap['Type']] || '').trim(),
      job: String(row[headerMap['Job']] || '').trim().toUpperCase(),
      debit: toNumber(row[headerMap['Debit']]),
      credit: toNumber(row[headerMap['Credit']]),
      net: toNumber(row[headerMap['Net']]),
      ref: String(row[headerMap['Ref']] || '').trim(),
      part: String(row[headerMap['Part']] || '').trim(),
      description: String(row[headerMap['Description']] || '').trim(),
      month: toNumber(row[headerMap['Month']]),
      year: toNumber(row[headerMap['YEAR']]),
      vendorId: row[headerMap['Vendor']],
      vendorNameRaw: String(row[headerMap['Vendor Name']] ?? '').trim(),
    };

    if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) || !parsed.type || !parsed.job) {
      throw new Error(`Row ${i + 1}: invalid Date, Type, or Job. No data was changed.`);
    }
    if (Math.abs(parsed.debit - parsed.credit - parsed.net) > 0.011) {
      throw new Error(`Row ${i + 1}: Net does not equal Debit minus Credit. Recalculate the workbook before uploading. No data was changed.`);
    }
    // Derive the reporting period from the validated transaction date.
    parsed.year = Number(parsed.date.slice(0, 4));
    parsed.month = Number(parsed.date.slice(5, 7));

    rows.push(normalizeRow(parsed));
  }

  if (!rows.length) throw new Error('No Service transactions found. Existing transactions and projected costs were preserved.');
  return rows;
}

function excelDateToISO(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    // Excel serial date to JS Date
    const date = new Date((val - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? val : d.toISOString().split('T')[0];
  }
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  return null;
}

function toNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

module.exports = { parseExcelFile };
