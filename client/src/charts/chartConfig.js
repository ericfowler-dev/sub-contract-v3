const COLORS = {
  primary: '#2563eb',
  primaryLight: '#60a5fa',
  credit: '#10b981',
  creditLight: '#6ee7b7',
  adjustment: '#f59e0b',
  adjustmentLight: '#fcd34d',
  net: '#1e293b',
  danger: '#ef4444',
  stock: '#8b5cf6',
  purchase: '#ec4899',
  gray: '#94a3b8',
  gridLine: '#e2e8f0',
  vendorPalette: [
    '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  ],
};

Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#475569';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.tooltip.backgroundColor = '#1e293b';
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.padding = 12;

const ChartConfigs = {
  spendOverTime(data) {
    const hasProjections = data.some(d => d.projected !== null);
    const datasets = [
      {
        label: 'Gross Spend (PUR-SUB)',
        data: data.map(d => d.grossSpend),
        backgroundColor: COLORS.primary,
        borderRadius: 4,
        order: 3,
      },
      {
        label: 'Customer Credits',
        data: data.map(d => d.customerCredits),
        backgroundColor: COLORS.credit,
        borderRadius: 4,
        order: 4,
      },
      {
        label: 'Net Cost',
        data: data.map(d => d.net),
        type: 'line',
        borderColor: COLORS.net,
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: COLORS.net,
        tension: 0.3,
        order: 2,
      },
    ];

    if (hasProjections) {
      datasets.push({
        label: 'Projected Cost',
        data: data.map(d => d.projected),
        backgroundColor: 'rgba(239, 68, 68, 0.85)',
        borderColor: COLORS.danger,
        borderWidth: 2,
        borderDash: [6, 3],
        borderRadius: 4,
        order: 3,
      });
    }

    return {
      type: 'bar',
      data: {
        labels: data.map(d => Fmt.monthLabel(d.month)),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.raw === null) return null;
                return `${ctx.dataset.label}: ${Fmt.currency(ctx.raw)}`;
              },
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: (v) => Fmt.currency(v) },
            grid: { color: COLORS.gridLine },
          },
          x: {
            grid: { display: false },
          },
        },
      },
    };
  },

  jobsiteBreakdown(data) {
    const labels = data.map(d => d.jobsiteName);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Gross Spend',
            data: data.map(d => d.grossSpend),
            backgroundColor: COLORS.primary,
            borderRadius: 4,
          },
          {
            label: 'Customer Credits',
            data: data.map(d => -d.customerCredits),
            backgroundColor: COLORS.credit,
            borderRadius: 4,
          },
          {
            label: 'Accounting Adj',
            data: data.map(d => -d.accountingAdj),
            backgroundColor: COLORS.adjustment,
            borderRadius: 4,
          },
          {
            label: 'Net Cost',
            data: data.map(d => d.net),
            backgroundColor: COLORS.net,
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${Fmt.currency(Math.abs(ctx.raw))}`,
              footer: (items) => {
                const idx = items[0].dataIndex;
                const d = data[idx];
                return `\nGross ${Fmt.currency(d.grossSpend)} - Credits ${Fmt.currency(d.customerCredits)} - Adj ${Fmt.currency(d.accountingAdj)} = Net ${Fmt.currency(d.net)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { callback: (v) => Fmt.currency(v) },
            grid: { color: COLORS.gridLine },
          },
          y: {
            grid: { display: false },
          },
        },
      },
    };
  },

  vendorPie(data) {
    return {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.vendorName),
        datasets: [{
          data: data.map(d => d.totalSpend),
          backgroundColor: COLORS.vendorPalette.slice(0, data.length),
          borderWidth: 2,
          borderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = ((ctx.raw / total) * 100).toFixed(1);
                return `${ctx.label}: ${Fmt.currency(ctx.raw)} (${pct}%)`;
              },
            },
          },
        },
      },
    };
  },

  typeBreakdown(data) {
    return {
      type: 'bar',
      data: {
        labels: data.map(d => Fmt.monthLabel(d.month)),
        datasets: [
          {
            label: 'PUR-SUB (Sub-Contract)',
            data: data.map(d => d['PUR-SUB']),
            backgroundColor: COLORS.primary,
            stack: 'stack',
          },
          {
            label: 'MFG-CUS (Customer Credit)',
            data: data.map(d => d['MFG-CUS']),
            backgroundColor: COLORS.credit,
            stack: 'stack',
          },
          {
            label: 'MFG-VAR (Accounting)',
            data: data.map(d => d['MFG-VAR']),
            backgroundColor: COLORS.adjustment,
            stack: 'stack',
          },
          {
            label: 'STK-MTL (Stock)',
            data: data.map(d => d['STK-MTL']),
            backgroundColor: COLORS.stock,
            stack: 'stack',
          },
          {
            label: 'ADJ-PUR (Purchase Adj)',
            data: data.map(d => d['ADJ-PUR']),
            backgroundColor: COLORS.purchase,
            stack: 'stack',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${Fmt.currency(ctx.raw)}`,
            },
          },
        },
        scales: {
          y: {
            stacked: true,
            ticks: { callback: (v) => Fmt.currency(v) },
            grid: { color: COLORS.gridLine },
          },
          x: {
            stacked: true,
            grid: { display: false },
          },
        },
      },
    };
  },
};
