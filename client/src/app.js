// PSI Sub-Contract Dashboard - Main App
const ROCK_ENTERPRISES_VENDOR = 'Rock Enterprises';

const App = {
  charts: {},
  filters: {},
  filterOptions: null,
  currentSort: { field: 'date', dir: 'desc' },
  currentPage: 1,
  jobsiteMapping: {},
  projections: {},
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

    // Data table sorting
    document.querySelectorAll('#data-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (this.currentSort.field === field) {
          this.currentSort.dir = this.currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this.currentSort = { field, dir: 'asc' };
        }
        this.currentPage = 1;
        this.loadTransactions();
      });
    });

    // Export
    document.getElementById('btn-export-csv').addEventListener('click', () => this.exportCSV());
    document.getElementById('btn-print-report').addEventListener('click', () => this.printReport());
    document.getElementById('btn-export-jpeg').addEventListener('click', () => this.exportJPEG());
    document.getElementById('btn-import-projections').addEventListener('click', () => {
      document.getElementById('proj-import-file').click();
    });
    document.getElementById('proj-import-file').addEventListener('change', () => this.importProjectionsFile());
    document.getElementById('btn-export-projections-csv').addEventListener('click', () => this.exportProjectionsCSV());
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
      const [summary, spendTime, jobsites, vendors, typeBreak] = await Promise.all([
        this.api('summary'),
        this.api('spend-over-time'),
        this.api('jobsite-breakdown'),
        this.api('vendor-analysis'),
        this.api('type-breakdown'),
      ]);

      this.renderKPIs(summary);
      this.renderSpendOverTime(spendTime);
      this.renderJobsiteBreakdown(jobsites);
      this.renderVendorAnalysis(vendors);
      this.renderTypeBreakdown(typeBreak);
      this.loadTransactions();
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
      const status = document.getElementById('data-status');
      if (meta.lastUpload) {
        const d = new Date(meta.lastUpload);
        status.textContent = `${meta.totalRows} rows | Last upload: ${d.toLocaleDateString()}`;
        status.classList.add('data-status-active');
      } else {
        status.textContent = 'No data loaded';
        status.classList.remove('data-status-active');
      }
    } catch (err) { /* ignore */ }
  },

  // -- KPI Cards --
  renderKPIs(data) {
    document.getElementById('kpi-gross-spend').textContent = Fmt.currency(data.totalGrossSpend);
    document.getElementById('kpi-customer-credits').textContent = Fmt.currency(data.totalCustomerCredits);
    document.getElementById('kpi-accounting-adj').textContent = Fmt.currency(data.totalAccountingAdj);
    document.getElementById('kpi-net-cost').textContent = Fmt.currency(data.netCostToPSI);
    document.getElementById('kpi-active-jobsites').textContent = data.activeJobsites;
    document.getElementById('kpi-active-vendors').textContent = data.activeVendors;

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
    const ctx = document.getElementById('chart-jobsite-breakdown').getContext('2d');
    // Adjust height based on number of jobsites
    const container = ctx.canvas.parentElement;
    container.style.height = Math.max(400, data.length * 35) + 'px';
    this.charts.jobsiteBreakdown = new Chart(ctx, ChartConfigs.jobsiteBreakdown(data));
  },

  renderVendorAnalysis(data) {
    this.destroyChart('vendorPie');
    const realVendors = data.filter(v => v.vendorName !== 'Internal / Non-Vendor');
    if (!realVendors.length) return;

    // Pie chart
    const ctx = document.getElementById('chart-vendor-pie').getContext('2d');
    this.charts.vendorPie = new Chart(ctx, ChartConfigs.vendorPie(realVendors));

    // Vendor table
    const container = document.getElementById('vendor-table-container');
    let html = '<table class="data-table compact"><thead><tr><th>Vendor</th><th class="num">Spend</th><th class="num">Invoices</th><th class="num">Avg Size</th><th class="num">Jobs</th></tr></thead><tbody>';
    for (const v of data) {
      html += `<tr>
        <td>${v.vendorName}</td>
        <td class="num">${Fmt.currency(v.totalSpend)}</td>
        <td class="num">${v.invoiceCount}</td>
        <td class="num">${Fmt.currency(v.avgInvoiceSize)}</td>
        <td class="num">${v.jobCount}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
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
      const sortQs = `sortBy=${this.currentSort.field}&sortDir=${this.currentSort.dir}&page=${this.currentPage}&limit=50`;
      const sep = qs ? '&' : '';
      const url = `/api/transactions?${sortQs}${sep}${qs}`;
      const result = await (await fetch(url)).json();

      const tbody = document.getElementById('data-table-body');
      if (!result.data.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No transactions to display. Upload an Excel file to get started.</td></tr>';
        document.getElementById('pagination-controls').innerHTML = '';
        return;
      }

      tbody.innerHTML = result.data.map(t => `
        <tr>
          <td>${Fmt.date(t.date)}</td>
          <td>${this.jobsiteMapping[t.baseJob] || t.baseJob}</td>
          <td>${t.serviceOrder}</td>
          <td><span class="badge badge-${t.type.toLowerCase()}">${t.category}</span></td>
          <td>${Fmt.truncate(t.vendorName, 30)}</td>
          <td>${Fmt.truncate(t.description, 35)}</td>
          <td class="num">${t.debit ? Fmt.currencyFull(t.debit) : ''}</td>
          <td class="num">${t.credit ? Fmt.currencyFull(t.credit) : ''}</td>
          <td class="num ${t.net < 0 ? 'text-green' : ''}">${Fmt.currencyFull(t.net)}</td>
          <td class="ref-cell" title="${t.ref || ''}">${Fmt.truncate(t.ref, 25)}</td>
        </tr>
      `).join('');

      // Update sort indicators
      document.querySelectorAll('#data-table th[data-sort]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === this.currentSort.field) {
          th.classList.add(this.currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        }
      });

      // Pagination
      this.renderPagination(result);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    }
  },

  renderPagination(result) {
    const container = document.getElementById('pagination-controls');
    if (result.totalPages <= 1) {
      container.innerHTML = `<span class="page-info">Showing all ${result.total} transactions</span>`;
      return;
    }
    let html = `<span class="page-info">Page ${result.page} of ${result.totalPages} (${result.total} total)</span>`;
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
      `<label class="type-checkbox"><input type="checkbox" value="${t}" checked />${t}</label>`
    ).join('');

    document.querySelectorAll('.ms-item, .ms-all').forEach(input => {
      input.addEventListener('change', () => this.updateMultiSelectControl(input.dataset.prefix));
    });

    this.applyFilterStateToControls();
  },

  createMultiSelect(options, prefix) {
    if (!options.length) return '<span class="empty-filter">No data</span>';
    let html = `<div class="multi-select">`;
    html += `<button class="multi-select-btn" onclick="this.parentElement.classList.toggle('open')">All (${options.length})</button>`;
    html += `<div class="multi-select-dropdown">`;
    html += `<label class="ms-option"><input type="checkbox" class="ms-all" data-prefix="${prefix}" checked onchange="App.toggleAllOptions(this)" /> Select All</label>`;
    for (const o of options) {
      html += `<label class="ms-option"><input type="checkbox" class="ms-item" data-prefix="${prefix}" value="${o.value}" checked /> ${Fmt.truncate(o.label, 35)}</label>`;
    }
    html += '</div></div>';
    return html;
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
    if (!button) return;
    button.classList.toggle('active', Boolean(this.filters.excludeRock));
    button.setAttribute('aria-pressed', this.filters.excludeRock ? 'true' : 'false');
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
          result.className = 'upload-result success';
          result.innerHTML = `
            <strong>Upload Successful</strong><br>
            File: ${data.fileName}<br>
            Rows parsed: ${data.rowsParsed}<br>
            Rows added: ${data.rowsAdded}<br>
            Duplicates skipped: ${data.rowsSkipped}<br>
            Total rows in database: ${data.totalRows}
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
    const entries = Object.entries(this.jobsiteMapping).sort((a, b) => a[0].localeCompare(b[0]));
    const lowerFilter = filter.toLowerCase();
    const filtered = lowerFilter
      ? entries.filter(([job, name]) => job.includes(lowerFilter) || name.toLowerCase().includes(lowerFilter))
      : entries;

    tbody.innerHTML = filtered.map(([job, name]) => {
      const status = this.getMappingStatus(name);
      return `
      <tr class="${status.cls}">
        <td class="job-number">${job}</td>
        <td><input type="text" class="mapping-input" value="${this.escapeHtml(name)}" data-job="${job}" /></td>
        <td class="mapping-status">${status.label}</td>
      </tr>`;
    }).join('');

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

  // -- Projections --
  async renderProjections() {
    try {
      this.projections = await (await fetch('/api/projections')).json();
    } catch (err) {
      this.projections = [];
    }

    // Populate jobsite and vendor dropdowns in the form
    this.populateProjectionDropdowns();

    const tbody = document.getElementById('projections-body');
    const emptyMsg = document.getElementById('projections-empty');
    const totalDiv = document.getElementById('projections-total');
    const items = Array.isArray(this.projections) ? this.projections : [];

    if (!items.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = 'block';
      totalDiv.innerHTML = '';
    } else {
      emptyMsg.style.display = 'none';
      const sorted = [...items].sort((a, b) => (a.month || '').localeCompare(b.month || ''));
      tbody.innerHTML = sorted.map(p => `
        <tr class="row-projected">
          <td>${Fmt.monthLabel(p.month)}</td>
          <td>${this.escapeHtml(this.jobsiteMapping[p.baseJob] || p.baseJob || '--')}</td>
          <td title="${this.escapeHtml(p.vendorName || '--')}">${this.escapeHtml(Fmt.truncate(p.vendorName || '--', 25))}</td>
          <td class="projection-description-cell" title="${this.escapeHtml(p.description || '--')}">${this.escapeHtml(p.descriptionDisplay || p.description || '--')}</td>
          <td class="projection-ref-cell">${this.escapeHtml(p.invoiceNumber || '--')}</td>
          <td class="projection-ref-cell">${this.escapeHtml(p.poNumber || '--')}</td>
          <td><span class="badge badge-projected">${p.type || 'PUR-SUB'}</span></td>
          <td class="num">${Fmt.currency(p.amount)}</td>
          <td style="text-align:center"><button class="btn btn-sm btn-ghost projection-remove" data-id="${p.id}">X</button></td>
        </tr>
      `).join('');

      // Total row
      const total = items.reduce((s, p) => s + (p.amount || 0), 0);
      const byMonth = {};
      items.forEach(p => { byMonth[p.month] = (byMonth[p.month] || 0) + p.amount; });
      const monthCount = Object.keys(byMonth).length;
      totalDiv.innerHTML = `<strong>Total Projected:</strong> ${Fmt.currency(total)} across ${items.length} line items, ${monthCount} months`;
    }

    // Bind remove buttons
    tbody.querySelectorAll('.projection-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/projections/${btn.dataset.id}`, { method: 'DELETE' });
        this.renderProjections();
        const spendTime = await this.api('spend-over-time');
        this.renderSpendOverTime(spendTime);
      });
    });

    // Bind add button (once)
    const addBtn = document.getElementById('btn-add-projection');
    if (!addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', () => this.addProjection());
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

    // Vendors from filter options
    if (vendorSelect && this.filterOptions) {
      const currentVendor = vendorSelect.value;
      vendorSelect.innerHTML = '<option value="">-- Select Vendor --</option>';
      for (const v of this.filterOptions.vendors) {
        if (v.value === 'Internal / Non-Vendor') continue;
        vendorSelect.innerHTML += `<option value="${v.value}">${v.label}</option>`;
      }
      if (currentVendor && currentVendor !== '__custom__' && ![...vendorSelect.options].some(opt => opt.value === currentVendor)) {
        vendorSelect.innerHTML += `<option value="${this.escapeHtml(currentVendor)}">${this.escapeHtml(currentVendor)}</option>`;
      }
      // Allow custom entry
      vendorSelect.innerHTML += '<option value="__custom__">Other (type name)...</option>';
      if ([...vendorSelect.options].some(opt => opt.value === currentVendor)) {
        vendorSelect.value = currentVendor;
      }

      if (!vendorSelect.dataset.bound) {
        vendorSelect.dataset.bound = '1';
        vendorSelect.addEventListener('change', () => {
          if (vendorSelect.value === '__custom__') {
            const custom = prompt('Enter vendor name:');
            if (custom) {
              const opt = document.createElement('option');
              opt.value = custom;
              opt.textContent = custom;
              vendorSelect.insertBefore(opt, vendorSelect.lastElementChild);
              vendorSelect.value = custom;
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

      const skippedText = data.rowsSkipped ? `, skipped ${data.rowsSkipped} duplicates` : '';
      this.setProjectionStatus(`Imported ${data.rowsAdded} projected costs${skippedText}.`, 'saved', 4500);
      await this.refresh();
      await this.renderProjections();
    } catch (err) {
      console.error('Failed to import projections:', err);
      this.setProjectionStatus(err.message || 'Projection import failed.', 'error');
    } finally {
      button.disabled = false;
      fileInput.value = '';
    }
  },

  async addProjection() {
    const month = document.getElementById('proj-month').value;
    const baseJob = document.getElementById('proj-jobsite').value;
    const vendorName = document.getElementById('proj-vendor').value === '__custom__' ? '' : document.getElementById('proj-vendor').value;
    const description = document.getElementById('proj-description').value.trim();
    const invoiceNumber = document.getElementById('proj-invoice').value.trim();
    const poNumber = document.getElementById('proj-po').value.trim();
    const amount = parseFloat(document.getElementById('proj-amount').value);
    const type = document.getElementById('proj-type').value;

    if (!month) { alert('Please select a month.'); return; }
    if (!amount || amount <= 0) { alert('Please enter a valid amount.'); return; }

    this.setProjectionStatus('Adding...', 'saving');

    try {
      const res = await fetch('/api/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, baseJob, vendorName, description, invoiceNumber, poNumber, amount, type }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Unable to add projected cost.');
      }

      this.setProjectionStatus('Added', 'saved', 2000);
      // Clear form fields (keep month and jobsite for quick re-entry)
      document.getElementById('proj-description').value = '';
      document.getElementById('proj-invoice').value = '';
      document.getElementById('proj-po').value = '';
      document.getElementById('proj-amount').value = '';
      // Refresh
      this.renderProjections();
      const spendTime = await this.api('spend-over-time');
      this.renderSpendOverTime(spendTime);
    } catch (err) {
      console.error('Failed to add projection:', err);
      this.setProjectionStatus('Error', 'error');
    }
  },

  exportCSV() {
    const qs = this.buildQueryString();
    window.location.href = `/api/export${qs ? '?' + qs : ''}`;
  },

  exportProjectionsCSV() {
    window.location.href = '/api/projections/export';
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
      await this.refresh();

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
      this.flashButtonLabel('btn-share-view', 'Copied');
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

  flashButtonLabel(id, label) {
    const button = document.getElementById(id);
    if (!button) return;
    const originalLabel = button.dataset.originalLabel || button.textContent;
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
    const typeOptions = (this.filterOptions?.types || []).map(type => ({ value: type, label: type }));
    return [
      { label: 'Date Range', value: this.formatDateFilterSummary() },
      { label: 'Jobsites', value: this.formatSelectionSummary(this.filters.jobsites, this.filterOptions?.jobsites || []) },
      { label: 'Vendors', value: this.formatSelectionSummary(this.filters.vendors, this.filterOptions?.vendors || []) },
      { label: 'Types', value: this.formatSelectionSummary(this.filters.types, typeOptions) },
      { label: 'Special', value: this.filters.excludeRock ? `Excluding ${ROCK_ENTERPRISES_VENDOR}` : 'None' },
    ];
  },

  getReportKpis() {
    return [
      { label: 'Total Gross Spend', value: document.getElementById('kpi-gross-spend').textContent },
      { label: 'Customer Credits', value: document.getElementById('kpi-customer-credits').textContent },
      { label: 'Accounting Adjustments', value: document.getElementById('kpi-accounting-adj').textContent },
      { label: 'Net Cost to PSI', value: document.getElementById('kpi-net-cost').textContent },
      { label: 'Active Jobsites', value: document.getElementById('kpi-active-jobsites').textContent },
      { label: 'Active Vendors', value: document.getElementById('kpi-active-vendors').textContent },
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
    const sortQs = `sortBy=${this.currentSort.field}&sortDir=${this.currentSort.dir}&page=1&limit=1000000`;
    const sep = qs ? '&' : '';
    const url = `/api/transactions?${sortQs}${sep}${qs}`;
    const result = await (await fetch(url)).json();
    return result.data || [];
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

  buildReportMarkup({ includeTransactions = false, transactions = [] } = {}) {
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
    const vendorChart = this.canvasToImageDataUrl('chart-vendor-pie');
    const typeChart = this.canvasToImageDataUrl('chart-type-breakdown');
    const vendorTableHtml = document.getElementById('vendor-table-container').innerHTML || '<div class="report-empty">No vendor data available.</div>';

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
              <h2>Spend Over Time</h2>
              ${spendChart ? `<img src="${spendChart}" alt="Spend Over Time chart" />` : '<div class="report-empty">No chart data available.</div>'}
            </section>

            <section class="report-card-wide">
              <h2>Jobsite Breakdown</h2>
              ${jobsiteChart ? `<img src="${jobsiteChart}" alt="Jobsite Breakdown chart" />` : '<div class="report-empty">No chart data available.</div>'}
            </section>

            <section class="report-card">
              <h2>Vendor Share of Spend</h2>
              ${vendorChart ? `<img src="${vendorChart}" alt="Vendor Share chart" />` : '<div class="report-empty">No chart data available.</div>'}
            </section>

            <section class="report-card">
              <h2>Vendor Details</h2>
              <div class="table-scroll">${vendorTableHtml}</div>
            </section>

            <section class="report-card-wide">
              <h2>Transaction Type Breakdown</h2>
              ${typeChart ? `<img src="${typeChart}" alt="Transaction Type Breakdown chart" />` : '<div class="report-empty">No chart data available.</div>'}
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
      const transactions = await this.fetchAllFilteredTransactions();
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
          ${this.buildReportMarkup({ includeTransactions: true, transactions })}
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
