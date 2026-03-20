const COLORS = {
  primary: '#2563eb',
  primaryLight: '#60a5fa',
  credit: '#10b981',
  creditLight: '#6ee7b7',
  adjustment: '#f59e0b',
  adjustmentLight: '#fcd34d',
  net: '#0f172a',
  monthlyNet: '#ea580c',
  avgGross: '#7c3aed',
  avgNet: '#475569',
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

function sumValues(rows, key) {
  return rows.reduce((total, row) => total + (Number(row?.[key]) || 0), 0);
}

function getActiveRows(rows) {
  return rows.filter((row) => {
    const values = [
      row.grossSpend,
      row.customerCredits,
      row.accountingAdj,
      row.stockMaterial,
      row.purchaseAdj,
      row.projected,
      row.monthlyNet,
      row.cumulativeNet,
    ];
    return values.some((value) => Math.abs(Number(value) || 0) > 0.004);
  });
}

function buildFlatLineData(length, value) {
  return Array.from({ length }, () => value);
}

function pickDatasetColor(dataset) {
  if (typeof dataset.borderColor === 'string') return dataset.borderColor;
  if (typeof dataset.backgroundColor === 'string') return dataset.backgroundColor;
  return '#ffffff';
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

const endValueLabelsPlugin = {
  id: 'endValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;

    const items = [];

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!dataset.endLabel || chart.isDatasetVisible(datasetIndex) === false) return;

      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta?.data?.length) return;

      let pointIndex = -1;
      for (let index = dataset.data.length - 1; index >= 0; index--) {
        const value = dataset.data[index];
        if (value === null || value === undefined) continue;
        if (!meta.data[index]) continue;
        pointIndex = index;
        break;
      }

      if (pointIndex === -1) return;

      const point = meta.data[pointIndex];
      const value = dataset.data[pointIndex];
      const text = typeof dataset.endLabel === 'function'
        ? dataset.endLabel(value, dataset, pointIndex)
        : dataset.endLabel;

      if (!text) return;

      items.push({
        color: pickDatasetColor(dataset),
        text,
        x: chartArea.right - 6,
        y: point.y,
      });
    });

    if (!items.length) return;

    ctx.save();
    ctx.font = '600 11px Inter, sans-serif';

    const paddingX = 8;
    const boxHeight = 20;
    const minGap = 6;

    items.sort((a, b) => a.y - b.y);
    for (let index = 1; index < items.length; index++) {
      const previous = items[index - 1];
      if (items[index].y - previous.y < boxHeight + minGap) {
        items[index].y = previous.y + boxHeight + minGap;
      }
    }

    for (let index = items.length - 2; index >= 0; index--) {
      const next = items[index + 1];
      if (next.y > chartArea.bottom - boxHeight / 2) {
        next.y = chartArea.bottom - boxHeight / 2;
      }
      if (next.y - items[index].y < boxHeight + minGap) {
        items[index].y = next.y - boxHeight - minGap;
      }
    }

    items.forEach((item) => {
      item.y = Math.max(chartArea.top + boxHeight / 2, Math.min(chartArea.bottom - boxHeight / 2, item.y));
      const textWidth = ctx.measureText(item.text).width;
      const boxWidth = textWidth + paddingX * 2;
      const boxX = item.x - boxWidth;
      const boxY = item.y - boxHeight / 2;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = item.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(item.text, boxX + paddingX, item.y + 0.5);
    });

    ctx.restore();
  },
};

Chart.register(endValueLabelsPlugin);

const ChartConfigs = {
  spendOverTime(data) {
    const hasProjections = data.some((row) => row.projected !== null);
    const activeRows = getActiveRows(data);
    const activeMonthCount = activeRows.length || data.length || 1;
    const avgGrossSpend = Math.round((sumValues(activeRows, 'grossSpend') / activeMonthCount) * 100) / 100;
    const avgMonthlyNet = Math.round((sumValues(activeRows, 'monthlyNet') / activeMonthCount) * 100) / 100;

    const datasets = [
      {
        label: 'Gross Spend',
        data: data.map((row) => row.grossSpend),
        backgroundColor: COLORS.primary,
        borderRadius: 4,
        maxBarThickness: 26,
        yAxisID: 'y',
        order: 5,
      },
      {
        label: 'Credits',
        data: data.map((row) => row.customerCredits),
        backgroundColor: COLORS.credit,
        borderRadius: 4,
        maxBarThickness: 26,
        yAxisID: 'y',
        order: 5,
      },
      {
        label: 'Monthly Net',
        data: data.map((row) => row.monthlyNet),
        type: 'line',
        borderColor: COLORS.monthlyNet,
        backgroundColor: 'rgba(234, 88, 12, 0.12)',
        borderWidth: 2.5,
        borderDash: [6, 4],
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: COLORS.monthlyNet,
        tension: 0.24,
        yAxisID: 'y',
        order: 2,
        endLabel: (value) => `Latest Monthly Net ${Fmt.currency(value ?? 0)}`,
      },
      {
        label: 'Avg Gross Spend / Active Month',
        data: buildFlatLineData(data.length, avgGrossSpend),
        type: 'line',
        borderColor: COLORS.avgGross,
        borderWidth: 2,
        borderDash: [9, 4],
        pointRadius: 0,
        tension: 0,
        yAxisID: 'y',
        order: 1,
        endLabel: () => `Avg Gross ${Fmt.currency(avgGrossSpend)}`,
      },
      {
        label: 'Avg Net / Active Month',
        data: buildFlatLineData(data.length, avgMonthlyNet),
        type: 'line',
        borderColor: COLORS.avgNet,
        borderWidth: 2,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: 0,
        yAxisID: 'y',
        order: 1,
        endLabel: () => `Avg Net ${Fmt.currency(avgMonthlyNet)}`,
      },
      {
        label: 'Net Cost To Date',
        data: data.map((row) => row.cumulativeNet),
        type: 'line',
        borderColor: COLORS.net,
        backgroundColor: 'transparent',
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 5,
        pointBackgroundColor: COLORS.net,
        tension: 0.18,
        yAxisID: 'y1',
        order: 0,
        endLabel: (value) => `Net To Date ${Fmt.currency(value ?? 0)}`,
      },
    ];

    if (hasProjections) {
      datasets.splice(2, 0, {
        label: 'Projected Cost',
        data: data.map((row) => row.projected),
        backgroundColor: 'rgba(239, 68, 68, 0.84)',
        borderColor: COLORS.danger,
        borderWidth: 2,
        borderDash: [6, 3],
        borderRadius: 4,
        maxBarThickness: 26,
        yAxisID: 'y',
        order: 4,
      });
    }

    return {
      type: 'bar',
      data: {
        labels: data.map((row) => Fmt.monthLabel(row.month)),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { right: 144 } },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.raw === null) return null;
                return `${ctx.dataset.label}: ${Fmt.currency(ctx.raw)}`;
              },
              footer: (items) => {
                const index = items[0]?.dataIndex;
                if (index === undefined) return '';
                const row = data[index];
                return [
                  `Monthly Net: ${Fmt.currency(row.monthlyNet)}`,
                  `Net To Date: ${Fmt.currency(row.cumulativeNet)}`,
                ];
              },
            },
          },
        },
        scales: {
          y: {
            position: 'left',
            ticks: { callback: (value) => Fmt.currency(value) },
            grid: { color: COLORS.gridLine },
            title: {
              display: true,
              text: 'Monthly Values',
            },
          },
          y1: {
            position: 'right',
            ticks: { callback: (value) => Fmt.currency(value) },
            grid: { drawOnChartArea: false },
            title: {
              display: true,
              text: 'Net Cost To Date',
            },
          },
          x: {
            grid: { display: false },
          },
        },
      },
    };
  },

  jobsiteBreakdown(data) {
    const labels = data.map((row) => row.jobsiteName);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Gross Spend',
            data: data.map((row) => row.grossSpend),
            backgroundColor: COLORS.primary,
            borderRadius: 4,
          },
          {
            label: 'Credits',
            data: data.map((row) => -row.customerCredits),
            backgroundColor: COLORS.credit,
            borderRadius: 4,
          },
          {
            label: 'Accounting Adj',
            data: data.map((row) => -row.accountingAdj),
            backgroundColor: COLORS.adjustment,
            borderRadius: 4,
          },
          {
            label: 'Net Cost',
            data: data.map((row) => row.net),
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
                const index = items[0].dataIndex;
                const row = data[index];
                return `\nGross ${Fmt.currency(row.grossSpend)} - Credits ${Fmt.currency(row.customerCredits)} - Adj ${Fmt.currency(row.accountingAdj)} = Net ${Fmt.currency(row.net)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { callback: (value) => Fmt.currency(value) },
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
        labels: data.map((row) => row.vendorName),
        datasets: [{
          data: data.map((row) => row.totalSpend),
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
                const total = ctx.dataset.data.reduce((sum, value) => sum + value, 0);
                const percent = total ? ((ctx.raw / total) * 100).toFixed(1) : '0.0';
                return `${ctx.label}: ${Fmt.currency(ctx.raw)} (${percent}%)`;
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
        labels: data.map((row) => Fmt.monthLabel(row.month)),
        datasets: [
          {
            label: Fmt.typeLabel('PUR-SUB'),
            data: data.map((row) => row['PUR-SUB']),
            backgroundColor: COLORS.primary,
            stack: 'stack',
          },
          {
            label: Fmt.typeLabel('MFG-CUS'),
            data: data.map((row) => row['MFG-CUS']),
            backgroundColor: COLORS.credit,
            stack: 'stack',
          },
          {
            label: Fmt.typeLabel('MFG-VAR'),
            data: data.map((row) => row['MFG-VAR']),
            backgroundColor: COLORS.adjustment,
            stack: 'stack',
          },
          {
            label: Fmt.typeLabel('STK-MTL'),
            data: data.map((row) => row['STK-MTL']),
            backgroundColor: COLORS.stock,
            stack: 'stack',
          },
          {
            label: Fmt.typeLabel('ADJ-PUR'),
            data: data.map((row) => row['ADJ-PUR']),
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
            ticks: { callback: (value) => Fmt.currency(value) },
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
