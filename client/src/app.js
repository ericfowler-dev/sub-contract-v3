// PSI Sub-Contract Dashboard - Main App
const App = {
  charts: {},
  filters: {},
  filterOptions: null,
  currentSort: { field: 'date', dir: 'desc' },
  currentPage: 1,
  jobsiteMapping: {},
  projections: {},

  async init() {
    this.bindEvents();
    await this.loadFilterOptions();
    await this.loadJobsiteMapping();
    await this.refresh();
    await this.loadMetadata();
  },

  bindEvents() {
    // Filter controls
    document.getElementById('btn-apply-filters').addEventListener('click', () => this.applyFilters());
    document.getElementById('btn-clear-filters').addEventListener('click', () => this.clearFilters());

    // Quick date range filters (YTD, Last 12 Mo, etc.)
    document.querySelectorAll('.quick-filter').forEach(btn => {
      btn.addEventListener('click', () => this.applyQuickFilter(btn.dataset.range));
    });

    // Modal toggles
    document.getElementById('btn-upload-panel').addEventListener('click', () => this.showModal('upload-modal'));
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
        e.target.closest('.modal').classList.add('hidden');
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
    return params.toString();
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
      this.refresh();
      return;
    }

    document.getElementById('filter-start-date').value = startDate;
    document.getElementById('filter-end-date').value = endDate;
    this.applyFilters();
  },

  applyFilters() {
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;

    const selectedJobsites = [...document.querySelectorAll('.ms-item[data-prefix="jobsite"]:checked')].map(cb => cb.value);
    const selectedVendors = [...document.querySelectorAll('.ms-item[data-prefix="vendor"]:checked')].map(cb => cb.value);
    const selectedTypes = [...document.querySelectorAll('#filter-types input:checked')].map(cb => cb.value);

    // Only set filters if not "all" selected
    const allJobsites = document.querySelectorAll('.ms-item[data-prefix="jobsite"]').length;
    const allVendors = document.querySelectorAll('.ms-item[data-prefix="vendor"]').length;
    const allTypes = document.querySelectorAll('#filter-types input').length;

    this.filters = {
      startDate: startDate || null,
      endDate: endDate || null,
      jobsites: selectedJobsites.length < allJobsites ? selectedJobsites : null,
      vendors: selectedVendors.length < allVendors ? selectedVendors : null,
      types: selectedTypes.length < allTypes ? selectedTypes : null,
    };

    this.currentPage = 1;
    this.refresh();
  },

  clearFilters() {
    this.filters = {};
    // Reset UI
    document.querySelectorAll('.ms-item, .ms-all, #filter-types input').forEach(cb => { cb.checked = true; });
    if (this.filterOptions) {
      if (this.filterOptions.dateRange.min) {
        document.getElementById('filter-start-date').value = this.filterOptions.dateRange.min.substring(0, 7);
      }
      if (this.filterOptions.dateRange.max) {
        document.getElementById('filter-end-date').value = this.filterOptions.dateRange.max.substring(0, 7);
      }
    }
    // Update multi-select button labels
    document.querySelectorAll('.multi-select-btn').forEach(btn => {
      const total = btn.parentElement.querySelectorAll('.ms-item').length;
      btn.textContent = `All (${total})`;
    });
    this.currentPage = 1;
    this.refresh();
  },

  // -- Upload --
  initUpload() {
    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('upload-file-input');
    const submitBtn = document.getElementById('btn-upload-submit');
    let selectedFile = null;

    // Drag and drop
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
        selectedFile = file;
        document.getElementById('upload-file-name').textContent = file.name;
        submitBtn.disabled = false;
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) {
        selectedFile = fileInput.files[0];
        document.getElementById('upload-file-name').textContent = selectedFile.name;
        submitBtn.disabled = false;
      }
    });

    submitBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      const mode = document.querySelector('input[name="upload-mode"]:checked').value;
      const progress = document.getElementById('upload-progress');
      const result = document.getElementById('upload-result');

      progress.classList.remove('hidden');
      result.classList.add('hidden');
      submitBtn.disabled = true;

      try {
        const formData = new FormData();
        formData.append('file', selectedFile);
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
      submitBtn.disabled = false;
    });
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

    const statusEl = document.getElementById('projection-save-status');
    statusEl.textContent = 'Adding...';
    statusEl.className = 'save-status saving';

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

      statusEl.textContent = 'Added';
      statusEl.className = 'save-status saved';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
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
      statusEl.textContent = 'Error';
      statusEl.className = 'save-status error';
    }
  },

  exportCSV() {
    const qs = this.buildQueryString();
    window.location.href = `/api/export${qs ? '?' + qs : ''}`;
  },

  showModal(id) {
    document.getElementById(id).classList.remove('hidden');
    if (id === 'upload-modal') this.loadUploadHistory();
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());
