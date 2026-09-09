const { applyFilters } = require('./analytics');

function buildQualityReport(transactions, options = {}) {
  const dates = transactions.map(row => row.date).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || '')).sort();
  const availableYears = [...new Set(dates.map(date => Number(date.slice(0, 4))))].sort((a, b) => b - a);
  const year = options.year === undefined ? (availableYears[0] || new Date().getFullYear()) : Number(options.year);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error('Select a valid report year.');
  const yearDates = dates.filter(date => date.startsWith(`${year}-`));
  const latestDate = yearDates.at(-1) || null;
  const throughMonth = options.throughMonth === undefined ? (latestDate ? Number(latestDate.slice(5, 7)) : 12) : Number(options.throughMonth);
  if (!Number.isInteger(throughMonth) || throughMonth < 1 || throughMonth > 12) throw new Error('Select a month from January through December.');
  const excludeRock = options.excludeRock === true;
  const startDate = `${year}-01-01`;
  const endDate = `${year}-${String(throughMonth).padStart(2, '0')}-${new Date(Date.UTC(year, throughMonth, 0)).getUTCDate()}`;
  const rows = applyFilters(transactions, { startDate, endDate, excludeVendors: excludeRock ? ['Rock Enterprises'] : null });
  const months = Array.from({ length: throughMonth }, (_, index) => ({ month: `${year}-${String(index + 1).padStart(2, '0')}`, cents: 0, transactionCount: 0 }));
  for (const row of rows) {
    const bucket = months[Number(row.date.slice(5, 7)) - 1];
    if (!Number.isFinite(row.net)) throw new Error('A transaction has an invalid net amount. Correct the source data before reporting.');
    bucket.cents += Math.round(row.net * 100);
    bucket.transactionCount++;
  }
  return {
    year, throughMonth, availableYears, latestDate, startDate, endDate, excludeRock,
    transactionCount: rows.length,
    total: months.reduce((sum, month) => sum + month.cents, 0) / 100,
    months: months.map(({ cents, ...month }) => ({ ...month, net: cents / 100 })),
  };
}

function buildQualityReportCsv(report) {
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const rows = [
    ['PSI Field Service Sub-Contract Quality Report'],
    ['Year', report.year, 'Through', labels[report.throughMonth - 1]],
    ['Basis', 'Posted net costs; projected costs excluded'],
    ['Vendors', report.excludeRock ? 'Excludes Rock Enterprises (PDX exhaust stack rust)' : 'All vendors'],
    ['Latest transaction loaded for year', report.latestDate || 'None'],
    [],
    ['Month', ...report.months.map(month => labels[Number(month.month.slice(5)) - 1]), 'YTD Total'],
    ['Net cost (USD)', ...report.months.map(month => month.net.toFixed(2)), report.total.toFixed(2)],
  ];
  return rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

module.exports = { buildQualityReport, buildQualityReportCsv };
