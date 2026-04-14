const Fmt = {
  currency(val) {
    if (val === null || val === undefined) return '--';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  },

  currencyFull(val) {
    if (val === null || val === undefined) return '--';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  },

  number(val) {
    if (val === null || val === undefined) return '--';
    return new Intl.NumberFormat('en-US').format(val);
  },

  date(val) {
    if (!val) return '--';
    const d = new Date(val + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },

  monthLabel(yyyymm) {
    if (!yyyymm) return '';
    const [y, m] = yyyymm.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(m) - 1]} ${y}`;
  },

  shortMonth(yyyymm) {
    if (!yyyymm) return '';
    const [y, m] = yyyymm.split('-');
    const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    return `${months[parseInt(m) - 1]}'${y.slice(2)}`;
  },

  truncate(str, len = 40) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  },

  typeLabel(type, includeCode = true) {
    const labels = {
      'PUR-SUB': 'Gross Spend',
      'MFG-CUS': 'Credits / Recoveries',
      'MFG-VAR': 'Accounting Adj',
      'STK-MTL': 'Stock Material',
      'ADJ-PUR': 'Purchase Adj',
    };
    const label = labels[type] || type || '--';
    return includeCode && labels[type] ? `${label} (${type})` : label;
  },
};
