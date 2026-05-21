/**
 * app.js — CN Backlog Visualizer
 * Data source: Supabase (replaces CSV / PapaParse)
 *
 * SETUP: Replace the two constants below with your Supabase project values.
 * The anon key is safe to expose in frontend code (RLS protects your data).
 */

const SUPABASE_URL  = 'https://jtusharwuoswmgdmjcvx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_n3QnMAwVC3KSkLQUAEYqwA_7kdtNtzp';

// ── Init ──────────────────────────────────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ─────────────────────────────────────────────────────────────────
let allData       = [];
let filteredData  = [];
let sortCol       = 'dias_de_atraso';
let sortAsc       = false;
let selectedRows  = new Set();
let cpSelection   = new Set();
let cityChart     = null;

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const loadingScreen = $('loading-screen');
const errorScreen   = $('error-screen');
const dashboard     = $('dashboard');
const lastUpdated   = $('last-updated');
const tableBody     = $('table-body');
const rowCount      = $('row-count');
const bulkBar       = $('bulk-bar');
const bulkCount     = $('bulk-count');
const selectAll     = $('select-all');

// ── Load data from Supabase ───────────────────────────────────────────────
async function loadData() {
  showScreen('loading');
  $('loading-msg').textContent = 'Conectando con base de datos…';

  try {
    let allRows = [];
    let from    = 0;
    const PAGE  = 1000;

    // Paginate — Supabase default max is 1000 rows per call
    while (true) {
      const { data, error } = await db
        .from('backlog')
        .select('*')
        .range(from, from + PAGE - 1)
        .order('dias_de_atraso', { ascending: false });

      if (error) throw error;
      allRows = allRows.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
      $('loading-msg').textContent = `Cargando… ${allRows.length} paquetes`;
    }

    allData = allRows;
    initDashboard();
    showScreen('dashboard');

    const ts = allData[0]?.loaded_at
      ? new Date(allData[0].loaded_at).toLocaleString('es-MX')
      : 'ahora';
    lastUpdated.textContent = `Actualizado: ${ts}`;

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

// ── Dashboard init ────────────────────────────────────────────────────────
function initDashboard() {
  populateFilters();
  applyFilters();
}

// ── Filters ───────────────────────────────────────────────────────────────
function populateFilters() {
  const statuses  = [...new Set(allData.map(r => r.status).filter(Boolean))].sort();
  const cities    = [...new Set(allData.map(r => r.receiver_city).filter(Boolean))].sort();
  const couriers  = [...new Set(allData.map(r => r.courier_name).filter(Boolean))].sort();
  const cps       = [...new Set(allData.map(r => r.zip_code).filter(Boolean))].sort();

  fillSelect($('filter-status'),  statuses,  'Todos los estados');
  fillSelect($('filter-city'),    cities,    'Todas las ciudades');
  fillSelect($('filter-courier'), couriers,  'Todos los mensajeros');

  // CP multi-select dropdown
  const dd = $('cp-dropdown');
  dd.innerHTML = cps.map(cp =>
    `<label class="cp-option">
       <input type="checkbox" value="${cp}" checked> ${cp}
     </label>`
  ).join('');
  cpSelection = new Set(cps);
  updateCpBtn();

  dd.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) cpSelection.add(cb.value);
      else cpSelection.delete(cb.value);
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
  const all = $('cp-dropdown').querySelectorAll('input').length;
  $('cp-filter-btn').textContent =
    cpSelection.size === all ? 'CP: Todos ▾' : `CP: ${cpSelection.size} ▾`;
}

// CP dropdown toggle
$('cp-filter-btn').addEventListener('click', e => {
  e.stopPropagation();
  $('cp-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', () => $('cp-dropdown').classList.add('hidden'));

// Filter inputs
['filter-status', 'filter-city', 'filter-courier'].forEach(id => {
  $(id).addEventListener('change', applyFilters);
});
$('search-input').addEventListener('input', applyFilters);

function applyFilters() {
  const status   = $('filter-status').value;
  const city     = $('filter-city').value;
  const courier  = $('filter-courier').value;
  const search   = $('search-input').value.toLowerCase().trim();

  filteredData = allData.filter(r => {
    if (status  && r.status        !== status)  return false;
    if (city    && r.receiver_city !== city)     return false;
    if (courier && r.courier_name  !== courier)  return false;
    if (r.zip_code && !cpSelection.has(r.zip_code)) return false;
    if (search && !`${r.tracking_no} ${r.detail_address}`.toLowerCase().includes(search)) return false;
    return true;
  });

  sortData();
  renderKPIs();
  renderCityChart();
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
    if (av < bv) return sortAsc ?  1 : -1;
    if (av > bv) return sortAsc ? -1 :  1;
    return 0;
  });
}

document.querySelectorAll('th.sortable').forEach(th => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = false; }
    document.querySelectorAll('.sort-icon').forEach(el => el.textContent = '↕');
    th.querySelector('.sort-icon').textContent = sortAsc ? '↑' : '↓';
    sortData();
    renderTable();
  });
});

// ── KPIs ──────────────────────────────────────────────────────────────────
function renderKPIs() {
  const d = filteredData;
  $('kpi-total')    .textContent = d.length;
  $('kpi-station')  .textContent = d.filter(r => r.actual_inbound_time).length;
  $('kpi-overdue')  .textContent = d.filter(r => r.dias_de_atraso > 0).length;
  $('kpi-cities')   .textContent = new Set(d.map(r => r.receiver_city).filter(Boolean)).size;
}

// ── City chart ────────────────────────────────────────────────────────────
const PALETTE = [
  '#6C63FF','#FF6584','#43BDFF','#FFD166','#06D6A0',
  '#EF476F','#118AB2','#FFB347','#A8DADC','#E63946',
  '#457B9D','#F4A261','#2A9D8F','#E9C46A','#264653',
];

function renderCityChart() {
  const counts = {};
  filteredData.forEach(r => {
    const c = r.receiver_city || 'Sin ciudad';
    counts[c] = (counts[c] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(e => e[0]);
  const values = sorted.map(e => e[1]);
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  if (cityChart) cityChart.destroy();
  cityChart = new Chart($('cityChart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 1 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } }
      }
    }
  });

  // Custom legend
  $('city-legend').innerHTML = labels.map((l, i) =>
    `<div class="legend-item">
       <span class="legend-dot" style="background:${colors[i]}"></span>
       <span class="legend-label">${esc(l)}</span>
       <span class="legend-val">${values[i]}</span>
     </div>`
  ).join('');
}

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
  updateBulkBar();
  selectAll.checked = false;

  rowCount.textContent = `${filteredData.length} paquetes`;

  tableBody.innerHTML = filteredData.map((r, i) => {
    const days    = r.dias_de_atraso ?? '—';
    const daysCls = r.dias_de_atraso > 3 ? 'days-red' : r.dias_de_atraso > 1 ? 'days-yellow' : '';
    const inbound = r.actual_inbound_time
      ? new Date(r.actual_inbound_time).toLocaleDateString('es-MX')
      : '—';

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
        <td>
          <button class="btn-copy-row" data-idx="${i}" title="Copiar tracking">⎘</button>
        </td>
      </tr>`;
  }).join('');

  // Row checkbox events
  tableBody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx);
      cb.checked ? selectedRows.add(idx) : selectedRows.delete(idx);
      updateBulkBar();
    });
  });

  // Per-row copy button
  tableBody.querySelectorAll('.btn-copy-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = filteredData[parseInt(btn.dataset.idx)];
      navigator.clipboard.writeText(r.tracking_no || '');
      btn.textContent = '✓';
      setTimeout(() => btn.textContent = '⎘', 1200);
    });
  });
}

// Select all
selectAll.addEventListener('change', () => {
  tableBody.querySelectorAll('.row-check').forEach((cb, i) => {
    cb.checked = selectAll.checked;
    selectAll.checked ? selectedRows.add(i) : selectedRows.delete(i);
  });
  updateBulkBar();
});

// Bulk actions
function updateBulkBar() {
  const n = selectedRows.size;
  bulkBar.classList.toggle('hidden', n === 0);
  bulkCount.textContent = `${n} seleccionado${n !== 1 ? 's' : ''}`;
}

$('bulk-copy-btn').addEventListener('click', () => {
  const rows = [...selectedRows].map(i => {
    const r = filteredData[i];
    return [
      r.tracking_no, r.status, r.courier_name,
      r.receiver_city, r.zip_code, r.phone,
      new Date(r.actual_inbound_time || 0).toLocaleDateString('es-MX')
    ].join('\t');
  });
  navigator.clipboard.writeText(rows.join('\n'));
});

$('bulk-clear-btn').addEventListener('click', () => {
  selectedRows.clear();
  tableBody.querySelectorAll('.row-check').forEach(cb => cb.checked = false);
  selectAll.checked = false;
  updateBulkBar();
});

// Refresh button
$('refresh-btn').addEventListener('click', loadData);

// ── Utils ─────────────────────────────────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '—';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────
loadData();
