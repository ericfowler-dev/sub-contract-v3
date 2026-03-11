// Transaction type mapping
const TYPE_MAP = {
  'PUR-SUB': 'Sub-Contract Spend',
  'MFG-CUS': 'Customer Pay Credit',
  'MFG-VAR': 'Accounting Variance',
  'STK-MTL': 'Stock Material',
  'ADJ-PUR': 'Purchase Adjustment',
};

function normalizeRow(row) {
  // Job number normalization (already uppercased in ingestion)
  const jobMatch = row.job.match(/^(\d{6})-S(\d+)$/i);
  const baseJob = jobMatch ? jobMatch[1] : row.job.replace(/-.*/, '');
  const serviceOrder = jobMatch ? `${jobMatch[1]}-S${jobMatch[2]}` : row.job;

  // Vendor normalization
  let vendorName = row.vendorNameRaw;
  if (!vendorName || vendorName === '0' || vendorName.toLowerCase() === 'nan') {
    vendorName = 'Internal / Non-Vendor';
  } else {
    vendorName = toTitleCase(vendorName);
  }

  // Type category
  const category = TYPE_MAP[row.type] || row.type;

  // Reference parsing
  const refParsed = parseRef(row.ref);

  // Composite key for dedup
  const compositeKey = `${row.date}|${row.job}|${row.type}|${row.net}|${row.ref}`;

  return {
    date: row.date,
    month: row.month,
    year: row.year,
    type: row.type,
    category,
    job: row.job,
    baseJob,
    serviceOrder,
    debit: row.debit,
    credit: row.credit,
    net: row.net,
    ref: row.ref,
    refType: refParsed.type,
    refId: refParsed.id,
    refDocument: refParsed.document,
    part: row.part,
    description: row.description,
    vendorId: row.vendorId,
    vendorNameRaw: row.vendorNameRaw,
    vendorName,
    compositeKey,
  };
}

function parseRef(ref) {
  if (!ref) return { type: 'other', id: null, document: null };

  // "Supplier: 2064 PS: INV00787"
  const supplierMatch = ref.match(/Supplier:\s*(\S+)\s+PS:\s*(\S+)/i);
  if (supplierMatch) {
    return { type: 'supplier', id: supplierMatch[1], document: supplierMatch[2] };
  }

  // "Cust:8 PS:95743"
  const custMatch = ref.match(/Cust:(\S+)\s+PS:(\S+)/i);
  if (custMatch) {
    return { type: 'customer', id: custMatch[1], document: custMatch[2] };
  }

  // "Purge WIP to Cost of Sales"
  if (ref.toLowerCase().includes('purge')) {
    return { type: 'adjustment', id: null, document: null };
  }

  return { type: 'other', id: null, document: ref || null };
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

module.exports = { normalizeRow, TYPE_MAP };
