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

function buildFlatLineData(length, value) {
  return Array.from({ length }, () => value);
}

function colorValue(color) {
  return Array.isArray(color) ? color[0] : color;
}

function lastNumericIndex(values = []) {
  for (let i = values.length - 1; i >= 0; i--) {
    if (typeof values[i] === 'number' && Number.isFinite(values[i])) return i;
  }
  return -1;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

const spendOverTimeEndLabels = {
  id: 'spendOverTimeEndLabels',
  afterDatasetsDraw(chart, _args, options) {
    if (!options?.enabled || !chart.chartArea) return;

    const { ctx, chartArea } = chart;
    const labels = [];

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const endLabel = dataset.endLabel;
      if (!endLabel) return;

      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta || meta.hidden) return;

      const pointIndex = lastNumericIndex(dataset.data);
      if (pointIndex === -1 || !meta.data?.[pointIndex]) return;

      const value = dataset.data[pointIndex];
      const text = typeof endLabel?.text === 'function'
        ? endLabel.text(value, dataset, chart)
        : `${dataset.label} ${Fmt.currency(value)}`;

      if (!text) return;

      labels.push({
        color: endLabel.color || colorValue(dataset.borderColor || dataset.backgroundColor || COLORS.gray),
        text,
        x: meta.data[pointIndex].x,
        y: meta.data[pointIndex].y,
      });
    });

    if (!labels.length) return;

    labels.sort((a, b) => a.y - b.y);

    const labelHeight = 24;
    const minGap = labelHeight + 4;
    const minY = chartArea.top + labelHeight / 2;
    const maxY = chartArea.bottom - labelHeight / 2;

    labels[0].y = clamp(labels[0].y, minY, maxY);
    for (let i = 1; i < labels.length; i++) {
      labels[i].y = Math.max(labels[i].y, labels[i - 1].y + minGap);
    }
    if (labels[labels.length - 1].y > maxY) {
      labels[labels.length - 1].y = maxY;
      for (let i = labels.length - 2; i >= 0; i--) {
        labels[i].y = Math.min(labels[i].y, labels[i + 1].y - minGap);
      }
      labels[0].y = clamp(labels[0].y, minY, maxY);
    }

    const labelStartX = chartArea.right + 16;
    const connectorEndX = labelStartX - 8;
    ctx.save();
    ctx.font = `600 12px ${Chart.defaults.font.family}`;
    ctx.textBaseline = 'middle';

    labels.forEach((label) => {
      const textWidth = ctx.measureText(label.text).width;
      const boxWidth = textWidth + 18;
      const boxX = labelStartX;
      const boxY = label.y - labelHeight / 2;

      ctx.beginPath();
      ctx.strokeStyle = label.color;
      ctx.lineWidth = 1.25;
      ctx.moveTo(Math.min(label.x + 10, connectorEndX - 8), label.y);
      ctx.lineTo(connectorEndX, label.y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
      ctx.strokeStyle = label.color;
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, boxX, boxY, boxWidth, labelHeight, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = label.color;
      ctx.fillText(label.text, boxX + 9, label.y);
    });

    ctx.restore();
  },
};

Chart.register(spendOverTimeEndLabels);

const ChartConfigs = {
  spendOverTime(data) {
    const isCompact = window.innerWidth <= 900;
    const displayMonthCount = data.length || 1;
    const avgGrossSpend = Math.round((data.reduce((total, row) => (
      total + (Number(row.grossSpend) || 0) + (Number(row.projected) || 0)
    ), 0) / displayMonthCount) * 100) / 100;

    const datasets = [
      {
        label: 'Net Cost To Date',
        data: data.map((row) => row.cumulativeNet),
        type: 'line',
        yAxisID: 'yCumulative',
        borderColor: COLORS.net,
        backgroundColor: 'transparent',
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 5,
        pointBackgroundColor: COLORS.net,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        tension: 0.24,
        order: 0,
        endLabel: {
          color: COLORS.net,
          text: (value) => `Net To Date ${Fmt.currency(value ?? 0)}`,
        },
      },
      {
        label: 'Avg. Gross + Proj / month',
        data: buildFlatLineData(data.length, avgGrossSpend),
        type: 'line',
        yAxisID: 'yMonthly',
        borderColor: COLORS.avgGross,
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [9, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0,
        order: 1,
        endLabel: {
          color: COLORS.avgGross,
          text: () => `Avg Gross + Proj ${Fmt.currency(avgGrossSpend)}`,
        },
      },
      {
        label: 'Monthly Net',
        data: data.map((row) => row.monthlyNet),
        type: 'line',
        yAxisID: 'yMonthly',
        borderColor: COLORS.monthlyNet,
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        borderDash: [6, 4],
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: COLORS.monthlyNet,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1.5,
        tension: 0.24,
        order: 2,
        endLabel: {
          color: COLORS.monthlyNet,
          text: (value) => `Latest Monthly Net ${Fmt.currency(value ?? 0)}`,
        },
      },
    ];

    if (data.some((row) => row.projected !== null)) {
      datasets.push({
        label: 'Projected Cost',
        data: data.map((row) => row.projected),
        backgroundColor: 'rgba(239, 68, 68, 0.84)',
        borderColor: COLORS.danger,
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 26,
        categoryPercentage: 0.72,
        barPercentage: 0.82,
        yAxisID: 'yMonthly',
        order: 6,
      });
    }

    datasets.push(
      {
        label: 'Gross Spend',
        data: data.map((row) => row.grossSpend),
        backgroundColor: COLORS.primary,
        borderRadius: 4,
        maxBarThickness: 26,
        categoryPercentage: 0.72,
        barPercentage: 0.82,
        yAxisID: 'yMonthly',
        order: 7,
      },
      {
        label: 'Credits',
        data: data.map((row) => row.customerCredits),
        backgroundColor: COLORS.credit,
        borderRadius: 4,
        maxBarThickness: 26,
        categoryPercentage: 0.72,
        barPercentage: 0.82,
        yAxisID: 'yMonthly',
        order: 8,
      },
    );

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
        layout: {
          padding: {
            right: isCompact ? 24 : 220,
            top: 8,
          },
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'center',
            onHover: (_event, _legendItem, legend) => {
              if (legend?.chart?.canvas) legend.chart.canvas.style.cursor = 'pointer';
            },
            onLeave: (_event, _legendItem, legend) => {
              if (legend?.chart?.canvas) legend.chart.canvas.style.cursor = 'default';
            },
          },
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
                  `Actual Net: ${Fmt.currency(row.net)}`,
                  `Net Cost To Date: ${Fmt.currency(row.cumulativeNet)}`,
                ].join('\n');
              },
            },
          },
          spendOverTimeEndLabels: {
            enabled: !isCompact,
          },
        },
        scales: {
          yMonthly: {
            position: 'left',
            ticks: { callback: (value) => Fmt.currency(value) },
            grid: { color: COLORS.gridLine },
            title: {
              display: true,
              text: 'Monthly Values',
            },
          },
          yCumulative: {
            position: 'right',
            ticks: { callback: (value) => Fmt.currency(value) },
            grid: { drawOnChartArea: false },
            title: {
              display: true,
              text: 'Net Cost To Date',
            },
          },
          x: {
            offset: true,
            grid: { display: false },
            ticks: {
              autoSkip: isCompact,
              maxTicksLimit: isCompact ? 6 : undefined,
              maxRotation: 0,
              padding: 10,
            },
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
