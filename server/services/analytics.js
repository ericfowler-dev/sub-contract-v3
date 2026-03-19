function computeSummary(transactions, jobsiteMapping, projections = []) {
  if (!transactions.length && !projections.length) {
    return {
      totalGrossSpend: 0,
      totalCustomerCredits: 0,
      totalAccountingAdj: 0,
      netCostToPSI: 0,
      activeJobsites: 0,
      activeVendors: 0,
      dateRange: { start: null, end: null },
      totalRows: 0,
    };
  }

  const purSub = transactions.filter(t => t.type === 'PUR-SUB');
  const mfgCus = transactions.filter(t => t.type === 'MFG-CUS');
  const mfgVar = transactions.filter(t => t.type === 'MFG-VAR');

  const totalGrossSpend = sum(purSub, 'debit');
  const totalCustomerCredits = Math.abs(sum(mfgCus, 'net'));
  const totalAccountingAdj = Math.abs(sum(mfgVar, 'net'));
  const totalProjectedCost = sum(projections, 'amount');
  const netCostToPSI = sum(transactions, 'net') + totalProjectedCost;

  // Active in last 90 days
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const recent = transactions.filter(t => t.date >= ninetyDaysAgo);
  const activeJobsites = new Set(recent.map(t => t.baseJob)).size;
  const activeVendors = new Set(recent.filter(t => t.vendorName !== 'Internal / Non-Vendor').map(t => t.vendorName)).size;

  const dates = transactions.map(t => t.date).filter(Boolean).sort();
  const projectionDates = projections.filter(p => p.month).map(p => `${p.month}-01`).sort();
  const allDates = [...dates, ...projectionDates].sort();

  return {
    totalGrossSpend: round2(totalGrossSpend),
    totalCustomerCredits: round2(totalCustomerCredits),
    totalAccountingAdj: round2(totalAccountingAdj),
    netCostToPSI: round2(netCostToPSI),
    activeJobsites,
    activeVendors,
    dateRange: { start: allDates[0] || null, end: allDates[allDates.length - 1] || null },
    totalRows: transactions.length,
  };
}

function computeSpendOverTime(transactions) {
  const byMonth = {};
  for (const t of transactions) {
    const key = `${t.year}-${String(t.month).padStart(2, '0')}`;
    if (!byMonth[key]) {
      byMonth[key] = { month: key, grossSpend: 0, customerCredits: 0, accountingAdj: 0, net: 0, stockMaterial: 0, purchaseAdj: 0 };
    }
    byMonth[key].net += t.net;
    if (t.type === 'PUR-SUB') byMonth[key].grossSpend += t.debit;
    else if (t.type === 'MFG-CUS') byMonth[key].customerCredits += Math.abs(t.net);
    else if (t.type === 'MFG-VAR') byMonth[key].accountingAdj += Math.abs(t.net);
    else if (t.type === 'STK-MTL') byMonth[key].stockMaterial += t.debit;
    else if (t.type === 'ADJ-PUR') byMonth[key].purchaseAdj += Math.abs(t.net);
  }

  return Object.values(byMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(m => ({
      ...m,
      grossSpend: round2(m.grossSpend),
      customerCredits: round2(m.customerCredits),
      accountingAdj: round2(m.accountingAdj),
      net: round2(m.net),
      stockMaterial: round2(m.stockMaterial),
      purchaseAdj: round2(m.purchaseAdj),
    }));
}

function computeJobsiteBreakdown(transactions, jobsiteMapping) {
  // Group by SITE NAME (not base job) so duplicate sites are combined
  const bySite = {};
  for (const t of transactions) {
    const siteName = jobsiteMapping[t.baseJob] || `Unknown - ${t.baseJob}`;
    if (!bySite[siteName]) {
      bySite[siteName] = {
        jobsiteName: siteName,
        baseJobs: new Set(),
        grossSpend: 0,
        customerCredits: 0,
        accountingAdj: 0,
        otherAdj: 0,
        net: 0,
        transactionCount: 0,
        vendors: new Set(),
        serviceOrders: new Set(),
      };
    }
    const j = bySite[siteName];
    j.baseJobs.add(t.baseJob);
    j.net += t.net;
    j.transactionCount++;
    j.serviceOrders.add(t.serviceOrder);
    if (t.type === 'PUR-SUB') {
      j.grossSpend += t.debit;
      if (t.vendorName !== 'Internal / Non-Vendor') j.vendors.add(t.vendorName);
    }
    if (t.type === 'MFG-CUS') j.customerCredits += Math.abs(t.net);
    if (t.type === 'MFG-VAR') j.accountingAdj += Math.abs(t.net);
    if (t.type === 'ADJ-PUR' || t.type === 'STK-MTL') j.otherAdj += t.net;
  }

  return Object.values(bySite)
    .map(j => ({
      ...j,
      grossSpend: round2(j.grossSpend),
      customerCredits: round2(j.customerCredits),
      accountingAdj: round2(j.accountingAdj),
      otherAdj: round2(j.otherAdj),
      net: round2(j.net),
      baseJobs: [...j.baseJobs],
      vendors: [...j.vendors],
      serviceOrders: [...j.serviceOrders],
    }))
    .sort((a, b) => b.grossSpend - a.grossSpend);
}

function computeVendorAnalysis(transactions) {
  const purSub = transactions.filter(t => t.type === 'PUR-SUB');
  const byVendor = {};
  for (const t of purSub) {
    const name = t.vendorName;
    if (!byVendor[name]) {
      byVendor[name] = {
        vendorName: name,
        vendorId: t.vendorId,
        totalSpend: 0,
        invoiceCount: 0,
        activeJobs: new Set(),
      };
    }
    byVendor[name].totalSpend += t.debit;
    byVendor[name].invoiceCount++;
    byVendor[name].activeJobs.add(t.baseJob);
  }

  return Object.values(byVendor)
    .map(v => ({
      ...v,
      totalSpend: round2(v.totalSpend),
      avgInvoiceSize: round2(v.totalSpend / v.invoiceCount),
      activeJobs: [...v.activeJobs],
      jobCount: v.activeJobs.size,
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend);
}

function computeTypeBreakdown(transactions) {
  const byType = {};
  for (const t of transactions) {
    const key = `${t.year}-${String(t.month).padStart(2, '0')}`;
    if (!byType[key]) {
      byType[key] = { month: key, 'PUR-SUB': 0, 'MFG-CUS': 0, 'MFG-VAR': 0, 'STK-MTL': 0, 'ADJ-PUR': 0 };
    }
    byType[key][t.type] = (byType[key][t.type] || 0) + t.net;
  }

  return Object.values(byType)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(m => {
      const result = { month: m.month };
      for (const type of ['PUR-SUB', 'MFG-CUS', 'MFG-VAR', 'STK-MTL', 'ADJ-PUR']) {
        result[type] = round2(m[type] || 0);
      }
      return result;
    });
}

function applyFilters(transactions, filters) {
  let result = transactions;

  if (filters.startDate) {
    result = result.filter(t => t.date >= filters.startDate);
  }
  if (filters.endDate) {
    result = result.filter(t => t.date <= filters.endDate);
  }
  if (filters.jobsites && filters.jobsites.length) {
    result = result.filter(t => filters.jobsites.includes(t.baseJob));
  }
  if (filters.vendors && filters.vendors.length) {
    result = result.filter(t => filters.vendors.includes(t.vendorName));
  }
  if (filters.excludeVendors && filters.excludeVendors.length) {
    result = result.filter(t => !filters.excludeVendors.includes(t.vendorName));
  }
  if (filters.types && filters.types.length) {
    result = result.filter(t => filters.types.includes(t.type));
  }

  return result;
}

function applyProjectionFilters(projections, filters) {
  let result = Array.isArray(projections) ? projections : [];

  if (filters.startDate) {
    const startMonth = filters.startDate.slice(0, 7);
    result = result.filter(p => (p.month || '') >= startMonth);
  }
  if (filters.endDate) {
    const endMonth = filters.endDate.slice(0, 7);
    result = result.filter(p => (p.month || '') <= endMonth);
  }
  if (filters.jobsites && filters.jobsites.length) {
    result = result.filter(p => filters.jobsites.includes(p.baseJob));
  }
  if (filters.vendors && filters.vendors.length) {
    result = result.filter(p => filters.vendors.includes(p.vendorName));
  }
  if (filters.excludeVendors && filters.excludeVendors.length) {
    result = result.filter(p => !filters.excludeVendors.includes(p.vendorName));
  }
  if (filters.types && filters.types.length) {
    result = result.filter(p => filters.types.includes(p.type));
  }

  return result;
}

function sum(arr, field) {
  return arr.reduce((s, t) => s + (t[field] || 0), 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  computeSummary,
  computeSpendOverTime,
  computeJobsiteBreakdown,
  computeVendorAnalysis,
  computeTypeBreakdown,
  applyFilters,
  applyProjectionFilters,
};
