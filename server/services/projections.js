const XLSX = require('xlsx');

function parseProjectionImportFile(filePath, jobsiteMapping = {}) {
  const workbook = XLSX.readFile(filePath, { raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('No worksheet found in the uploaded file.');
  }

  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rawData.length) {
    return { rows: [], errors: [] };
  }

  const headerRowIndex = rawData.findIndex((row) => {
    const normalized = row.map(normalizeHeader).filter(Boolean);
    return normalized.includes('month') && normalized.includes('amount');
  });

  if (headerRowIndex === -1) {
    throw new Error('Could not find a header row. Expected at least Month and Amount columns.');
  }

  const headers = rawData[headerRowIndex].map(normalizeHeader);
  const jobsiteLookup = buildJobsiteLookup(jobsiteMapping);

  const rows = [];
  const errors = [];

  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.every((cell) => cleanText(cell) === '')) continue;

    const month = toMonthValue(getColumnValue(row, headers, ['month', 'projectedmonth']));
    const amount = toNumber(getColumnValue(row, headers, ['amount', 'projectedamount', 'cost']));
    const baseJob = resolveBaseJob(
      getColumnValue(row, headers, ['basejob', 'jobnumber', 'job', 'basenumber']),
      getColumnValue(row, headers, ['jobsitename', 'jobsite', 'sitename']),
      jobsiteLookup,
    );

    const item = {
      month,
      baseJob,
      vendorName: cleanText(getColumnValue(row, headers, ['vendorname', 'vendor', 'supplier'])),
      description: cleanText(getColumnValue(row, headers, ['description', 'scope', 'descriptionscope'])),
      invoiceNumber: cleanText(getColumnValue(row, headers, ['invoicenumber', 'invoice', 'invoiceno', 'inv'])),
      poNumber: cleanText(getColumnValue(row, headers, ['ponumber', 'po', 'pono'])),
      amount,
      type: cleanText(getColumnValue(row, headers, ['type', 'transactiontype'])).toUpperCase() || 'PUR-SUB',
    };

    const rowNumber = i + 1;
    if (!item.month) {
      errors.push(`Row ${rowNumber}: invalid or missing Month.`);
      continue;
    }
    if (!(item.amount > 0)) {
      errors.push(`Row ${rowNumber}: Amount must be greater than zero.`);
      continue;
    }

    rows.push(item);
  }

  return { rows, errors };
}

function buildProjectionCsv(projections, jobsiteMapping = {}) {
  const headers = ['Month', 'Base Job', 'Jobsite Name', 'Vendor', 'Description', 'Invoice Number', 'PO Number', 'Type', 'Amount'];
  const rows = projections.map((projection) => [
    projection.month || '',
    projection.baseJob || '',
    jobsiteMapping[projection.baseJob] || '',
    projection.vendorName || '',
    projection.description || '',
    projection.invoiceNumber || '',
    projection.poNumber || '',
    projection.type || 'PUR-SUB',
    projection.amount || 0,
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

function createProjectionImportKey(projection) {
  return [
    normalizeKey(projection.month),
    normalizeKey(projection.baseJob),
    normalizeKey(projection.vendorName),
    normalizeKey(projection.description),
    normalizeKey(projection.invoiceNumber),
    normalizeKey(projection.poNumber),
    normalizeKey(projection.type || 'PUR-SUB'),
    Number(projection.amount || 0).toFixed(2),
  ].join('|');
}

function getLatestActualMonth(transactions = []) {
  const months = transactions
    .map((transaction) => cleanText(transaction?.date).slice(0, 7))
    .filter((value) => /^\d{4}-\d{2}$/.test(value))
    .sort();

  return months[months.length - 1] || null;
}

function shiftMonth(monthValue, deltaMonths) {
  if (!/^\d{4}-\d{2}$/.test(monthValue || '')) return null;

  const [year, month] = monthValue.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return formatMonth(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

function getProjectionStartMonth(transactions = []) {
  const latestActualMonth = getLatestActualMonth(transactions);
  return latestActualMonth ? shiftMonth(latestActualMonth, 1) : null;
}

function isProjectionMonthAllowed(monthValue, transactions = []) {
  if (!/^\d{4}-\d{2}$/.test(monthValue || '')) return false;

  const projectionStartMonth = getProjectionStartMonth(transactions);
  if (!projectionStartMonth) return true;

  return monthValue >= projectionStartMonth;
}

function pruneStaleProjections(projections = [], transactions = []) {
  const projectionStartMonth = getProjectionStartMonth(transactions);
  const items = Array.isArray(projections) ? projections : [];

  if (!projectionStartMonth) {
    return { projections: items, removed: 0, projectionStartMonth };
  }

  const valid = [];
  let removed = 0;

  for (const projection of items) {
    if (isProjectionMonthAllowed(projection?.month, transactions)) {
      valid.push(projection);
    } else {
      removed++;
    }
  }

  return { projections: valid, removed, projectionStartMonth };
}

function normalizeHeader(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getColumnValue(row, headers, aliases) {
  const index = headers.findIndex((header) => aliases.includes(header));
  return index === -1 ? '' : row[index];
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function toMonthValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatMonth(value.getUTCFullYear(), value.getUTCMonth() + 1);
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m) {
      return formatMonth(parsed.y, parsed.m);
    }
  }

  const text = cleanText(value);
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  if (/^\d{4}\/\d{1,2}$/.test(text)) {
    const [year, month] = text.split('/').map(Number);
    return formatMonth(year, month);
  }

  const monthNameMatch = text.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (monthNameMatch) {
    const month = monthNameToNumber(monthNameMatch[1]);
    if (month) return formatMonth(Number(monthNameMatch[2]), month);
  }

  const directDate = new Date(text);
  if (!Number.isNaN(directDate.getTime())) {
    return formatMonth(directDate.getUTCFullYear(), directDate.getUTCMonth() + 1);
  }

  const monthNameDate = new Date(`1 ${text}`);
  if (!Number.isNaN(monthNameDate.getTime())) {
    return formatMonth(monthNameDate.getUTCFullYear(), monthNameDate.getUTCMonth() + 1);
  }

  return '';
}

function buildJobsiteLookup(jobsiteMapping) {
  const lookup = {};
  for (const [baseJob, siteName] of Object.entries(jobsiteMapping || {})) {
    const key = cleanText(siteName).toLowerCase();
    if (!key) continue;
    if (!lookup[key]) lookup[key] = [];
    lookup[key].push(baseJob);
  }
  return lookup;
}

function resolveBaseJob(baseJobValue, jobsiteValue, jobsiteLookup) {
  const rawBaseJob = cleanText(baseJobValue);
  const baseJobMatch = rawBaseJob.match(/\b(\d{6})\b/);
  if (baseJobMatch) return baseJobMatch[1];

  const jobsiteName = cleanText(jobsiteValue).toLowerCase();
  if (!jobsiteName) return '';

  const matches = jobsiteLookup[jobsiteName] || [];
  return matches.length === 1 ? matches[0] : '';
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase();
}

function formatMonth(year, month) {
  if (!year || !month) return '';
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthNameToNumber(value) {
  const months = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  return months[cleanText(value).toLowerCase()] || 0;
}

module.exports = {
  parseProjectionImportFile,
  buildProjectionCsv,
  createProjectionImportKey,
  getLatestActualMonth,
  getProjectionStartMonth,
  isProjectionMonthAllowed,
  pruneStaleProjections,
};
