(() => {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yearSelect = document.getElementById('quality-year');
  const monthSelect = document.getElementById('quality-through');
  const excludeRock = document.getElementById('quality-exclude-rock');
  const status = document.getElementById('quality-status');
  const tableWrap = document.getElementById('quality-table-wrap');
  const actions = ['quality-export', 'quality-transactions', 'quality-print'].map(id => document.getElementById(id));
  let report = null;
  let activeRequest = 0;
  let displayedQuery = '';
  monthNames.forEach((name, index) => monthSelect.add(new Option(name, index + 1)));

  function paramsFromControls() {
    return new URLSearchParams({ year: yearSelect.value, throughMonth: monthSelect.value, excludeRock: excludeRock.checked ? '1' : '0' });
  }

  async function load(params) {
    const request = ++activeRequest;
    actions.forEach(button => { button.disabled = true; });
    tableWrap.classList.add('hidden');
    status.textContent = 'Loading posted transactions…';
    status.classList.remove('hidden');
    document.getElementById('quality-data-note').textContent = '';
    try {
      const response = await fetch(`/api/quality-report?${params}`, { cache: 'no-store' });
      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load the quality report.');
      if (request !== activeRequest) return;
      report = data;
      const years = [...new Set([...data.availableYears, data.year])].sort((a, b) => b - a);
      yearSelect.replaceChildren(...years.map(year => new Option(year, year, false, year === data.year)));
      monthSelect.value = data.throughMonth;
      excludeRock.checked = data.excludeRock;
      displayedQuery = paramsFromControls().toString();
      history.replaceState(null, '', `/quality.html?${displayedQuery}`);
      document.getElementById('quality-title').textContent = `${data.year} net costs — January through ${monthNames[data.throughMonth - 1]}`;
      document.getElementById('quality-scope').textContent = data.excludeRock ? 'All jobsites. Excludes Rock Enterprises (PDX exhaust stack rust).' : 'All jobsites and vendors.';
      const headers = ['Month', ...data.months.map(month => monthNames[Number(month.month.slice(5)) - 1]), 'YTD Total'];
      const head = document.createElement('tr');
      headers.forEach((label, index) => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = label;
        if (index === headers.length - 1) cell.className = 'quality-total';
        head.append(cell);
      });
      document.getElementById('quality-table-head').replaceChildren(head);
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = 'Net cost';
      row.append(label);
      [...data.months.map(month => month.net), data.total].forEach((amount, index) => {
        const cell = document.createElement('td');
        cell.textContent = Fmt.currency(amount);
        cell.title = Fmt.currencyFull(amount);
        if (index === data.months.length) cell.className = 'quality-total';
        row.append(cell);
      });
      document.getElementById('quality-table-body').replaceChildren(row);
      status.textContent = data.transactionCount ? '' : 'No posted transactions for this selection.';
      status.classList.toggle('hidden', data.transactionCount > 0);
      tableWrap.classList.toggle('hidden', !data.transactionCount);
      document.getElementById('quality-data-note').textContent = `${Fmt.number(data.transactionCount)} cost transactions in this report. ${Fmt.number(data.excludedWipTransferCount)} WIP transfers excluded. ${data.latestDate ? `Latest transaction loaded for ${data.year}: ${Fmt.date(data.latestDate)}. Months may change as Accounting posts additional transactions.` : 'No transactions loaded for this year.'}`;
      actions.forEach(button => { button.disabled = !data.transactionCount; });
    } catch (error) {
      if (request !== activeRequest) return;
      status.textContent = error.message;
    }
  }

  document.getElementById('quality-controls').addEventListener('submit', event => {
    event.preventDefault();
    load(paramsFromControls());
  });
  // Clear stale output immediately when the user changes its selection.
  document.getElementById('quality-controls').addEventListener('change', () => load(paramsFromControls()));
  document.getElementById('quality-export').addEventListener('click', () => {
    window.location.href = `/api/quality-report?${displayedQuery}&format=csv`;
  });
  document.getElementById('quality-transactions').addEventListener('click', () => {
    const params = new URLSearchParams({ startDate: report.startDate, endDate: report.endDate, excludeWipTransfers: '1' });
    if (report.excludeRock) params.set('excludeVendors', 'Rock Enterprises');
    window.location.href = `/api/export?${params}`;
  });
  document.getElementById('quality-print').addEventListener('click', () => window.print());
  const initial = new URLSearchParams(window.location.search);
  if (!initial.has('excludeRock')) initial.set('excludeRock', '1');
  load(initial);
})();
