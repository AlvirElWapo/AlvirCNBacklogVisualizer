/**
 * app.js — CN Backlog Visualizer
 * Features:
 *  - Supabase data source (replaces CSV)
 *  - Chart toggle: Ciudad / Driver
 *  - Click chart slice → filter table + bulk-select those rows
 *  - All filter dropdowns work as querying fields for bulk ops
 *  - Bulk copy, clear, select-all
 */

// ── CONFIG — fill these in ────────────────────────────────────────────────
const SUPABASE_URL  = 'https://jtusharwuoswmgdmjcvx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_n3QnMAwVC3KSkLQUAEYqwA_7kdtNtzp';
// ──────────────────────────────────────────────────────────────────────────

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ─────────────────────────────────────────────────────────────────
let allData      = [];
let filteredData = [];
let sortCol      = 'dias_de_atraso';
let sortAsc      = false;
let selectedRows = new Set();
let cpSelection  = new Set();
let cityChart    = null;
let chartMode    = 'city';      // 'city' | 'driver'
let chartFilter  = null;        // { mode, value } | null — active chart-slice filter

// ── DOM ───────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const loadingScreen    = $('loading-screen');
const errorScreen      = $('error-screen');
const dashboard        = $('dashboard');
const tableBody        = $('table-body');
const selectAllCb      = $('select-all');
const bulkBar          = $('bulk-bar');
const bulkCount        = $('bulk-count');
const chartFilterBadge = $('chart-filter-badge');
const chartFilterLabel = $('chart-filter-label');

// ── Load ──────────────────────────────────────────────────────────────────
async function loadData() {
  showScreen('loading');
  $('loading-msg').textContent = 'Conectando con base de datos…';
  chartFilter = null;
  hideBadge();

  try {
    let rows = [], from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await db
        .from('backlog').select('*')
        .range(from, from + PAGE - 1)
        .order('dias_de_atraso', { ascending: false });
      if (error) throw error;
      rows = rows.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
      $('loading-msg').textContent = `Cargando… ${rows.length} paquetes`;
    }
    allData = rows;
    initDashboard();
    showScreen('dashboard');
    const ts = allData[0]?.loaded_at
      ? new Date(allData[0].loaded_at).toLocaleString('es-MX') : 'ahora';
    $('last-updated').textContent = `Actualizado: ${ts}`;
  } catch (err) {
    console.error(err);
    showScreen('error');
    $('error-msg').textContent = err.message || 'No se pudo conectar';
  }
}

function showScreen(name) {
  loadingScreen.classList.toggle('hidden', name !== 'loading');
  errorScreen  .classList.toggle('hidden', name !== 'error');
  dashboard    .classList.toggle('hidden', name !== 'dashboard');
}

// ── Init ──────────────────────────────────────────────────────────────────
function initDashboard() {
  populateFilters();
  applyFilters();
}

// ── Filters ───────────────────────────────────────────────────────────────
function populateFilters() {
  const uniq = (key) => [...new Set(allData.map(r => r[key]).filter(Boolean))].sort();

  fillSelect($('filter-status'),  uniq('status'),        'Todos los estados');
  fillSelect($('filter-city'),    uniq('receiver_city'), 'Todas las ciudades');
  fillSelect($('filter-courier'), uniq('courier_name'),  'Todos los mensajeros');

  // CP multi-select
  const cps = uniq('zip_code');
  cpSelection = new Set(cps);
  const dd = $('cp-dropdown');
  dd.innerHTML = cps.map(cp =>
    `<label class="cp-option">
       <input type="checkbox" value="${esc(cp)}" checked> ${esc(cp)}
     </label>`).join('');
  updateCpBtn();
  dd.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.checked ? cpSelection.add(cb.value) : cpSelection.delete(cb.value);
      updateCpBtn();
      applyFilters();
    });
  });
}

function fillSelect(sel, opts, placeholder) {
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
}

function updateCpBtn() {
  const total = $('cp-dropdown').querySelectorAll('input').length;
  $('cp-filter-btn').textContent =
    cpSelection.size === total ? 'CP: Todos ▾' : `CP: ${cpSelection.size} ▾`;
}

// CP dropdown toggle
$('cp-filter-btn').addEventListener('click', e => {
  e.stopPropagation();
  $('cp-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', () => $('cp-dropdown').classList.add('hidden'));

['filter-status','filter-city','filter-courier'].forEach(id => {
  $(id).addEventListener('change', applyFilters);
});
$('search-input').addEventListener('input', applyFilters);

function applyFilters() {
  const status  = $('filter-status').value;
  const city    = $('filter-city').value;
  const courier = $('filter-courier').value;
  const search  = $('search-input').value.toLowerCase().trim();

  filteredData = allData.filter(r => {
    if (status  && r.status        !== status)  return false;
    if (city    && r.receiver_city !== city)     return false;
    if (courier && r.courier_name  !== courier)  return false;
    if (r.zip_code && !cpSelection.has(r.zip_code)) return false;
    if (search && !`${r.tracking_no} ${r.detail_address}`.toLowerCase().includes(search)) return false;
    // Chart-slice filter — applied ON TOP of regular filters
    if (chartFilter) {
      if (chartFilter.mode === 'city'   && r.receiver_city !== chartFilter.value) return false;
      if (chartFilter.mode === 'driver' && r.courier_name  !== chartFilter.value) return false;
    }
    return true;
  });

  sortData();
  renderKPIs();
  renderChart();
  renderStatusList();
  renderTable();
}

// ── Sort ──────────────────────────────────────────────────────────────────
function sortData() {
  filteredData.sort((a, b) => {
    let av = a[sortCol] ?? -Infinity;
    let bv = b[sortCol] ?? -Infinity;
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    return av < bv ? (sortAsc ? 1 : -1) : av > bv ? (sortAsc ? -1 : 1) : 0;
  });
}

document.querySelectorAll('th.sortable').forEach(th => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    if (sortCol === th.dataset.col) sortAsc = !sortAsc;
    else { sortCol = th.dataset.col; sortAsc = false; }
    document.querySelectorAll('.sort-icon').forEach(el => el.textContent = '↕');
    th.querySelector('.sort-icon').textContent = sortAsc ? '↑' : '↓';
    sortData();
    renderTable();
  });
});

// ── KPIs ──────────────────────────────────────────────────────────────────
function renderKPIs() {
  const d = filteredData;
  $('kpi-total')  .textContent = d.length;
  $('kpi-station').textContent = d.filter(r => r.actual_inbound_time).length;
  $('kpi-overdue').textContent = d.filter(r => r.dias_de_atraso > 0).length;
  $('kpi-cities') .textContent = new Set(d.map(r => r.receiver_city).filter(Boolean)).size;
}

// ── Chart ─────────────────────────────────────────────────────────────────
const PALETTE = [
  '#6C63FF','#43BDFF','#FF6584','#06D6A0','#FFD166',
  '#EF476F','#118AB2','#FFB347','#A8DADC','#E63946',
  '#457B9D','#F4A261','#2A9D8F','#E9C46A','#264653',
  '#9B5DE5','#F15BB5','#FEE440','#00BBF9','#00F5D4',
];

function getChartKey(r) {
  return chartMode === 'city'
    ? (r.receiver_city || 'Sin ciudad')
    : (r.courier_name  || 'Sin asignar');
}

function renderChart() {
  // Build counts from the BASE filtered data (not including chartFilter)
  // so the pie always shows the full distribution for current dropdowns
  const baseData = allData.filter(r => {
    const status  = $('filter-status').value;
    const city    = $('filter-city').value;
    const courier = $('filter-courier').value;
    const search  = $('search-input').value.toLowerCase().trim();
    if (status  && r.status        !== status)  return false;
    if (city    && r.receiver_city !== city)     return false;
    if (courier && r.courier_name  !== courier)  return false;
    if (r.zip_code && !cpSelection.has(r.zip_code)) return false;
    if (search && !`${r.tracking_no} ${r.detail_address}`.toLowerCase().includes(search)) return false;
    return true;
  });

  const counts = {};
  baseData.forEach(r => {
    const k = getChartKey(r);
    counts[k] = (counts[k] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(e => e[0]);
  const values = sorted.map(e => e[1]);
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  // Highlight active slice
  const borderWidths = labels.map(l =>
    chartFilter && chartFilter.value === l ? 3 : 1
  );
  const borderColors = labels.map(l =>
    chartFilter && chartFilter.value === l ? '#fff' : 'transparent'
  );

  if (cityChart) cityChart.destroy();
  cityChart = new Chart($('cityChart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: borderColors,
        borderWidth: borderWidths,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const idx   = elements[0].index;
        const value = labels[idx];
        // Toggle: clicking same slice clears filter
        if (chartFilter && chartFilter.mode === chartMode && chartFilter.value === value) {
          clearChartFilter();
        } else {
          chartFilter = { mode: chartMode, value };
          showBadge(value);
          applyFilters();        // re-filter + re-render table
          selectAllVisible();   // auto-select all matching rows
        }
      }
    }
  });

  $('chart-title').textContent =
    chartMode === 'city' ? 'Paquetes por ciudad' : 'Paquetes por driver';

  // Legend
  $('city-legend').innerHTML = labels.map((l, i) =>
    `<div class="legend-item${chartFilter?.value===l?' active':''}" data-idx="${i}">
       <span class="legend-dot" style="background:${colors[i]}"></span>
       <span class="legend-label" title="${esc(l)}">${esc(l)}</span>
       <span class="legend-val">${values[i]}</span>
     </div>`
  ).join('');

  // Legend click mirrors chart click
  $('city-legend').querySelectorAll('.legend-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx   = parseInt(item.dataset.idx);
      const value = labels[idx];
      if (chartFilter && chartFilter.mode === chartMode && chartFilter.value === value) {
        clearChartFilter();
      } else {
        chartFilter = { mode: chartMode, value };
        showBadge(value);
        applyFilters();
        selectAllVisible();
      }
    });
  });
}

function clearChartFilter() {
  chartFilter = null;
  hideBadge();
  applyFilters();
}

function showBadge(label) {
  chartFilterBadge.classList.add('visible');
  chartFilterLabel.textContent = `Filtrado: ${label}`;
}
function hideBadge() {
  chartFilterBadge.classList.remove('visible');
  chartFilterLabel.textContent = '';
}

chartFilterBadge.addEventListener('click', clearChartFilter);

// ── Chart toggle ──────────────────────────────────────────────────────────
$('toggle-city').addEventListener('click', () => {
  chartMode = 'city';
  chartFilter = null;
  hideBadge();
  $('toggle-city')  .classList.add('active');
  $('toggle-driver').classList.remove('active');
  applyFilters();
});
$('toggle-driver').addEventListener('click', () => {
  chartMode = 'driver';
  chartFilter = null;
  hideBadge();
  $('toggle-driver').classList.add('active');
  $('toggle-city')  .classList.remove('active');
  applyFilters();
});

// ── Status list ───────────────────────────────────────────────────────────
function renderStatusList() {
  const groups = {};
  filteredData.forEach(r => {
    const s = r.status || 'Sin estado';
    if (!groups[s]) groups[s] = { count: 0, maxDays: 0 };
    groups[s].count++;
    groups[s].maxDays = Math.max(groups[s].maxDays, r.dias_de_atraso || 0);
  });
  const sorted = Object.entries(groups).sort((a, b) => b[1].maxDays - a[1].maxDays);
  const max    = Math.max(...sorted.map(e => e[1].count), 1);

  $('status-list').innerHTML = sorted.map(([status, { count, maxDays }]) => {
    const pct   = Math.round((count / max) * 100);
    const label = maxDays > 0 ? `${maxDays}d` : '';
    const cls   = maxDays > 3 ? 'bar-red' : maxDays > 1 ? 'bar-yellow' : 'bar-green';
    return `
      <div class="status-row">
        <div class="status-name">${esc(status)}</div>
        <div class="status-bar-wrap">
          <div class="status-bar ${cls}" style="width:${pct}%"></div>
        </div>
        <div class="status-meta">
          <span class="status-count">${count}</span>
          ${label ? `<span class="status-days">${label}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── Table ─────────────────────────────────────────────────────────────────
function renderTable() {
  selectedRows.clear();
  selectAllCb.checked = false;
  updateBulkBar();

  $('row-count').textContent = `${filteredData.length} paquetes`;

  tableBody.innerHTML = filteredData.map((r, i) => {
    const days    = r.dias_de_atraso ?? '—';
    const daysCls = r.dias_de_atraso > 3 ? 'days-red' : r.dias_de_atraso > 1 ? 'days-yellow' : '';
    const inbound = r.actual_inbound_time
      ? new Date(r.actual_inbound_time).toLocaleDateString('es-MX') : '—';
    return `
      <tr data-idx="${i}">
        <td><input type="checkbox" class="row-check" data-idx="${i}"></td>
        <td class="days-cell ${daysCls}">${days}</td>
        <td>${esc(r.status)}</td>
        <td>${esc(r.courier_name)}</td>
        <td>${esc(r.receiver_city)}</td>
        <td>${esc(r.zip_code)}</td>
        <td class="tracking-cell">${esc(r.tracking_no)}</td>
        <td class="addr-cell" title="${esc(r.detail_address)}">${esc(r.detail_address)}</td>
        <td>${esc(r.phone)}</td>
        <td>${inbound}</td>
        <td><button class="btn-copy-row" data-idx="${i}" title="Copiar tracking">⎘</button></td>
      </tr>`;
  }).join('');

  // Row checkboxes
  tableBody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx);
      cb.checked ? selectedRows.add(idx) : selectedRows.delete(idx);
      updateBulkBar();
      syncSelectAll();
    });
  });

  // Per-row copy
  tableBody.querySelectorAll('.btn-copy-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = filteredData[parseInt(btn.dataset.idx)];
      navigator.clipboard.writeText(r.tracking_no || '');
      btn.textContent = '✓';
      setTimeout(() => btn.textContent = '⎘', 1200);
    });
  });
}

// Select all visible
function selectAllVisible() {
  tableBody.querySelectorAll('.row-check').forEach((cb, i) => {
    cb.checked = true;
    selectedRows.add(i);
  });
  selectAllCb.checked = true;
  updateBulkBar();
}

function syncSelectAll() {
  const total = tableBody.querySelectorAll('.row-check').length;
  selectAllCb.checked = selectedRows.size === total && total > 0;
}

selectAllCb.addEventListener('change', () => {
  tableBody.querySelectorAll('.row-check').forEach((cb, i) => {
    cb.checked = selectAllCb.checked;
    selectAllCb.checked ? selectedRows.add(i) : selectedRows.delete(i);
  });
  updateBulkBar();
});

function updateBulkBar() {
  const n = selectedRows.size;
  bulkBar.classList.toggle('hidden', n === 0);
  bulkCount.textContent = `${n} seleccionado${n !== 1 ? 's' : ''}`;
}

$('bulk-copy-btn').addEventListener('click', () => {
  const lines = [...selectedRows].sort((a,b)=>a-b).map(i => {
    const r = filteredData[i];
    return [
      r.tracking_no, r.status, r.courier_name,
      r.receiver_city, r.zip_code, r.phone,
      r.actual_inbound_time
        ? new Date(r.actual_inbound_time).toLocaleDateString('es-MX') : ''
    ].join('\t');
  });
  navigator.clipboard.writeText(lines.join('\n'));
  $('bulk-copy-btn').textContent = '✓ Copiado';
  setTimeout(() => $('bulk-copy-btn').textContent = '⎘ Copiar seleccionados', 1500);
});

$('bulk-clear-btn').addEventListener('click', () => {
  selectedRows.clear();
  tableBody.querySelectorAll('.row-check').forEach(cb => cb.checked = false);
  selectAllCb.checked = false;
  updateBulkBar();
});

$('refresh-btn').addEventListener('click', loadData);

// ── Utils ─────────────────────────────────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '—';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────
loadData();
