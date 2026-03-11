const XLSX = require('xlsx');
const { normalizeRow } = require('./normalization');

function parseExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath);

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

  const serviceColIdx = headerMap['Service'];
  if (serviceColIdx === undefined) {
    throw new Error('Could not find "Service" column in headers');
  }

  // Filter and transform rows
  const rows = [];
  for (let i = 4; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const serviceVal = String(row[serviceColIdx] || '').trim();
    if (serviceVal !== 'Service') continue;

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

    rows.push(normalizeRow(parsed));
  }

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
