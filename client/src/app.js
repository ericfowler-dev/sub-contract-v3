// PSI Sub-Contract Dashboard - Main App
const ROCK_ENTERPRISES_VENDOR = 'Rock Enterprises';
const TRANSACTION_PAGE_SIZE = 1000;

const App = {
  charts: {},
  filters: {},
  filterOptions: null,
  currentSort: { field: 'date', dir: 'desc' },
  tableSorts: {
    projectedData: { field: 'month', dir: 'asc' },
    vendorDetails: { field: 'totalSpend', dir: 'desc' },
    projectionSettings: { field: 'month', dir: 'asc' },
    jobsiteMapping: { field: 'job', dir: 'asc' },
  },
  currentPage: 1,
  jobsiteMapping: {},
  metadata: null,
  projections: [],
  filteredProjections: [],
  vendorAnalysisData: [],
  editingProjectionId: null,
  uploadState: { selectedFile: null },
  reportRoot: null,

  async init() {
    this.bindEvents();
    await this.loadFilterOptions();
    await this.loadJobsiteMapping();
    this.hydrateFiltersFromUrl();
    this.applyFilterStateToControls();
    await this.refresh();
    await this.loadMetadata();
  },

  bindEvents() {
    // Filter controls
    document.getElementById('btn-apply-filters').addEventListener('click', () => this.applyFilters());
    document.getElementById('btn-clear-filters').addEventListener('click', () => this.clearFilters());
    document.getElementById('btn-exclude-rock').addEventListener('click', () => this.toggleRockExclusion());
    document.getElementById('btn-share-view').addEventListener('click', () => this.copyShareLink());
    document.getElementById('btn-share-view').dataset.originalLabel = document.getElementById('btn-share-view').textContent;

    // Quick date range filters (YTD, Last 12 Mo, etc.)
    document.querySelectorAll('.quick-filter').forEach(btn => {
      btn.addEventListener('click', () => this.applyQuickFilter(btn.dataset.range));
    });

    // Modal toggles
    document.getElementById('btn-upload-panel').addEventListener('click', () => {
      this.resetUploadModalState();
      this.showModal('upload-modal');
    });
    document.getElementById('btn-settings-panel').addEventListener('click', () => {
      this.showModal('settings-modal');
      this.renderSettingsMapping();
      this.renderProjections();
    });

    // Settings tab switching
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    // Close modals
    document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
      el.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal');
        if (modal) this.hideModal(modal.id);
      });
    });

    // Upload
    this.initUpload();

    // Export
    document.getElementById('btn-export-csv').addEventListener('click', () => this.exportCSV());
    document.getElementById('btn-print-report').addEventListener('click', () => this.printReport());
    document.getElementById('btn-export-jpeg').addEventListener('click', () => this.exportJPEG());
    document.getElementById('btn-import-projections').addEventListener('click', () => {
      document.getElementById('proj-import-file').click();
    });
    document.getElementById('proj-import-file').addEventListener('change', () => this.importProjectionsFile());
    document.getElementById('btn-export-projections-csv').addEventListener('click', () => this.exportProjectionsCSV());
    document.getElementById('btn-export-projected-data-csv').addEventListener('click', () => this.exportProjectionsCSV(true));
    document.getElementById('btn-clear-projections').addEventListener('click', () => this.clearAllProjections());
    document.getElementById('btn-cancel-projection-edit').addEventListener('click', () => this.cancelProjectionEdit());

    this.bindSortableHeaders('#data-table', 'transactions');
    this.bindSortableHeaders('#projected-data-table', 'projectedData');
    this.bindSortableHeaders('#tab-projections .data-table.compact', 'projectionSettings');
    this.bindSortableHeaders('#tab-mapping .settings-table', 'jobsiteMapping');
  },

  resolveTableElement(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.querySelector(target) : target;
  },

  getSortState(tableKey) {
    return tableKey === 'transactions' ? this.currentSort : this.tableSorts[tableKey];
  },

  getDefaultSortDirection(field) {
    return ['date', 'debit', 'credit', 'net', 'amount', 'totalSpend', 'invoiceCount', 'avgInvoiceSize', 'jobCount'].includes(field)
      ? 'desc'
      : 'asc';
  },

  bindSortableHeaders(tableTarget, tableKey) {
    const table = this.resolveTableElement(tableTarget);
    if (!table) return;

    table.querySelectorAll('th[data-sort]').forEach(th => {
      if (th.dataset.sortBound === '1') return;
      th.dataset.sortBound = '1';
      th.addEventListener('click', () => this.toggleTableSort(tableKey, th.dataset.sort));
    });

    this.updateSortHeaderClasses(table, this.getSortState(tableKey));
  },

  updateSortHeaderClasses(tableTarget, sortState) {
    const table = this.resolveTableElement(tableTarget);
    if (!table || !sortState) return;

    table.querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === sortState.field) {
        th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  },

  toggleTableSort(tableKey, field) {
    const current = this.getSortState(tableKey) || { field: '', dir: 'asc' };
    const dir = current.field === field
      ? (current.dir === 'asc' ? 'desc' : 'asc')
      : this.getDefaultSortDirection(field);

    if (tableKey === 'transactions') {
      this.currentSort = { field, dir };
      this.currentPage = 1;
      this.loadTransactions();
      return;
    }

    this.tableSorts[tableKey] = { field, dir };

    if (tableKey === 'projectedData') {
      this.loadProjectedCosts();
      return;
    }
    if (tableKey === 'vendorDetails') {
      this.renderVendorAnalysis(this.vendorAnalysisData);
      return;
    }
    if (tableKey === 'projectionSettings') {
      this.renderProjections();
      return;
    }
    if (tableKey === 'jobsiteMapping') {
      this.renderSettingsMapping(document.getElementById('settings-search')?.value || '');
    }
  },

  sortItems(items, getValue, dir = 'asc') {
    const factor = dir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const aVal = getValue(a);
      const bVal = getValue(b);
      const isNumeric = typeof aVal === 'number' || typeof bVal === 'number';

      if (isNumeric) {
        const aNum = Number(aVal) || 0;
        const bNum = Number(bVal) || 0;
        if (aNum === bNum) return 0;
        return aNum < bNum ? -1 * factor : 1 * factor;
      }

      return String(aVal ?? '').localeCompare(String(bVal ?? ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      }) * factor;
    });
  },

  getProjectedSortValue(projection, field) {
    switch (field) {
      case 'month':
        return projection.month || '';
      case 'jobsite':
        return this.jobsiteMapping[projection.baseJob] || projection.baseJob || '';
      case 'vendor':
        return projection.vendorName || '';
      case 'description':
        return projection.descriptionDisplay || projection.description || '';
      case 'invoice':
        return projection.invoiceNumber || '';
      case 'po':
        return projection.poNumber || '';
      case 'type':
        return Fmt.typeLabel(projection.type || 'PUR-SUB');
      case 'amount':
        return Number(projection.amount) || 0;
      default:
        return '';
    }
  },

  getVendorSortValue(vendor, field) {
    switch (field) {
      case 'vendorName':
        return vendor.vendorName || '';
      case 'totalSpend':
        return Number(vendor.totalSpend) || 0;
      case 'invoiceCount':
        return Number(vendor.invoiceCount) || 0;
      case 'avgInvoiceSize':
        return Number(vendor.avgInvoiceSize) || 0;
      case 'jobCount':
        return Number(vendor.jobCount) || 0;
      default:
        return '';
    }
  },

  getMappingSortValue([job, name], field) {
    switch (field) {
      case 'job':
        return job || '';
      case 'name':
        return name || '';
      case 'status':
        if (!name || name.startsWith('Unknown')) return 'Unknown';
        if (name.includes('Multiple') || name.includes('Review') || name.includes('Ambiguous')) return 'Review';
        return 'Matched';
      default:
        return '';
    }
  },

  // -- API Helpers --
  buildQueryString() {
    const params = new URLSearchParams();
    if (this.filters.startDate) params.set('startDate', this.filters.startDate + '-01');
    if (this.filters.endDate) {
      // End of month
      const [y, m] = this.filters.endDate.split('-');
      const lastDay = new Date(y, m, 0).getDate();
      params.set('endDate', `${this.filters.endDate}-${lastDay}`);
    }
    if (this.filters.jobsites?.length) params.set('jobsites', this.filters.jobsites.join(','));
    if (this.filters.vendors?.length) params.set('vendors', this.filters.vendors.join(','));
    if (this.filters.types?.length) params.set('types', this.filters.types.join(','));
    if (this.filters.excludeRock) params.set('excludeVendors', ROCK_ENTERPRISES_VENDOR);
    return params.toString();
  },

  normalizeMonthValue(value) {
    return /^\d{4}-\d{2}$/.test(value || '') ? value : null;
  },

  hydrateFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const parseList = (key) => {
      const value = params.get(key);
      return value ? value.split(',').filter(Boolean) : null;
    };

    this.filters = {
      startDate: this.normalizeMonthValue(params.get('start')),
      endDate: this.normalizeMonthValue(params.get('end')),
      jobsites: parseList('jobsites'),
      vendors: parseList('vendors'),
      types: parseList('types'),
      excludeRock: params.get('excludeRock') === '1',
    };
  },

  syncFiltersToUrl() {
    const params = new URLSearchParams();
    if (this.filters.startDate) params.set('start', this.filters.startDate);
    if (this.filters.endDate) params.set('end', this.filters.endDate);
    if (this.filters.jobsites?.length) params.set('jobsites', this.filters.jobsites.join(','));
    if (this.filters.vendors?.length) params.set('vendors', this.filters.vendors.join(','));
    if (this.filters.types?.length) params.set('types', this.filters.types.join(','));
    if (this.filters.excludeRock) params.set('excludeRock', '1');

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  },

  async api(endpoint) {
    const qs = this.buildQueryString();
    const url = `/api/${endpoint}${qs ? '?' + qs : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },

  // -- Data Loading --
  async refresh() {
    try {
      const [summary, spendTime, jobsites, vendors] = await Promise.all([
        this.api('summary'),
        this.api('spend-over-time'),
        this.api('jobsite-breakdown'),
        this.api('vendor-analysis'),
      ]);

      this.renderKPIs(summary);
      this.renderSpendOverTime(spendTime);
      this.renderJobsiteBreakdown(jobsites);
      this.renderVendorAnalysis(vendors);
      await Promise.all([
        this.loadTransactions(),
        this.loadProjectedCosts(),
      ]);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  },

  async loadFilterOptions() {
    try {
      this.filterOptions = await this.api('filter-options');
      this.renderFilterControls();
    } catch (err) {
      console.error('Failed to load filter options:', err);
    }
  },

  async loadJobsiteMapping() {
    try {
      this.jobsiteMapping = await (await fetch('/api/jobsite-mapping')).json();
    } catch (err) {
      console.error('Failed to load jobsite mapping:', err);
    }
  },

  async loadMetadata() {
    try {
      const meta = await (await fetch('/api/metadata')).json();
      this.metadata = meta;
      const status = document.getElementById('data-status');
      const versionChip = document.getElementById('app-version');
      if (meta.lastUpload) {
        const d = new Date(meta.lastUpload);
        status.textContent = `${meta.totalRows} rows | Last upload: ${d.toLocaleDateString()}`;
        status.classList.add('data-status-active');
      } else {
        status.textContent = 'No data loaded';
        status.classList.remove('data-status-active');
      }
      if (versionChip) {
        versionChip.textContent = meta.appVersion ? `v${meta.appVersion}` : 'v1.4.0';
      }
      this.updateProjectionWindowNote();
    } catch (err) { /* ignore */ }
  },

  // -- KPI Cards --
  renderKPIs(data) {
    document.getElementById('kpi-gross-spend').textContent = Fmt.currency(data.totalGrossSpend);
    document.getElementById('kpi-customer-credits').textContent = Fmt.currency(data.totalCustomerCredits);
    document.getElementById('kpi-accounting-adj').textContent = Fmt.currency(data.totalAccountingAdj);
    document.getElementById('kpi-net-cost').textContent = Fmt.currency(data.netCostToPSI);

    const dateRange = document.getElementById('kpi-date-range');
    if (data.dateRange.start && data.dateRange.end) {
      dateRange.textContent = `${Fmt.date(data.dateRange.start)} - ${Fmt.date(data.dateRange.end)}`;
    } else {
      dateRange.textContent = '--';
    }
    document.getElementById('kpi-total-rows').textContent = `${Fmt.number(data.totalRows)} transactions`;
  },

  // -- Charts --
  renderSpendOverTime(data) {
    this.destroyChart('spendOverTime');
    if (!data.length) return;
    const ctx = document.getElementById('chart-spend-over-time').getContext('2d');
    this.charts.spendOverTime = new Chart(ctx, ChartConfigs.spendOverTime(data));
  },

  renderJobsiteBreakdown(data) {
    this.destroyChart('jobsiteBreakdown');
    if (!data.length) return;
    const topSites = data.slice(0, 10);
    const ctx = document.getElementById('chart-jobsite-breakdown').getContext('2d');
    const container = ctx.canvas.parentElement;
    container.style.height = `${Math.max(280, topSites.length * 28 + 40)}px`;
    this.charts.jobsiteBreakdown = new Chart(ctx, ChartConfigs.jobsiteBreakdown(topSites));
  },

  renderVendorAnalysis(data) {
    this.destroyChart('vendorPie');
    this.vendorAnalysisData = Array.isArray(data) ? data : [];

    // Vendor table
    const container = document.getElementById('vendor-table-container');
    if (!this.vendorAnalysisData.length) {
      container.innerHTML = '<div class="empty-state">No vendor data available for the current filters.</div>';
      return;
    }

    const sortState = this.tableSorts.vendorDetails;
    const sorted = this.sortItems(this.vendorAnalysisData, item => this.getVendorSortValue(item, sortState.field), sortState.dir);

    let html = '<table class="data-table compact"><thead><tr><th data-sort="vendorName">Vendor</th><th class="num" data-sort="totalSpend">Spend</th><th class="num" data-sort="invoiceCount">Invoices</th><th class="num" data-sort="avgInvoiceSize">Avg Size</th><th class="num" data-sort="jobCount">Jobs</th></tr></thead><tbody>';
    for (const v of sorted) {
      html += `<tr>
        <td>${this.escapeHtml(v.vendorName || '--')}</td>
        <td class="num">${Fmt.currency(v.totalSpend)}</td>
        <td class="num">${v.invoiceCount}</td>
        <td class="num">${Fmt.currency(v.avgInvoiceSize)}</td>
        <td class="num">${v.jobCount}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
    this.bindSortableHeaders(container.querySelector('table'), 'vendorDetails');
  },

  renderTypeBreakdown(data) {
    this.destroyChart('typeBreakdown');
    if (!data.length) return;
    const ctx = document.getElementById('chart-type-breakdown').getContext('2d');
    this.charts.typeBreakdown = new Chart(ctx, ChartConfigs.typeBreakdown(data));
  },

  destroyChart(name) {
    if (this.charts[name]) {
      this.charts[name].destroy();
      this.charts[name] = null;
    }
  },

  // -- Data Table --
  async loadTransactions() {
    try {
      const qs = this.buildQueryString();
      const sortField = this.currentSort?.field || 'date';
      const sortDir = this.currentSort?.dir || 'desc';
      const sortQs = `sortBy=${encodeURIComponent(sortField)}&sortDir=${encodeURIComponent(sortDir)}&page=${this.currentPage}&limit=${TRANSACTION_PAGE_SIZE}`;
      const sep = qs ? '&' : '';
      const url = `/api/transactions?${sortQs}${sep}${qs}`;
      const result = await (await fetch(url)).json();

      const tbody = document.getElementById('data-table-body');
      this.updateSortHeaderClasses('#data-table', this.currentSort);
      if (!result.data.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No transactions to display. Upload an Excel file to get started.</td></tr>';
        document.getElementById('pagination-controls').innerHTML = '';
        return;
      }

      tbody.innerHTML = result.data.map(t => `
        <tr>
          <td>${Fmt.date(t.date)}</td>
          <td>${this.escapeHtml(this.jobsiteMapping[t.baseJob] || t.baseJob || '--')}</td>
          <td>${this.escapeHtml(t.serviceOrder || '--')}</td>
          <td><span class="badge badge-${(t.type || '').toLowerCase()}">${this.escapeHtml(t.category || '--')}</span></td>
          <td>${this.escapeHtml(Fmt.truncate(t.vendorName || '', 30) || '--')}</td>
          <td class="description-cell" title="${this.escapeHtml(t.description || '')}">${this.escapeHtml(Fmt.truncate(t.description || '', 55) || '--')}</td>
          <td class="num">${t.debit ? Fmt.currencyFull(t.debit) : ''}</td>
          <td class="num">${t.credit ? Fmt.currencyFull(t.credit) : ''}</td>
          <td class="num ${t.net < 0 ? 'text-green' : ''}">${Fmt.currencyFull(t.net)}</td>
          <td class="ref-cell" title="${this.escapeHtml(t.ref || '')}">${this.escapeHtml(t.ref || '')}</td>
        </tr>
      `).join('');

      // Pagination
      this.renderPagination(result);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    }
  },

  async loadProjectedCosts() {
    const tbody = document.getElementById('projected-data-table-body');
    const summary = document.getElementById('projected-data-summary');
    if (!tbody) return;

    try {
      const result = await this.api('projections');
      const items = Array.isArray(result) ? result : [];
      const sortState = this.tableSorts.projectedData;
      const sorted = this.sortItems(items, item => this.getProjectedSortValue(item, sortState.field), sortState.dir);

      this.filteredProjections = sorted;
      this.updateSortHeaderClasses('#projected-data-table', sortState);

      if (!sorted.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No projected costs match the current dashboard filters.</td></tr>';
        if (summary) summary.textContent = '0 projected costs shown';
        return;
      }

      tbody.innerHTML = sorted.map(p => `
        <tr class="row-projected">
          <td>${Fmt.monthLabel(p.month)}</td>
          <td title="${this.escapeHtml(p.baseJob || '--')}">${this.escapeHtml(this.jobsiteMapping[p.baseJob] || p.baseJob || '--')}</td>
          <td title="${this.escapeHtml(p.vendorName || '--')}">${this.escapeHtml(Fmt.truncate(p.vendorName || '--', 30))}</td>
          <td class="description-cell" title="${this.escapeHtml(p.description || '--')}">${this.escapeHtml(Fmt.truncate(p.descriptionDisplay || p.description || '--', 55))}</td>
          <td class="ref-cell projected-ref-cell" title="${this.escapeHtml(p.invoiceNumber || '--')}">${this.escapeHtml(p.invoiceNumber || '--')}</td>
          <td class="ref-cell projected-ref-cell" title="${this.escapeHtml(p.poNumber || '--')}">${this.escapeHtml(p.poNumber || '--')}</td>
          <td><span class="badge badge-projected">${this.escapeHtml(Fmt.typeLabel(p.type))}</span></td>
          <td class="num">${Fmt.currencyFull(p.amount)}</td>
        </tr>
      `).join('');

      if (summary) {
        const totalProjectedAmount = sorted.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        summary.textContent = `${Fmt.number(sorted.length)} projected cost${sorted.length === 1 ? '' : 's'} shown | ${Fmt.currencyFull(totalProjectedAmount)} total`;
      }
    } catch (err) {
      this.filteredProjections = [];
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Unable to load projected costs.</td></tr>';
      if (summary) summary.textContent = '';
      console.error('Failed to load projected costs:', err);
    }
  },

  renderPagination(result) {
    const container = document.getElementById('pagination-controls');
    const rangeStart = result.total ? ((result.page - 1) * result.limit) + 1 : 0;
    const rangeEnd = Math.min(result.page * result.limit, result.total);

    if (result.totalPages <= 1) {
      container.innerHTML = `<span class="page-info">Showing ${Fmt.number(rangeStart)}-${Fmt.number(rangeEnd)} of ${Fmt.number(result.total)} transactions</span>`;
      return;
    }
    let html = `<span class="page-info">Showing ${Fmt.number(rangeStart)}-${Fmt.number(rangeEnd)} of ${Fmt.number(result.total)} transactions</span>`;
    html += `<button class="btn btn-sm" ${result.page <= 1 ? 'disabled' : ''} onclick="App.goToPage(${result.page - 1})">Prev</button>`;
    html += `<button class="btn btn-sm" ${result.page >= result.totalPages ? 'disabled' : ''} onclick="App.goToPage(${result.page + 1})">Next</button>`;
    container.innerHTML = html;
  },

  goToPage(page) {
    this.currentPage = page;
    this.loadTransactions();
  },

  // -- Filters --
  renderFilterControls() {
    if (!this.filterOptions) return;
    const opts = this.filterOptions;

    // Date range
    if (opts.dateRange.min) {
      document.getElementById('filter-start-date').value = opts.dateRange.min.substring(0, 7);
    }
    if (opts.dateRange.max) {
      document.getElementById('filter-end-date').value = opts.dateRange.max.substring(0, 7);
    }

    // Jobsite multi-select (simplified as checkboxes in a dropdown)
    const jobDiv = document.getElementById('filter-jobsites');
    jobDiv.innerHTML = this.createMultiSelect(opts.jobsites, 'jobsite');

    // Vendor multi-select
    const vendorDiv = document.getElementById('filter-vendors');
    vendorDiv.innerHTML = this.createMultiSelect(opts.vendors, 'vendor');

    // Type checkboxes
    const typeDiv = document.getElementById('filter-types');
    typeDiv.innerHTML = opts.types.map(t =>
      `<label class="type-checkbox"><input type="checkbox" value="${t}" checked />${Fmt.typeLabel(t)}</label>`
    ).join('');

    document.querySelectorAll('.ms-item, .ms-all').forEach(input => {
      input.addEventListener('change', () => this.updateMultiSelectControl(input.dataset.prefix));
    });
    document.querySelectorAll('.ms-search').forEach(input => {
      input.addEventListener('input', () => this.filterMultiSelectOptions(input));
    });

    this.applyFilterStateToControls();
  },

  createMultiSelect(options, prefix) {
    if (!options.length) return '<span class="empty-filter">No data</span>';
    let html = `<div class="multi-select">`;
    html += `<button class="multi-select-btn" onclick="this.parentElement.classList.toggle('open')">All (${options.length})</button>`;
    html += `<div class="multi-select-dropdown">`;
    html += `<div class="ms-search-wrap"><input type="search" class="ms-search" data-prefix="${prefix}" placeholder="Search..." autocomplete="off" /></div>`;
    html += `<label class="ms-option ms-option-select-all"><input type="checkbox" class="ms-all" data-prefix="${prefix}" checked onchange="App.toggleAllOptions(this)" /> Select All</label>`;
    for (const o of options) {
      const optionLabel = o.label || o.value || '';
      html += `<label class="ms-option" data-prefix="${prefix}" data-label="${this.escapeHtml(optionLabel.toLowerCase())}"><input type="checkbox" class="ms-item" data-prefix="${prefix}" value="${this.escapeHtml(o.value)}" checked /> ${this.escapeHtml(Fmt.truncate(optionLabel, 35))}</label>`;
    }
    html += '</div></div>';
    return html;
  },

  filterMultiSelectOptions(input) {
    const prefix = input.dataset.prefix;
    const query = (input.value || '').trim().toLowerCase();
    document.querySelectorAll(`.ms-option[data-prefix="${prefix}"]`).forEach(option => {
      const label = option.dataset.label || '';
      option.classList.toggle('hidden', Boolean(query) && !label.includes(query));
    });
  },

  toggleAllOptions(checkbox) {
    const prefix = checkbox.dataset.prefix;
    const items = document.querySelectorAll(`.ms-item[data-prefix="${prefix}"]`);
    items.forEach(cb => { cb.checked = checkbox.checked; });
    this.updateMultiSelectControl(prefix);
  },

  updateMultiSelectControl(prefix) {
    const items = [...document.querySelectorAll(`.ms-item[data-prefix="${prefix}"]`)];
    const selectAll = document.querySelector(`.ms-all[data-prefix="${prefix}"]`);
    if (!items.length || !selectAll) return;

    const selectedCount = items.filter(cb => cb.checked).length;
    selectAll.checked = selectedCount === items.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < items.length;

    const button = selectAll.closest('.multi-select')?.querySelector('.multi-select-btn');
    if (button) {
      button.textContent = selectedCount === items.length ? `All (${items.length})` : `${selectedCount} selected`;
    }
  },

  setMultiSelectSelections(prefix, values) {
    const selectedValues = values?.length ? new Set(values) : null;
    document.querySelectorAll(`.ms-item[data-prefix="${prefix}"]`).forEach(cb => {
      cb.checked = !selectedValues || selectedValues.has(cb.value);
    });
    this.updateMultiSelectControl(prefix);
  },

  updateRockExclusionButton() {
    const button = document.getElementById('btn-exclude-rock');
    const note = document.getElementById('exclude-rock-note');
    if (!button) return;
    button.classList.toggle('active', Boolean(this.filters.excludeRock));
    button.setAttribute('aria-pressed', this.filters.excludeRock ? 'true' : 'false');
    if (note) note.classList.toggle('hidden', !this.filters.excludeRock);
  },

  applyFilterStateToControls() {
    if (!this.filterOptions) return;

    const startInput = document.getElementById('filter-start-date');
    const endInput = document.getElementById('filter-end-date');
    const defaultStart = this.filterOptions.dateRange.min?.substring(0, 7) || '';
    const defaultEnd = this.filterOptions.dateRange.max?.substring(0, 7) || '';

    if (startInput) startInput.value = this.filters.startDate || defaultStart;
    if (endInput) endInput.value = this.filters.endDate || defaultEnd;

    this.setMultiSelectSelections('jobsite', this.filters.jobsites);
    this.setMultiSelectSelections('vendor', this.filters.vendors);

    const selectedTypes = this.filters.types?.length ? new Set(this.filters.types) : null;
    document.querySelectorAll('#filter-types input').forEach(cb => {
      cb.checked = !selectedTypes || selectedTypes.has(cb.value);
    });

    this.updateRockExclusionButton();
  },

  getFiltersFromControls() {
    if (!this.filterOptions) return { ...this.filters };

    const startDate = document.getElementById('filter-start-date')?.value || '';
    const endDate = document.getElementById('filter-end-date')?.value || '';
    const selectedJobsites = [...document.querySelectorAll('.ms-item[data-prefix="jobsite"]:checked')].map(cb => cb.value);
    const selectedVendors = [...document.querySelectorAll('.ms-item[data-prefix="vendor"]:checked')].map(cb => cb.value);
    const selectedTypes = [...document.querySelectorAll('#filter-types input:checked')].map(cb => cb.value);

    const allJobsites = document.querySelectorAll('.ms-item[data-prefix="jobsite"]').length;
    const allVendors = document.querySelectorAll('.ms-item[data-prefix="vendor"]').length;
    const allTypes = document.querySelectorAll('#filter-types input').length;
    const defaultStart = this.filterOptions.dateRange.min?.substring(0, 7) || '';
    const defaultEnd = this.filterOptions.dateRange.max?.substring(0, 7) || '';

    return {
      startDate: startDate && startDate !== defaultStart ? startDate : null,
      endDate: endDate && endDate !== defaultEnd ? endDate : null,
      jobsites: selectedJobsites.length && selectedJobsites.length < allJobsites ? selectedJobsites : null,
      vendors: selectedVendors.length && selectedVendors.length < allVendors ? selectedVendors : null,
      types: selectedTypes.length && selectedTypes.length < allTypes ? selectedTypes : null,
      excludeRock: document.getElementById('btn-exclude-rock')?.classList.contains('active') || false,
    };
  },

  applyQuickFilter(range) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    let startDate, endDate;

    // Highlight active quick filter button
    document.querySelectorAll('.quick-filter').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.quick-filter[data-range="${range}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (range === 'ytd') {
      startDate = `${currentYear}-01`;
      endDate = `${currentYear}-${currentMonth}`;
    } else if (range === 'lastYear') {
      startDate = `${currentYear - 1}-01`;
      endDate = `${currentYear - 1}-12`;
    } else if (range === 'last12') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 11);
      startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      endDate = `${currentYear}-${currentMonth}`;
    } else if (range === 'last6') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 5);
      startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      endDate = `${currentYear}-${currentMonth}`;
    } else if (range === 'last3') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 2);
      startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      endDate = `${currentYear}-${currentMonth}`;
    } else {
      // "all" - clear date filters
      this.filters.startDate = null;
      this.filters.endDate = null;
      if (this.filterOptions) {
        document.getElementById('filter-start-date').value = this.filterOptions.dateRange.min?.substring(0, 7) || '';
        document.getElementById('filter-end-date').value = this.filterOptions.dateRange.max?.substring(0, 7) || '';
      }
      this.currentPage = 1;
      this.syncFiltersToUrl();
      this.refresh();
      return;
    }

    document.getElementById('filter-start-date').value = startDate;
    document.getElementById('filter-end-date').value = endDate;
    this.applyFilters();
  },

  applyFilters() {
    this.filters = this.getFiltersFromControls();
    this.currentPage = 1;
    this.syncFiltersToUrl();
    this.refresh();
  },

  clearFilters() {
    this.filters = {
      startDate: null,
      endDate: null,
      jobsites: null,
      vendors: null,
      types: null,
      excludeRock: false,
    };
    this.applyFilterStateToControls();
    this.currentPage = 1;
    this.syncFiltersToUrl();
    this.refresh();
  },

  toggleRockExclusion() {
    this.filters.excludeRock = !this.filters.excludeRock;
    this.updateRockExclusionButton();
    this.applyFilters();
  },

  // -- Upload --
  initUpload() {
    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('upload-file-input');
    const submitBtn = document.getElementById('btn-upload-submit');

    // Drag and drop
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
        this.uploadState.selectedFile = file;
        document.getElementById('upload-file-name').textContent = file.name;
        submitBtn.disabled = false;
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) {
        this.uploadState.selectedFile = fileInput.files[0];
        document.getElementById('upload-file-name').textContent = this.uploadState.selectedFile.name;
        submitBtn.disabled = false;
      }
    });

    submitBtn.addEventListener('click', async () => {
      if (!this.uploadState.selectedFile) return;
      const mode = document.querySelector('input[name="upload-mode"]:checked').value;
      const progress = document.getElementById('upload-progress');
      const result = document.getElementById('upload-result');

      progress.classList.remove('hidden');
      result.classList.add('hidden');
      submitBtn.disabled = true;

      try {
        const formData = new FormData();
        formData.append('file', this.uploadState.selectedFile);
        formData.append('mode', mode);

        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.success) {
          const staleProjectionText = data.staleProjectionsRemoved
            ? `<br>Stale projections cleared: ${data.staleProjectionsRemoved}`
            : '';
          result.className = 'upload-result success';
          result.innerHTML = `
            <strong>Upload Successful</strong><br>
            File: ${data.fileName}<br>
            Rows parsed: ${data.rowsParsed}<br>
            Rows added: ${data.rowsAdded}<br>
            Duplicates skipped: ${data.rowsSkipped}<br>
            Total rows in database: ${data.totalRows}
            ${staleProjectionText}
          `;
          // Refresh dashboard
          await this.loadFilterOptions();
          await this.loadJobsiteMapping();
          await this.refresh();
          await this.loadMetadata();
          this.loadUploadHistory();
        } else {
          result.className = 'upload-result error';
          result.innerHTML = `<strong>Error:</strong> ${data.error}`;
        }
      } catch (err) {
        result.className = 'upload-result error';
        result.innerHTML = `<strong>Error:</strong> ${err.message}`;
      }

      progress.classList.add('hidden');
      result.classList.remove('hidden');
      submitBtn.disabled = !this.uploadState.selectedFile;
    });
  },

  resetUploadModalState() {
    this.uploadState.selectedFile = null;
    const fileInput = document.getElementById('upload-file-input');
    const submitBtn = document.getElementById('btn-upload-submit');
    const progress = document.getElementById('upload-progress');
    const result = document.getElementById('upload-result');
    const fileName = document.getElementById('upload-file-name');
    const appendMode = document.querySelector('input[name="upload-mode"][value="append"]');

    if (fileInput) fileInput.value = '';
    if (submitBtn) submitBtn.disabled = true;
    if (progress) progress.classList.add('hidden');
    if (result) {
      result.className = 'upload-result hidden';
      result.innerHTML = '';
    }
    if (fileName) fileName.textContent = '';
    if (appendMode) appendMode.checked = true;
  },

  async loadUploadHistory() {
    try {
      const meta = await (await fetch('/api/metadata')).json();
      const container = document.getElementById('upload-history');
      if (!meta.uploadHistory?.length) {
        container.innerHTML = '<p class="empty-state">No uploads yet</p>';
        return;
      }
      container.innerHTML = meta.uploadHistory.slice().reverse().map(h => `
        <div class="history-item">
          <strong>${h.fileName}</strong> - ${new Date(h.uploadedAt).toLocaleString()}<br>
          Mode: ${h.mode} | Parsed: ${h.rowsParsed} | Added: ${h.rowsAdded} | Skipped: ${h.rowsSkipped}
        </div>
      `).join('');
    } catch (err) { /* ignore */ }
  },

  // -- Settings --
  renderSettingsMapping(filter = '') {
    const tbody = document.getElementById('settings-mapping-body');
    const entries = Object.entries(this.jobsiteMapping);
    const lowerFilter = filter.toLowerCase();
    const filtered = lowerFilter
      ? entries.filter(([job, name]) => job.includes(lowerFilter) || name.toLowerCase().includes(lowerFilter))
      : entries;
    const sortState = this.tableSorts.jobsiteMapping;
    const sortedEntries = this.sortItems(filtered, entry => this.getMappingSortValue(entry, sortState.field), sortState.dir);

    tbody.innerHTML = sortedEntries.map(([job, name]) => {
      const status = this.getMappingStatus(name);
      return `
      <tr class="${status.cls}">
        <td class="job-number">${job}</td>
        <td><input type="text" class="mapping-input" value="${this.escapeHtml(name)}" data-job="${job}" /></td>
        <td class="mapping-status">${status.label}</td>
      </tr>`;
    }).join('');
    this.updateSortHeaderClasses('#tab-mapping .settings-table', sortState);

    // Debounced save on input change
    let saveTimeout;
    tbody.querySelectorAll('.mapping-input').forEach(input => {
      input.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        // Update status indicator live
        const tr = input.closest('tr');
        const statusTd = tr.querySelector('.mapping-status');
        const st = this.getMappingStatus(input.value);
        statusTd.innerHTML = st.label;
        tr.className = st.cls;
        saveTimeout = setTimeout(() => this.saveMapping(), 800);
      });
    });

    // Search binding (only once)
    const searchInput = document.getElementById('settings-search');
    if (!searchInput.dataset.bound) {
      searchInput.dataset.bound = '1';
      let searchTimeout;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => this.renderSettingsMapping(searchInput.value), 200);
      });
    }

    // Add new mapping button (only once)
    const addBtn = document.getElementById('btn-add-mapping');
    if (!addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', () => this.addNewMapping());
    }
  },

  getMappingStatus(name) {
    if (!name || name.startsWith('Unknown')) {
      return { label: '<span class="status-badge status-unknown">Unknown</span>', cls: 'row-unknown' };
    }
    if (name.includes('Multiple') || name.includes('Review') || name.includes('Ambiguous')) {
      return { label: '<span class="status-badge status-review">Review</span>', cls: 'row-review' };
    }
    return { label: '<span class="status-badge status-matched">Matched</span>', cls: '' };
  },

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  addNewMapping() {
    const jobNum = prompt('Enter 6-digit base job number:');
    if (!jobNum || !/^\d{6}$/.test(jobNum.trim())) {
      if (jobNum !== null) alert('Please enter a valid 6-digit job number.');
      return;
    }
    const key = jobNum.trim();
    if (this.jobsiteMapping[key]) {
      alert(`Job ${key} already exists with site name: ${this.jobsiteMapping[key]}`);
      return;
    }
    const siteName = prompt(`Enter site name for job ${key}:`) || `Unknown - ${key}`;
    this.jobsiteMapping[key] = siteName;
    this.saveMapping();
    this.renderSettingsMapping(document.getElementById('settings-search').value);
  },

  async saveMapping() {
    const inputs = document.querySelectorAll('#settings-mapping-body .mapping-input');
    const updates = {};
    inputs.forEach(input => {
      if (input.dataset.job) {
        updates[input.dataset.job] = input.value;
      }
    });
    // Also include entries not currently visible (due to search filter)
    for (const [k, v] of Object.entries(this.jobsiteMapping)) {
      if (!(k in updates)) updates[k] = v;
    }

    const statusEl = document.getElementById('settings-save-status');
    statusEl.textContent = 'Saving...';
    statusEl.className = 'save-status saving';

    try {
      const res = await fetch('/api/jobsite-mapping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        this.jobsiteMapping = data.mapping;
        statusEl.textContent = 'Saved';
        statusEl.className = 'save-status saved';
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
      }
    } catch (err) {
      console.error('Failed to save mapping:', err);
      statusEl.textContent = 'Error saving';
      statusEl.className = 'save-status error';
    }
  },

  setProjectionStatus(message, tone = '', clearAfterMs = 0) {
    const statusEl = document.getElementById('projection-save-status');
    if (!statusEl) return;

    statusEl.textContent = message || '';
    statusEl.className = tone ? `save-status ${tone}` : 'save-status';

    window.clearTimeout(statusEl._clearTimeout);
    if (clearAfterMs) {
      statusEl._clearTimeout = window.setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'save-status';
      }, clearAfterMs);
    }
  },

  updateProjectionWindowNote() {
    const note = document.getElementById('projection-window-note');
    const monthInput = document.getElementById('proj-month');
    const projectionStartMonth = this.metadata?.projectionStartMonth || this.filterOptions?.projectionStartMonth || '';
    const latestActualMonth = this.metadata?.latestActualMonth || this.filterOptions?.latestActualMonth || '';

    if (monthInput) {
      monthInput.min = projectionStartMonth || '';
      if (!monthInput.value && projectionStartMonth) {
        monthInput.value = projectionStartMonth;
      }
    }

    if (!note) return;

    if (projectionStartMonth && latestActualMonth) {
      note.textContent = `Latest actual month: ${Fmt.monthLabel(latestActualMonth)}. Projections can be added for ${Fmt.monthLabel(projectionStartMonth)} or later.`;
      return;
    }

    if (projectionStartMonth) {
      note.textContent = `Projections can be added for ${Fmt.monthLabel(projectionStartMonth)} or later.`;
      return;
    }

    note.textContent = 'No uploaded actuals yet. Projections can start with any month.';
  },

  // -- Projections --
  getProjectionFormContext() {
    const vendorSelect = document.getElementById('proj-vendor');
    const selectedVendor = vendorSelect?.value && vendorSelect.value !== '__custom__'
      ? this.normalizeProjectionVendorName(vendorSelect.value)
      : '';

    return {
      month: document.getElementById('proj-month')?.value || '',
      baseJob: document.getElementById('proj-jobsite')?.value || '',
      vendorName: selectedVendor,
    };
  },

  normalizeProjectionVendorName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  },

  getProjectionVendorChoices(currentVendor = '') {
    const choices = new Map();
    const addVendor = (vendorName) => {
      const normalized = this.normalizeProjectionVendorName(vendorName);
      if (!normalized || normalized === 'Internal / Non-Vendor') return;
      const key = normalized.toLowerCase();
      if (!choices.has(key)) choices.set(key, normalized);
    };

    (this.filterOptions?.vendors || []).forEach(v => addVendor(v.value || v.label));
    (Array.isArray(this.projections) ? this.projections : []).forEach(p => addVendor(p.vendorName));
    addVendor(currentVendor);

    return [...choices.values()].sort((a, b) => a.localeCompare(b));
  },

  syncProjectionFormState() {
    const submitBtn = document.getElementById('btn-add-projection');
    const cancelBtn = document.getElementById('btn-cancel-projection-edit');

    if (submitBtn) {
      submitBtn.textContent = this.editingProjectionId ? 'Save Changes' : 'Add';
    }
    if (cancelBtn) {
      cancelBtn.classList.toggle('hidden', !this.editingProjectionId);
    }
  },

  resetProjectionForm({ preserveContext = true } = {}) {
    const context = preserveContext ? this.getProjectionFormContext() : { month: '', baseJob: '', vendorName: '' };

    this.editingProjectionId = null;

    const monthInput = document.getElementById('proj-month');
    const jobsiteSelect = document.getElementById('proj-jobsite');
    const vendorSelect = document.getElementById('proj-vendor');
    const descriptionInput = document.getElementById('proj-description');
    const invoiceInput = document.getElementById('proj-invoice');
    const poInput = document.getElementById('proj-po');
    const amountInput = document.getElementById('proj-amount');
    const typeSelect = document.getElementById('proj-type');

    if (monthInput) monthInput.value = context.month || '';
    if (descriptionInput) descriptionInput.value = '';
    if (invoiceInput) invoiceInput.value = '';
    if (poInput) poInput.value = '';
    if (amountInput) amountInput.value = '';
    if (typeSelect) typeSelect.value = 'PUR-SUB';

    this.populateProjectionDropdowns();

    if (jobsiteSelect) jobsiteSelect.value = context.baseJob || '';
    if (vendorSelect) vendorSelect.value = context.vendorName || '';

    this.syncProjectionFormState();
  },

  beginProjectionEdit(projectionId) {
    const projection = (Array.isArray(this.projections) ? this.projections : []).find(p => p.id === projectionId);
    if (!projection) return;

    this.editingProjectionId = projectionId;

    document.getElementById('proj-month').value = projection.month || '';
    document.getElementById('proj-description').value = projection.description || '';
    document.getElementById('proj-invoice').value = projection.invoiceNumber || '';
    document.getElementById('proj-po').value = projection.poNumber || '';
    document.getElementById('proj-amount').value = projection.amount || '';
    document.getElementById('proj-type').value = projection.type || 'PUR-SUB';

    this.populateProjectionDropdowns();
    document.getElementById('proj-jobsite').value = projection.baseJob || '';
    document.getElementById('proj-vendor').value = this.normalizeProjectionVendorName(projection.vendorName) || '';

    this.syncProjectionFormState();
    this.renderProjectionsTableState();
    this.setProjectionStatus(`Editing ${Fmt.monthLabel(projection.month)} projected cost.`, 'saving');
    document.getElementById('proj-description')?.focus();
  },

  cancelProjectionEdit() {
    this.resetProjectionForm();
    this.renderProjectionsTableState();
    this.setProjectionStatus('Edit canceled.', '', 1500);
  },

  renderProjectionsTableState() {
    document.querySelectorAll('#projections-body tr[data-projection-id]').forEach(row => {
      row.classList.toggle('row-editing', Boolean(this.editingProjectionId && row.dataset.projectionId === this.editingProjectionId));
    });
  },

  getProjectionFormPayload() {
    const month = document.getElementById('proj-month').value;
    const baseJob = document.getElementById('proj-jobsite').value;
    const vendorValue = document.getElementById('proj-vendor').value;
    const vendorName = vendorValue === '__custom__' ? '' : this.normalizeProjectionVendorName(vendorValue);
    const description = document.getElementById('proj-description').value.trim();
    const invoiceNumber = document.getElementById('proj-invoice').value.trim();
    const poNumber = document.getElementById('proj-po').value.trim();
    const amount = parseFloat(document.getElementById('proj-amount').value);
    const type = document.getElementById('proj-type').value;

    if (!month) {
      alert('Please select a month.');
      return null;
    }
    if (!(amount > 0)) {
      alert('Please enter a valid amount.');
      return null;
    }

    return { month, baseJob, vendorName, description, invoiceNumber, poNumber, amount, type };
  },

  async refreshAfterProjectionChange() {
    await this.loadFilterOptions();
    await this.loadMetadata();
    await this.refresh();
    await this.renderProjections();
  },

  async renderProjections() {
    try {
      this.projections = await (await fetch('/api/projections')).json();
    } catch (err) {
      this.projections = [];
    }

    // Populate jobsite and vendor dropdowns in the form
    this.populateProjectionDropdowns();
    this.updateProjectionWindowNote();

    const tbody = document.getElementById('projections-body');
    const emptyMsg = document.getElementById('projections-empty');
    const totalDiv = document.getElementById('projections-total');
    const items = Array.isArray(this.projections) ? this.projections : [];
    const sortState = this.tableSorts.projectionSettings;
    this.updateSortHeaderClasses('#tab-projections .data-table.compact', sortState);

    if (this.editingProjectionId && !items.some(item => item.id === this.editingProjectionId)) {
      this.editingProjectionId = null;
    }

    if (!items.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = 'block';
      totalDiv.innerHTML = '';
    } else {
      emptyMsg.style.display = 'none';
      const sorted = this.sortItems(items, item => this.getProjectedSortValue(item, sortState.field), sortState.dir);
      tbody.innerHTML = sorted.map(p => `
        <tr class="row-projected${this.editingProjectionId === p.id ? ' row-editing' : ''}" data-projection-id="${p.id}">
          <td>${Fmt.monthLabel(p.month)}</td>
          <td>${this.escapeHtml(this.jobsiteMapping[p.baseJob] || p.baseJob || '--')}</td>
          <td title="${this.escapeHtml(p.vendorName || '--')}">${this.escapeHtml(Fmt.truncate(p.vendorName || '--', 25))}</td>
          <td class="projection-description-cell" title="${this.escapeHtml(p.description || '--')}">${this.escapeHtml(p.descriptionDisplay || p.description || '--')}</td>
          <td class="projection-ref-cell">${this.escapeHtml(p.invoiceNumber || '--')}</td>
          <td class="projection-ref-cell">${this.escapeHtml(p.poNumber || '--')}</td>
          <td><span class="badge badge-projected">${this.escapeHtml(Fmt.typeLabel(p.type || 'PUR-SUB'))}</span></td>
          <td class="num">${Fmt.currency(p.amount)}</td>
          <td class="projection-actions-cell">
            <button class="btn btn-sm btn-secondary projection-edit" data-id="${p.id}">Edit</button>
            <button class="btn btn-sm btn-ghost projection-remove" data-id="${p.id}">Delete</button>
          </td>
        </tr>
      `).join('');

      // Total row
      const total = items.reduce((s, p) => s + (p.amount || 0), 0);
      const byMonth = {};
      items.forEach(p => { byMonth[p.month] = (byMonth[p.month] || 0) + p.amount; });
      const monthCount = Object.keys(byMonth).length;
      totalDiv.innerHTML = `<strong>Total Projected:</strong> ${Fmt.currency(total)} across ${items.length} line items, ${monthCount} months`;
    }

    tbody.querySelectorAll('.projection-edit').forEach(btn => {
      btn.addEventListener('click', () => this.beginProjectionEdit(btn.dataset.id));
    });

    // Bind remove buttons
    tbody.querySelectorAll('.projection-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const res = await fetch(`/api/projections/${btn.dataset.id}`, { method: 'DELETE' });
          if (!res.ok) {
            throw new Error('Delete request failed.');
          }
          if (this.editingProjectionId === btn.dataset.id) {
            this.resetProjectionForm();
          }
          this.setProjectionStatus('Deleted', 'saved', 1500);
          await this.refreshAfterProjectionChange();
        } catch (err) {
          console.error('Failed to delete projection:', err);
          this.setProjectionStatus('Delete failed.', 'error');
        }
      });
    });

    // Bind add button (once)
    const addBtn = document.getElementById('btn-add-projection');
    if (!addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', () => this.submitProjectionForm());
    }

    this.syncProjectionFormState();
    this.renderProjectionsTableState();
  },

  async clearAllProjections() {
    if (!window.confirm('Clear all saved projected costs?')) return;

    this.setProjectionStatus('Clearing projections...', 'saving');

    try {
      const res = await fetch('/api/projections', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Unable to clear projected costs.');
      }

      this.resetProjectionForm({ preserveContext: false });
      this.setProjectionStatus(`Cleared ${data.removed} projected cost${data.removed === 1 ? '' : 's'}.`, 'saved', 3500);
      await this.refreshAfterProjectionChange();
    } catch (err) {
      console.error('Failed to clear projections:', err);
      this.setProjectionStatus(err.message || 'Unable to clear projected costs.', 'error');
    }
  },

  populateProjectionDropdowns() {
    const jobSelect = document.getElementById('proj-jobsite');
    const vendorSelect = document.getElementById('proj-vendor');

    // Jobsites
    if (jobSelect) {
      const currentJob = jobSelect.value;
      jobSelect.innerHTML = '<option value="">-- Select Jobsite --</option>';
      const entries = Object.entries(this.jobsiteMapping).sort((a, b) => a[1].localeCompare(b[1]));
      for (const [job, name] of entries) {
        jobSelect.innerHTML += `<option value="${job}">${name} (${job})</option>`;
      }
      if ([...jobSelect.options].some(opt => opt.value === currentJob)) {
        jobSelect.value = currentJob;
      }
    }

    // Vendors from actuals plus saved projections
    if (vendorSelect) {
      const currentVendor = vendorSelect.value;
      const vendors = this.getProjectionVendorChoices(currentVendor);
      vendorSelect.innerHTML = '<option value="">-- Select Vendor --</option>';
      for (const vendorName of vendors) {
        vendorSelect.innerHTML += `<option value="${this.escapeHtml(vendorName)}">${this.escapeHtml(vendorName)}</option>`;
      }
      vendorSelect.innerHTML += '<option value="__custom__">Other (type name)...</option>';
      if ([...vendorSelect.options].some(opt => opt.value === currentVendor)) {
        vendorSelect.value = currentVendor;
      }

      if (!vendorSelect.dataset.bound) {
        vendorSelect.dataset.bound = '1';
        vendorSelect.addEventListener('change', () => {
          if (vendorSelect.value === '__custom__') {
            const customVendor = this.normalizeProjectionVendorName(prompt('Enter vendor name:'));
            if (customVendor) {
              const existing = [...vendorSelect.options].find(opt => opt.value.toLowerCase() === customVendor.toLowerCase());
              vendorSelect.value = existing?.value || customVendor;
              this.populateProjectionDropdowns();
              vendorSelect.value = existing?.value || customVendor;
            } else {
              vendorSelect.value = '';
            }
          }
        });
      }
    }
  },

  async importProjectionsFile() {
    const fileInput = document.getElementById('proj-import-file');
    const button = document.getElementById('btn-import-projections');
    const file = fileInput.files?.[0];
    if (!file) return;

    const mode = document.getElementById('proj-import-mode').value;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);

    button.disabled = true;
    this.setProjectionStatus('Importing projections...', 'saving');

    try {
      const res = await fetch('/api/projections/import', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Unable to import projected costs.');
      }

      const rowsAddedText = data.rowsAdded === 0
        ? 'No projected costs were imported.'
        : `Imported ${data.rowsAdded} projected cost${data.rowsAdded === 1 ? '' : 's'}.`;
      const skippedParts = [];
      if (data.rowsSkippedDuplicates) {
        skippedParts.push(`${data.rowsSkippedDuplicates} duplicate row${data.rowsSkippedDuplicates === 1 ? '' : 's'}`);
      }
      if (data.rowsSkippedPastMonths) {
        const monthLabel = data.projectionStartMonth ? Fmt.monthLabel(data.projectionStartMonth) : '';
        skippedParts.push(
          monthLabel
            ? `${data.rowsSkippedPastMonths} row${data.rowsSkippedPastMonths === 1 ? '' : 's'} before ${monthLabel}`
            : `${data.rowsSkippedPastMonths} past-month row${data.rowsSkippedPastMonths === 1 ? '' : 's'}`,
        );
      }
      const skippedText = skippedParts.length ? ` Skipped ${skippedParts.join(' and ')}.` : '';
      const guidanceText = data.rowsSkippedPastMonths && data.projectionStartMonth
        ? ` Only ${Fmt.monthLabel(data.projectionStartMonth)} or later can be imported right now.`
        : '';
      this.setProjectionStatus(`${rowsAddedText}${skippedText}${guidanceText}`, 'saved', 7000);
      await this.refreshAfterProjectionChange();
    } catch (err) {
      console.error('Failed to import projections:', err);
      this.setProjectionStatus(err.message || 'Projection import failed.', 'error');
    } finally {
      button.disabled = false;
      fileInput.value = '';
    }
  },

  async submitProjectionForm() {
    const payload = this.getProjectionFormPayload();
    if (!payload) return;

    const projectionStartMonth = this.metadata?.projectionStartMonth || this.filterOptions?.projectionStartMonth || '';
    if (projectionStartMonth && payload.month < projectionStartMonth) {
      alert(`Projected month must be ${Fmt.monthLabel(projectionStartMonth)} or later.`);
      return;
    }

    if (this.editingProjectionId) {
      await this.updateProjection(this.editingProjectionId, payload);
      return;
    }

    await this.addProjection(payload);
  },

  async addProjection(payload) {
    this.setProjectionStatus('Adding...', 'saving');

    try {
      const res = await fetch('/api/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Unable to add projected cost.');
      }

      this.setProjectionStatus('Added', 'saved', 2000);
      this.resetProjectionForm({ preserveContext: true });
      await this.refreshAfterProjectionChange();
    } catch (err) {
      console.error('Failed to add projection:', err);
      this.setProjectionStatus(err.message || 'Unable to add projected cost.', 'error');
    }
  },

  async updateProjection(projectionId, payload) {
    this.setProjectionStatus('Saving changes...', 'saving');

    try {
      const res = await fetch(`/api/projections/${projectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Unable to update projected cost.');
      }

      this.setProjectionStatus('Updated', 'saved', 2000);
      this.resetProjectionForm({ preserveContext: true });
      await this.refreshAfterProjectionChange();
    } catch (err) {
      console.error('Failed to update projection:', err);
      this.setProjectionStatus(err.message || 'Unable to update projected cost.', 'error');
    }
  },

  exportCSV() {
    const qs = this.buildQueryString();
    window.location.href = `/api/export${qs ? '?' + qs : ''}`;
  },

  exportProjectionsCSV(useCurrentFilters = false) {
    const qs = useCurrentFilters ? this.buildQueryString() : '';
    window.location.href = `/api/projections/export${qs ? '?' + qs : ''}`;
  },

  async copyShareLink() {
    const button = document.getElementById('btn-share-view');
    const originalLabel = button?.textContent || 'Share View';
    let copied = false;

    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing...';
    }

    try {
      this.filters = this.getFiltersFromControls();
      this.currentPage = 1;
      this.syncFiltersToUrl();

      const shareUrl = window.location.href;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const tempInput = document.createElement('textarea');
        tempInput.value = shareUrl;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      }
      copied = true;
      if (button) button.disabled = false;
      this.flashButtonLabel('btn-share-view', 'Copied', originalLabel);
      this.refresh();
    } catch (err) {
      console.error('Unable to copy share link:', err);
      alert(`Copy failed. Share this link manually:\n\n${window.location.href}`);
    } finally {
      if (button) {
        button.disabled = false;
        if (!copied) button.textContent = originalLabel;
      }
    }
  },

  flashButtonLabel(id, label, restoreLabel = null) {
    const button = document.getElementById(id);
    if (!button) return;
    const originalLabel = restoreLabel || button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = originalLabel;
    button.textContent = label;
    window.clearTimeout(button._labelTimeout);
    button._labelTimeout = window.setTimeout(() => {
      button.textContent = button.dataset.originalLabel || originalLabel;
    }, 1800);
  },

  formatDateFilterSummary() {
    const start = document.getElementById('filter-start-date')?.value || this.filterOptions?.dateRange.min?.substring(0, 7) || '';
    const end = document.getElementById('filter-end-date')?.value || this.filterOptions?.dateRange.max?.substring(0, 7) || '';
    if (!start && !end) return 'All dates';
    if (start && end && start === end) return Fmt.monthLabel(start);
    return `${start ? Fmt.monthLabel(start) : 'Start'} to ${end ? Fmt.monthLabel(end) : 'Current'}`;
  },

  formatSelectionSummary(selectedValues, options) {
    if (!options?.length || !selectedValues?.length) {
      return options?.length ? `All (${options.length})` : 'All';
    }

    const labels = options
      .filter(option => selectedValues.includes(option.value))
      .map(option => option.label);

    if (!labels.length) return 'No matches';
    if (labels.length <= 3) return labels.join(', ');
    return `${labels.length} selected`;
  },

  getFilterSummaryItems() {
    const typeOptions = (this.filterOptions?.types || []).map(type => ({ value: type, label: Fmt.typeLabel(type) }));
    return [
      { label: 'Date Range', value: this.formatDateFilterSummary() },
      { label: 'Jobsites', value: this.formatSelectionSummary(this.filters.jobsites, this.filterOptions?.jobsites || []) },
      { label: 'Vendors', value: this.formatSelectionSummary(this.filters.vendors, this.filterOptions?.vendors || []) },
      { label: 'Cost Types', value: this.formatSelectionSummary(this.filters.types, typeOptions) },
      { label: 'Special', value: this.filters.excludeRock ? `Excluding ${ROCK_ENTERPRISES_VENDOR}` : 'None' },
    ];
  },

  getReportKpis() {
    return [
      { label: 'Total Gross Spend', value: document.getElementById('kpi-gross-spend').textContent },
      { label: 'Credits', value: document.getElementById('kpi-customer-credits').textContent },
      { label: 'Accounting Adjustments', value: document.getElementById('kpi-accounting-adj').textContent },
      { label: 'Net Cost to PSI', value: document.getElementById('kpi-net-cost').textContent },
    ];
  },

  canvasToImageDataUrl(canvasId) {
    const canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!canvas || !canvas.width || !canvas.height) return '';

    const imageCanvas = document.createElement('canvas');
    imageCanvas.width = canvas.width;
    imageCanvas.height = canvas.height;
    const ctx = imageCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
    ctx.drawImage(canvas, 0, 0);
    return imageCanvas.toDataURL('image/png');
  },

  async fetchAllFilteredTransactions() {
    const qs = this.buildQueryString();
    const sortQs = 'sortBy=date&sortDir=desc&page=1&limit=1000000';
    const sep = qs ? '&' : '';
    const url = `/api/transactions?${sortQs}${sep}${qs}`;
    const result = await (await fetch(url)).json();
    return result.data || [];
  },

  async fetchFilteredProjections() {
    const result = await this.api('projections');
    return Array.isArray(result) ? result : [];
  },

  buildTransactionsReportTable(transactions) {
    if (!transactions.length) {
      return '<div class="report-empty">No transactions match the current filters.</div>';
    }

    const rows = transactions.map(t => `
      <tr>
        <td>${Fmt.date(t.date)}</td>
        <td>${this.escapeHtml(this.jobsiteMapping[t.baseJob] || t.baseJob || '--')}</td>
        <td>${this.escapeHtml(t.serviceOrder || '--')}</td>
        <td>${this.escapeHtml(t.category || '--')}</td>
        <td>${this.escapeHtml(t.vendorName || '--')}</td>
        <td>${this.escapeHtml(t.description || '--')}</td>
        <td class="num">${t.debit ? Fmt.currencyFull(t.debit) : ''}</td>
        <td class="num">${t.credit ? Fmt.currencyFull(t.credit) : ''}</td>
        <td class="num">${Fmt.currencyFull(t.net)}</td>
        <td>${this.escapeHtml(t.ref || '')}</td>
      </tr>
    `).join('');

    return `
      <table class="report-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Jobsite</th>
            <th>Service Order</th>
            <th>Category</th>
            <th>Vendor</th>
            <th>Description</th>
            <th class="num">Debit</th>
            <th class="num">Credit</th>
            <th class="num">Net</th>
            <th>Ref</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  },

  buildProjectionsReportTable(projections) {
    if (!projections.length) {
      return '<div class="report-empty">No projected costs match the current filters.</div>';
    }

    const rows = projections.map(p => `
      <tr>
        <td>${Fmt.monthLabel(p.month)}</td>
        <td>${this.escapeHtml(this.jobsiteMapping[p.baseJob] || p.baseJob || '--')}</td>
        <td>${this.escapeHtml(p.vendorName || '--')}</td>
        <td>${this.escapeHtml(p.descriptionDisplay || p.description || '--')}</td>
        <td>${this.escapeHtml(p.invoiceNumber || '--')}</td>
        <td>${this.escapeHtml(p.poNumber || '--')}</td>
        <td>${this.escapeHtml(Fmt.typeLabel(p.type))}</td>
        <td class="num">${Fmt.currencyFull(p.amount)}</td>
      </tr>
    `).join('');

    return `
      <table class="report-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Jobsite</th>
            <th>Vendor</th>
            <th>Description</th>
            <th>Invoice</th>
            <th>PO</th>
            <th>Type</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  },

  buildReportMarkup({ includeTransactions = false, transactions = [], projections = this.filteredProjections || [] } = {}) {
    const generatedAt = new Date().toLocaleString();
    const filterSummary = this.getFilterSummaryItems().map(item => `
      <div class="report-meta-item">
        <span>${item.label}</span>
        <strong>${this.escapeHtml(item.value)}</strong>
      </div>
    `).join('');

    const kpis = this.getReportKpis().map(item => `
      <div class="report-kpi">
        <div class="report-kpi-label">${item.label}</div>
        <div class="report-kpi-value">${this.escapeHtml(item.value)}</div>
      </div>
    `).join('');

    const spendChart = this.canvasToImageDataUrl('chart-spend-over-time');
    const jobsiteChart = this.canvasToImageDataUrl('chart-jobsite-breakdown');
    const vendorTableHtml = document.getElementById('vendor-table-container').innerHTML || '<div class="report-empty">No vendor data available.</div>';
    const totalProjectedAmount = projections.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    return `
      <div class="report-root">
        <div class="report-sheet">
          <div class="report-header">
            <div class="report-title">
              <h1>PSI Sub-Contract Dashboard Report</h1>
              <p>Snapshot of the currently selected dashboard view.</p>
            </div>
            <div class="report-generated">Generated ${this.escapeHtml(generatedAt)}</div>
          </div>

          <div class="report-meta-grid">${filterSummary}</div>
          <div class="report-kpis">${kpis}</div>

          <div class="report-grid">
            <section class="report-card-wide">
              <h2>Monthly Net vs Net Cost To Date</h2>
              ${spendChart ? `<img src="${spendChart}" alt="Monthly Net vs Net Cost To Date chart" />` : '<div class="report-empty">No chart data available.</div>'}
            </section>

            <section class="report-card-wide">
              <h2>Jobsite Breakdown</h2>
              ${jobsiteChart ? `<img src="${jobsiteChart}" alt="Jobsite Breakdown chart" />` : '<div class="report-empty">No chart data available.</div>'}
            </section>

            <section class="report-card-wide">
              <h2>Vendor Details</h2>
              <div class="table-scroll">${vendorTableHtml}</div>
            </section>

            <section class="report-card-wide">
              <h2>Projected Costs (${Fmt.number(projections.length)} | ${Fmt.currencyFull(totalProjectedAmount)})</h2>
              ${this.buildProjectionsReportTable(projections)}
            </section>

            ${includeTransactions ? `
              <section class="report-card-wide">
                <h2>Filtered Transactions (${Fmt.number(transactions.length)})</h2>
                ${this.buildTransactionsReportTable(transactions)}
              </section>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  ensureReportRoot() {
    if (!this.reportRoot) {
      this.reportRoot = document.getElementById('report-capture-root');
    }
    return this.reportRoot;
  },

  async waitForImages(container) {
    const images = [...container.querySelectorAll('img')];
    await Promise.all(images.map(img => (
      img.complete
        ? Promise.resolve()
        : new Promise(resolve => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        })
    )));
  },

  downloadDataUrl(dataUrl, fileName) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  async printReport() {
    const button = document.getElementById('btn-print-report');
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing...';

    try {
      const [transactions, projections] = await Promise.all([
        this.fetchAllFilteredTransactions(),
        this.fetchFilteredProjections(),
      ]);
      const reportWindow = window.open('', '_blank');
      if (!reportWindow) throw new Error('The browser blocked the report window.');

      reportWindow.document.write(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>PSI Dashboard Report</title>
          <link rel="stylesheet" href="/styles/main.css">
          <style>
            @page { margin: 0.5in; }
            body { margin: 0; background: #ffffff; }
            .report-root { background: #ffffff; padding: 0; }
            .report-sheet { border: none; box-shadow: none; border-radius: 0; padding: 0; }
            .report-card, .report-card-wide, .report-meta-item, .report-kpi { break-inside: avoid; page-break-inside: avoid; }
          </style>
        </head>
        <body>
          ${this.buildReportMarkup({ includeTransactions: true, transactions, projections })}
          <script>
            window.addEventListener('load', function () {
              window.setTimeout(function () {
                window.print();
              }, 300);
            });
            window.addEventListener('afterprint', function () {
              window.close();
            });
          <\/script>
        </body>
        </html>
      `);
      reportWindow.document.close();
    } catch (err) {
      console.error('Failed to print report:', err);
      alert(`Unable to generate the print report: ${err.message}`);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  },

  async exportJPEG() {
    const button = document.getElementById('btn-export-jpeg');
    const originalLabel = button.textContent;
    const reportRoot = this.ensureReportRoot();

    button.disabled = true;
    button.textContent = 'Rendering...';

    try {
      if (typeof html2canvas !== 'function') {
        throw new Error('JPEG export library did not load.');
      }

      reportRoot.innerHTML = this.buildReportMarkup();
      reportRoot.classList.remove('hidden');
      await this.waitForImages(reportRoot);

      const canvas = await html2canvas(reportRoot.firstElementChild, {
        backgroundColor: '#f8fafc',
        scale: 2,
        useCORS: true,
      });

      const fileName = `psi-dashboard-report-${new Date().toISOString().slice(0, 10)}.jpg`;
      this.downloadDataUrl(canvas.toDataURL('image/jpeg', 0.92), fileName);
    } catch (err) {
      console.error('Failed to export JPEG:', err);
      alert(`Unable to export JPEG: ${err.message}`);
    } finally {
      reportRoot.classList.add('hidden');
      reportRoot.innerHTML = '';
      button.disabled = false;
      button.textContent = originalLabel;
    }
  },

  showModal(id) {
    document.getElementById(id).classList.remove('hidden');
    if (id === 'upload-modal') this.loadUploadHistory();
  },

  hideModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('hidden');
    if (id === 'upload-modal') this.resetUploadModalState();
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());
