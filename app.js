/* ─── CONFIG ─────────────────────────────────────────── */
const STATION_COURIER = 'ANDRES_ALVIR_GUZMAN_DESCARGA_ALZ';

const PALETTE = [
  '#f0a500','#3b82f6','#22c55e','#e05c2a','#a855f7',
  '#ec4899','#14b8a6','#f59e0b','#6366f1','#84cc16',
  '#ef4444','#06b6d4','#d946ef','#fb923c','#10b981',
];

/* ─── STATE ──────────────────────────────────────────── */
let allParcels = [];
let cityChart  = null;
let sortCol    = 'overdueDays';
let sortDir    = -1;

/* ─── BOOT ───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupDropZone();

  document.getElementById('reset-btn').addEventListener('click', resetToDropScreen);
  document.getElementById('filter-status').addEventListener('change', renderTable);
  document.getElementById('filter-city').addEventListener('change', renderTable);
  document.getElementById('filter-cp').addEventListener('change', renderTable);
  document.getElementById('filter-courier').addEventListener('change', renderTable);
  document.getElementById('search-input').addEventListener('input', renderTable);

  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      sortDir = (sortCol === col) ? sortDir * -1 : -1;
      sortCol = col;
      document.querySelectorAll('.sort-icon').forEach(s => s.textContent = '↕');
      th.querySelector('.sort-icon').textContent = sortDir === -1 ? '↓' : '↑';
      renderTable();
    });
  });
});

/* ─── DROP ZONE SETUP ────────────────────────────────── */
function setupDropZone() {
  const zone  = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');

  // Drag events on the whole window so you can drop anywhere
  window.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  window.addEventListener('dragleave', e => {
    if (e.relatedTarget === null) zone.classList.remove('drag-over');
  });
  window.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Browse button
  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
  });
}

/* ─── FILE HANDLING ──────────────────────────────────── */
function handleFile(file) {
  if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
    alert('Please drop a .csv file.');
    return;
  }

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (!results.data || results.data.length === 0) {
        alert('CSV appears empty or could not be parsed.');
        return;
      }
      allParcels = results.data.map(normalizeRow).filter(r => r.lp);
      if (allParcels.length === 0) {
        alert('No parcel rows found. Make sure this is the CAINIAO parcel list CSV.');
        return;
      }
      loadDashboard(file.name);
    },
    error: () => alert('Failed to parse CSV file.')
  });
}

function loadDashboard(filename) {
  document.getElementById('drop-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('reset-btn').classList.remove('hidden');
  document.getElementById('last-updated').textContent =
    filename + ' — ' + new Date().toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' });

  populateFilters();
  updateKPIs();
  renderCityChart();
  renderStatusGroups();
  renderTable();
}

function resetToDropScreen() {
  allParcels = [];
  if (cityChart) { cityChart.destroy(); cityChart = null; }
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('drop-screen').classList.remove('hidden');
  document.getElementById('reset-btn').classList.add('hidden');
  document.getElementById('last-updated').textContent = 'No data loaded';
  // Reset filters
  ['filter-status','filter-city','filter-cp','filter-courier'].forEach(id => {
    const sel = document.getElementById(id);
    while (sel.options.length > 1) sel.remove(1);
    sel.value = '';
  });
  document.getElementById('search-input').value = '';
  document.getElementById('file-input').value = '';
}

/* ─── NORMALIZE ROW ──────────────────────────────────── */
function normalizeRow(row) {
  return {
    lp:          v(row, 'LP No.'),
    tracking:    v(row, 'Tracking No.'),
    status:      v(row, 'Status'),
    city:        cleanCity(v(row, 'Receiver City') || v(row, "Receiver's City")),
    cp:          v(row, "Receiver's Zip Code") || v(row, 'Receiver Zip Code') || v(row, 'Zip Code'),
    courier:     v(row, 'Courier Name'),
    receiver:    v(row, 'Original consignee'),
    address:     v(row, "Receiver's Detail Address") || v(row, 'Receiver Detail Address') || v(row, 'Detail Address'),
    phone:       v(row, 'Original consignee telephone'),
    inbound:     v(row, 'Actual Inbound Time'),
    overdueDays: parseInt(v(row, 'overdueDays') || v(row, 'OverdueDays') || '0', 10) || 0,
    isStation:   (v(row, 'Courier Name') || '').trim().toUpperCase() === STATION_COURIER.toUpperCase(),
  };
}

function v(row, key) {
  const found = Object.keys(row).find(k => k.trim().toLowerCase() === key.trim().toLowerCase());
  return found ? (row[found] || '').trim() : '';
}

function cleanCity(raw) {
  if (!raw) return 'Unknown';
  return raw.split(',')[0].trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* ─── KPIs ───────────────────────────────────────────── */
function updateKPIs() {
  document.getElementById('kpi-total').textContent   = allParcels.length;
  document.getElementById('kpi-station').textContent = allParcels.filter(p => p.isStation).length;
  document.getElementById('kpi-overdue').textContent = allParcels.filter(p => p.overdueDays > 0).length;
  document.getElementById('kpi-cities').textContent  = new Set(allParcels.map(p => p.city)).size;
}

/* ─── CITY CHART ─────────────────────────────────────── */
function renderCityChart() {
  const counts = {};
  allParcels.forEach(p => { counts[p.city] = (counts[p.city] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  const labels = sorted.map(e => e[0]);
  const data   = sorted.map(e => e[1]);
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  if (cityChart) cityChart.destroy();
  const ctx = document.getElementById('cityChart').getContext('2d');
  cityChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#18181b', hoverBorderColor: '#f0a500' }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed} paq. (${Math.round(ctx.parsed / allParcels.length * 100)}%)`
          },
          backgroundColor: '#222226', borderColor: '#2e2e33', borderWidth: 1,
          titleColor: '#e8e8ea', bodyColor: '#888890',
        }
      }
    }
  });

  const legend = document.getElementById('city-legend');
  legend.innerHTML = '';
  labels.forEach((label, i) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="background:${colors[i]}"></span>${label} <span style="color:#555">(${data[i]})</span>`;
    item.addEventListener('click', () => {
      const meta = cityChart.getDatasetMeta(0);
      meta.data[i].hidden = !meta.data[i].hidden;
      item.style.opacity = meta.data[i].hidden ? '0.35' : '1';
      cityChart.update();
    });
    legend.appendChild(item);
  });
}

/* ─── STATUS GROUPS ──────────────────────────────────── */
function renderStatusGroups() {
  const groups = {};
  allParcels.forEach(p => {
    const s = p.status || 'Unknown';
    if (!groups[s]) groups[s] = [];
    groups[s].push(p);
  });

  const sorted = Object.entries(groups).sort((a,b) => {
    return Math.max(...b[1].map(p => p.overdueDays)) - Math.max(...a[1].map(p => p.overdueDays));
  });

  const container = document.getElementById('status-list');
  container.innerHTML = '';

  sorted.forEach(([status, parcels]) => {
    const maxDays = Math.max(...parcels.map(p => p.overdueDays));
    const priority = maxDays >= 5 ? 'high' : maxDays >= 2 ? 'medium' : 'low';
    const priorityLabel = maxDays >= 5 ? '⚠ HIGH' : maxDays >= 2 ? '● MED' : '○ LOW';

    const courierCounts = {};
    parcels.forEach(p => {
      const c = p.courier || 'Unknown';
      courierCounts[c] = (courierCounts[c] || 0) + 1;
    });
    const couriersSorted = Object.entries(courierCounts).sort((a,b) => b[1]-a[1]);

    const group  = document.createElement('div');
    group.className = 'status-group';

    const header = document.createElement('div');
    header.className = 'status-group-header';
    header.innerHTML = `
      <div class="sg-left">
        <span class="sg-name">${status}</span>
        <span class="sg-count">${parcels.length}</span>
      </div>
      <span class="sg-priority priority-${priority}">${priorityLabel}</span>
    `;

    const rows = document.createElement('div');
    rows.className = 'sg-rows';

    couriersSorted.forEach(([courier, count]) => {
      const isStation = courier.toUpperCase() === STATION_COURIER.toUpperCase();
      const maxOverdue = Math.max(...parcels.filter(p => p.courier === courier).map(p => p.overdueDays));
      const row = document.createElement('div');
      row.className = 'sg-row';
      row.innerHTML = `
        <span class="sg-courier" title="${escHtml(courier)}">
          ${isStation ? `<span class="station-tag">EN ESTACIÓN</span> ` : ''}${escHtml(courier)}
        </span>
        <span style="color:var(--muted);font-size:10px">${count} paq.</span>
        ${maxOverdue > 0 ? `<span class="overdue-badge">+${maxOverdue}d</span>` : ''}
      `;
      rows.appendChild(row);
    });

    header.addEventListener('click', () => rows.classList.toggle('open'));
    group.appendChild(header);
    group.appendChild(rows);
    container.appendChild(group);
  });
}

/* ─── FILTERS ────────────────────────────────────────── */
function populateFilters() {
  const statuses = [...new Set(allParcels.map(p => p.status).filter(Boolean))].sort();
  const cities   = [...new Set(allParcels.map(p => p.city).filter(Boolean))].sort();
  const cps      = [...new Set(allParcels.map(p => p.cp).filter(Boolean))].sort();
  const couriers = [...new Set(allParcels.map(p => p.courier).filter(Boolean))].sort();
  fillSelect('filter-status', statuses);
  fillSelect('filter-city', cities);
  fillSelect('filter-cp', cps);
  fillSelect('filter-courier', couriers);
}

function fillSelect(id, values) {
  const sel = document.getElementById(id);
  while (sel.options.length > 1) sel.remove(1);
  values.forEach(val => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = val;
    sel.appendChild(opt);
  });
}

/* ─── TABLE ──────────────────────────────────────────── */
function renderTable() {
  const fStatus  = document.getElementById('filter-status').value;
  const fCity    = document.getElementById('filter-city').value;
  const fCp      = document.getElementById('filter-cp').value;
  const fCourier = document.getElementById('filter-courier').value;
  const search   = document.getElementById('search-input').value.toLowerCase();

  let rows = allParcels.filter(p => {
    if (fStatus  && p.status  !== fStatus)  return false;
    if (fCity    && p.city    !== fCity)     return false;
    if (fCp      && p.cp      !== fCp)       return false;
    if (fCourier && p.courier !== fCourier)  return false;
    if (search && !`${p.lp} ${p.tracking} ${p.receiver} ${p.phone}`.toLowerCase().includes(search)) return false;
    return true;
  });

  rows.sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (sortCol === 'overdueDays') { av = +av || 0; bv = +bv || 0; }
    else { av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase(); }
    return av < bv ? -sortDir : av > bv ? sortDir : 0;
  });

  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';
  rows.forEach(p => {
    const tr = document.createElement('tr');
    const copyText = [p.tracking, p.city, p.cp, p.address, p.phone].filter(Boolean).join(' | ');
    tr.innerHTML = `
      <td class="${p.overdueDays > 0 ? 'overdue-cell' : 'days-zero'}">${p.overdueDays > 0 ? '+' + p.overdueDays + 'd' : '0'}</td>
      <td>${statusPill(p.status)}</td>
      <td>${p.isStation ? '<span class="station-tag">EN ESTACIÓN</span>' : escHtml(shortStr(p.courier, 28))}</td>
      <td>${escHtml(p.city)}</td>
      <td>${escHtml(p.cp)}</td>
      <td style="font-size:10px;color:var(--muted)">${escHtml(p.tracking)}</td>
      <td class="cell-address" title="${escHtml(p.address)}">${escHtml(shortStr(p.address, 48))}</td>
      <td>${escHtml(p.phone)}</td>
      <td style="color:var(--muted)">${formatDate(p.inbound)}</td>
      <td><button class="btn-copy" data-text="${escHtml(copyText)}" title="Copiar para mensajero">&#x2398;</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('row-count').textContent =
    `${rows.length} of ${allParcels.length} packages`;

  // Copy button delegation
  tbody.onclick = (e) => {
    const btn = e.target.closest('.btn-copy');
    if (!btn) return;
    const text = btn.dataset.text;
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✓';
      btn.style.color = 'var(--ok)';
      setTimeout(() => { btn.innerHTML = '&#x2398;'; btn.style.color = ''; }, 1500);
    });
  };
}

/* ─── HELPERS ────────────────────────────────────────── */
function statusPill(status) {
  if (!status) return '<span class="pill pill-other">—</span>';
  const s = status.toLowerCase();
  let cls = s.includes('picked') ? 'pill-picked'
          : s.includes('assigned') ? 'pill-assigned'
          : s.includes('sorting') ? 'pill-sorting'
          : 'pill-other';
  return `<span class="pill ${cls}">${escHtml(status)}</span>`;
}

function shortStr(str, max) {
  if (!str) return '—';
  return str.length > max ? str.substring(0, max - 1) + '…' : str;
}

function formatDate(raw) {
  if (!raw) return '—';
  try {
    return new Date(raw).toLocaleString('es-MX', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch { return raw; }
}

function escHtml(str) {
  if (!str) return '—';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
