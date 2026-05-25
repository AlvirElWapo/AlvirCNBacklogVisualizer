/**
 * app.js — CN Backlog Visualizer
 * ─────────────────────────────────────────────────────────────
 * FILL IN YOUR SUPABASE CREDENTIALS BELOW BEFORE DEPLOYING
 */

const SUPABASE_URL  = 'https://jtusharwuoswmgdmjcvx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_n3QnMAwVC3KSkLQUAEYqwA_7kdtNtzp';


// ─────────────────────────────────────────────────────────────

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ─────────────────────────────────────────────────────
let allData      = [];   // backlog merged with tags
let filteredData = [];
let tagMap       = {};   // tracking_no → tag string
let dnaData      = [];   // did_not_arrive rows
let retData      = [];   // return_packages rows
let sortCol      = 'dias_de_atraso';
let sortAsc      = false;
let selectedRows = new Set();
let cpSelection  = new Set();
let cityChart    = null;
let chartMode    = 'city';
let chartFilter  = null;
let activeTab    = 'dashboard';
let drawerTracking = null;
let bulkTagSelected = null;

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Status colour rules (pattern → {bg, fg}) ─────────────────
const STATUS_RULES = [
  { re: /sign|entregad|已签收|delivered|妥投|receipt/i,  bg:'rgba(6,214,160,.15)',   fg:'#06d6a0' },
  { re: /派送|dispatch|out.?for|ruta|camino|en route/i,  bg:'rgba(67,189,255,.15)',  fg:'#43bdff' },
  { re: /return|退|retorn|devuelt|回件/i,                 bg:'rgba(244,197,66,.15)',  fg:'#f4c542' },
  { re: /problem|excep|error|fail|异常|问题|undeliver/i,  bg:'rgba(239,69,101,.15)',  fg:'#ef4565' },
  { re: /arriv|到站|到件|inbound|recib|station/i,         bg:'rgba(108,99,255,.15)',  fg:'#8b7fff' },
  { re: /pending|wait|pendiente|待/i,                     bg:'rgba(90,98,128,.12)',   fg:'#8a94b8' },
];
function statusStyle(s) {
  if (!s) return { bg:'rgba(90,98,128,.1)', fg:'#5a6280' };
  const rule = STATUS_RULES.find(r => r.re.test(s));
  return rule ? { bg:rule.bg, fg:rule.fg } : { bg:'rgba(108,99,255,.12)', fg:'#6c63ff' };
}

// ── Tag styles ────────────────────────────────────────────────
const TAG_STYLES = {
  'NO LLEGO A ESTACIÓN':{ bg:'rgba(239,69,101,.15)', fg:'#ef4565', cls:'active-no-llego' },
  'RETORNO REALIZADO':  { bg:'rgba(244,197,66,.15)',  fg:'#f4c542', cls:'active-retorno'  },
  'ENTREGADO':          { bg:'rgba(6,214,160,.15)',   fg:'#06d6a0', cls:'active-entregado'},
};
function tagBadge(tag) {
  if (!tag) return '';
  const s = TAG_STYLES[tag];
  if (!s) return '';
  return `<span class="tag-badge" style="background:${s.bg};color:${s.fg};border-color:${s.fg}33">${tag}</span>`;
}

// ─────────────────────────────────────────────────────────────
// DATA LOADING
// ─────────────────────────────────────────────────────────────
async function loadData() {
  showScreen('loading');
  $('loading-msg').textContent = 'Conectando con base de datos…';
  chartFilter = null; hideBadge();

  try {
    // Load backlog + tags in parallel
    const [backlog, tagsRes] = await Promise.all([
      loadBacklog(),
      db.from('package_tags').select('tracking_no,tag')
    ]);
    if (tagsRes.error) throw tagsRes.error;

    // Build tag map
    tagMap = {};
    (tagsRes.data || []).forEach(t => { tagMap[t.tracking_no] = t.tag; });

    // Merge tags into backlog rows
    allData = backlog.map(r => ({ ...r, tag: tagMap[r.tracking_no] || null }));

    initDashboard();
    showScreen('dashboard');

    const ts = allData[0]?.loaded_at
      ? new Date(allData[0].loaded_at).toLocaleString('es-MX') : 'ahora';
    $('last-updated').textContent = `Actualizado: ${ts}`;

    // Load ops data in background
    loadOpsData();

  } catch (err) {
    console.error(err);
    showScreen('error');
    $('error-msg').textContent = err.message || 'No se pudo conectar';
  }
}

async function loadBacklog() {
  let rows = [], from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await db.from('backlog').select('*')
      .range(from, from + PAGE - 1).order('dias_de_atraso', { ascending: false });
    if (error) throw error;
    rows = rows.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
    $('loading-msg').textContent = `Cargando… ${rows.length} paquetes`;
  }
  return rows;
}

async function loadOpsData() {
  const [dnaRes, retRes] = await Promise.all([
    db.from('did_not_arrive').select('*').order('assigned_date', { ascending: false }).limit(200),
    db.from('return_packages').select('*').order('sent_date', { ascending: false }).limit(200),
  ]);
  dnaData = dnaRes.data || [];
  retData = retRes.data || [];
  renderDNATable();
  renderRetTable();
}

function showScreen(name) {
  $('loading-screen').classList.toggle('hidden', name !== 'loading');
  $('error-screen')  .classList.toggle('hidden', name !== 'error');
  $('tab-nav')       .classList.toggle('hidden', name !== 'dashboard');
  $('tab-dashboard') .classList.toggle('hidden', name !== 'dashboard');
  $('tab-operaciones').classList.add('hidden');
  if (name === 'dashboard') showTab(activeTab);
}

// ─────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────
function showTab(tab) {
  activeTab = tab;
  $('tab-dashboard')  .classList.toggle('hidden', tab !== 'dashboard');
  $('tab-operaciones').classList.toggle('hidden', tab !== 'operaciones');
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tab));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ─────────────────────────────────────────────────────────────
// INIT DASHBOARD
// ─────────────────────────────────────────────────────────────
function initDashboard() {
  populateFilters();
  applyFilters();
}

// ─────────────────────────────────────────────────────────────
// FILTERS
// ─────────────────────────────────────────────────────────────
function populateFilters() {
  const uniq = key => [...new Set(allData.map(r => r[key]).filter(Boolean))].sort();
  fillSelect($('filter-status'),  uniq('status'),        'Todos los estados');
  fillSelect($('filter-city'),    uniq('receiver_city'), 'Todas las ciudades');
  fillSelect($('filter-courier'), uniq('courier_name'),  'Todos los mensajeros');

  const cps = uniq('zip_code');
  cpSelection = new Set(cps);
  const dd = $('cp-dropdown');
  dd.innerHTML = cps.map(cp =>
    `<label class="cp-option"><input type="checkbox" value="${esc(cp)}" checked> ${esc(cp)}</label>`
  ).join('');
  updateCpBtn();
  dd.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.checked ? cpSelection.add(cb.value) : cpSelection.delete(cb.value);
      updateCpBtn(); applyFilters();
    });
  });
}

function fillSelect(sel, opts, ph) {
  sel.innerHTML = `<option value="">${ph}</option>` +
    opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
}

function updateCpBtn() {
  const total = $('cp-dropdown').querySelectorAll('input').length;
  $('cp-filter-btn').textContent = cpSelection.size === total ? 'CP: Todos ▾' : `CP: ${cpSelection.size} ▾`;
}

$('cp-filter-btn').addEventListener('click', e => {
  e.stopPropagation(); $('cp-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', () => $('cp-dropdown').classList.add('hidden'));

['filter-status','filter-tag','filter-city','filter-courier'].forEach(id => {
  $(id).addEventListener('change', applyFilters);
});
$('search-input').addEventListener('input', applyFilters);

function applyFilters() {
  const status  = $('filter-status').value;
  const tag     = $('filter-tag').value;
  const city    = $('filter-city').value;
  const courier = $('filter-courier').value;
  const search  = $('search-input').value.toLowerCase().trim();

  filteredData = allData.filter(r => {
    if (status  && r.status        !== status)   return false;
    if (city    && r.receiver_city !== city)      return false;
    if (courier && r.courier_name  !== courier)   return false;
    if (r.zip_code && !cpSelection.has(r.zip_code)) return false;
    if (search  && !`${r.tracking_no} ${r.detail_address}`.toLowerCase().includes(search)) return false;
    if (tag === '__none__' && r.tag) return false;
    if (tag && tag !== '__none__' && r.tag !== tag) return false;
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

// ─────────────────────────────────────────────────────────────
// SORT
// ─────────────────────────────────────────────────────────────
function sortData() {
  filteredData.sort((a, b) => {
    let av = a[sortCol] ?? -Infinity, bv = b[sortCol] ?? -Infinity;
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
    sortData(); renderTable();
  });
});

// ─────────────────────────────────────────────────────────────
// KPIs
// ─────────────────────────────────────────────────────────────
function renderKPIs() {
  const d = filteredData;
  $('kpi-total')  .textContent = d.length;
  $('kpi-station').textContent = d.filter(r => r.actual_inbound_time).length;
  $('kpi-overdue').textContent = d.filter(r => r.dias_de_atraso > 0).length;
  $('kpi-cities') .textContent = new Set(d.map(r => r.receiver_city).filter(Boolean)).size;
}

// ─────────────────────────────────────────────────────────────
// CHART
// ─────────────────────────────────────────────────────────────
const PALETTE = ['#6C63FF','#43BDFF','#FF6584','#06D6A0','#FFD166','#EF476F','#118AB2','#FFB347','#A8DADC','#E63946','#457B9D','#F4A261','#2A9D8F','#E9C46A','#264653','#9B5DE5','#F15BB5','#FEE440','#00BBF9','#00F5D4'];

function getChartKey(r) {
  return chartMode === 'city' ? (r.receiver_city || 'Sin ciudad') : (r.courier_name || 'Sin asignar');
}

function baseFiltered() {
  const status  = $('filter-status').value;
  const city    = $('filter-city').value;
  const courier = $('filter-courier').value;
  const search  = $('search-input').value.toLowerCase().trim();
  const tag     = $('filter-tag').value;
  return allData.filter(r => {
    if (status  && r.status        !== status)   return false;
    if (city    && r.receiver_city !== city)      return false;
    if (courier && r.courier_name  !== courier)   return false;
    if (r.zip_code && !cpSelection.has(r.zip_code)) return false;
    if (search  && !`${r.tracking_no} ${r.detail_address}`.toLowerCase().includes(search)) return false;
    if (tag === '__none__' && r.tag) return false;
    if (tag && tag !== '__none__' && r.tag !== tag) return false;
    return true;
  });
}

function renderChart() {
  const base = baseFiltered();
  const counts = {};
  base.forEach(r => { const k = getChartKey(r); counts[k] = (counts[k]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  const labels = sorted.map(e => e[0]);
  const values = sorted.map(e => e[1]);
  const colors = labels.map((_,i) => PALETTE[i % PALETTE.length]);
  const bw     = labels.map(l => chartFilter?.value === l ? 3 : 1);
  const bc     = labels.map(l => chartFilter?.value === l ? '#fff' : 'transparent');

  if (cityChart) cityChart.destroy();
  cityChart = new Chart($('cityChart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data:values, backgroundColor:colors, borderColor:bc, borderWidth:bw }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ display:false },
        tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${ctx.parsed}` } }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const value = labels[elements[0].index];
        if (chartFilter?.mode === chartMode && chartFilter?.value === value) { clearChartFilter(); }
        else { chartFilter = { mode:chartMode, value }; showBadge(value); applyFilters(); selectAllVisible(); }
      }
    }
  });

  $('chart-title').textContent = chartMode === 'city' ? 'Paquetes por ciudad' : 'Paquetes por driver';

  $('city-legend').innerHTML = labels.map((l,i) =>
    `<div class="legend-item${chartFilter?.value===l?' active':''}" data-idx="${i}">
       <span class="legend-dot" style="background:${colors[i]}"></span>
       <span class="legend-label" title="${esc(l)}">${esc(l)}</span>
       <span class="legend-val">${values[i]}</span>
     </div>`
  ).join('');

  $('city-legend').querySelectorAll('.legend-item').forEach(item => {
    item.addEventListener('click', () => {
      const value = labels[parseInt(item.dataset.idx)];
      if (chartFilter?.mode === chartMode && chartFilter?.value === value) { clearChartFilter(); }
      else { chartFilter = { mode:chartMode, value }; showBadge(value); applyFilters(); selectAllVisible(); }
    });
  });
}

function clearChartFilter() { chartFilter = null; hideBadge(); applyFilters(); }
function showBadge(l) { $('chart-filter-badge').classList.add('visible'); $('chart-filter-label').textContent = `Filtrado: ${l}`; }
function hideBadge()  { $('chart-filter-badge').classList.remove('visible'); $('chart-filter-label').textContent = ''; }
$('chart-filter-badge').addEventListener('click', clearChartFilter);

$('toggle-city').addEventListener('click', () => {
  chartMode='city'; chartFilter=null; hideBadge();
  $('toggle-city').classList.add('active'); $('toggle-driver').classList.remove('active');
  applyFilters();
});
$('toggle-driver').addEventListener('click', () => {
  chartMode='driver'; chartFilter=null; hideBadge();
  $('toggle-driver').classList.add('active'); $('toggle-city').classList.remove('active');
  applyFilters();
});

// ─────────────────────────────────────────────────────────────
// STATUS LIST
// ─────────────────────────────────────────────────────────────
function renderStatusList() {
  const groups = {};
  filteredData.forEach(r => {
    const s = r.status || 'Sin estado';
    if (!groups[s]) groups[s] = { count:0, maxDays:0 };
    groups[s].count++;
    groups[s].maxDays = Math.max(groups[s].maxDays, r.dias_de_atraso||0);
  });
  const sorted = Object.entries(groups).sort((a,b) => b[1].maxDays - a[1].maxDays);
  const max = Math.max(...sorted.map(e => e[1].count), 1);
  const sc = s => { const r = STATUS_RULES.find(x=>x.re.test(s||'')); return r ? r.fg : '#6c63ff'; };

  $('status-list').innerHTML = sorted.map(([status, {count, maxDays}]) => {
    const pct   = Math.round((count/max)*100);
    const label = maxDays > 0 ? `${maxDays}d` : '';
    const cls   = maxDays > 3 ? 'bar-red' : maxDays > 1 ? 'bar-yellow' : 'bar-green';
    return `
      <div class="status-row">
        <div class="status-name" style="color:${sc(status)}">${esc(status)}</div>
        <div class="status-bar-wrap"><div class="status-bar ${cls}" style="width:${pct}%"></div></div>
        <div class="status-meta">
          <span class="status-count">${count}</span>
          ${label ? `<span class="status-days">${label}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────
// TABLE
// ─────────────────────────────────────────────────────────────
function renderTable() {
  selectedRows.clear();
  $('select-all').checked = false;
  updateBulkBar();
  $('row-count').textContent = `${filteredData.length} paquetes`;

  $('table-body').innerHTML = filteredData.map((r, i) => {
    const days    = r.dias_de_atraso ?? '—';
    const daysCls = r.dias_de_atraso > 3 ? 'days-red' : r.dias_de_atraso > 1 ? 'days-yellow' : '';
    const inbound = r.actual_inbound_time ? new Date(r.actual_inbound_time).toLocaleDateString('es-MX') : '—';
    const ss      = statusStyle(r.status);
    const tag     = tagBadge(r.tag);
    return `
      <tr data-idx="${i}">
        <td><input type="checkbox" class="row-check" data-idx="${i}"></td>
        <td class="days-cell ${daysCls}">${days}</td>
        <td><span class="status-chip" style="background:${ss.bg};color:${ss.fg}">${esc(r.status)}</span></td>
        <td>${tag}</td>
        <td>${esc(r.courier_name)}</td>
        <td>${esc(r.receiver_city)}</td>
        <td>${esc(r.zip_code)}</td>
        <td class="tracking-cell">${esc(r.tracking_no)}</td>
        <td class="addr-cell" title="${esc(r.detail_address)}">${esc(r.detail_address)}</td>
        <td>${esc(r.phone)}</td>
        <td>${inbound}</td>
        <td><div class="row-actions">
          <button class="btn-copy-row"    data-idx="${i}" title="Copiar tracking">⎘</button>
          <button class="btn-comment-row" data-idx="${i}" title="Ver / comentar">💬</button>
        </div></td>
      </tr>`;
  }).join('');

  $('table-body').querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const i = parseInt(cb.dataset.idx);
      cb.checked ? selectedRows.add(i) : selectedRows.delete(i);
      $('table-body').querySelector(`tr[data-idx="${i}"]`).classList.toggle('selected-row', cb.checked);
      updateBulkBar(); syncSelectAll();
    });
  });

  $('table-body').querySelectorAll('.btn-copy-row').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(filteredData[parseInt(btn.dataset.idx)].tracking_no || '');
      btn.textContent = '✓'; setTimeout(() => btn.textContent = '⎘', 1200);
    });
  });

  $('table-body').querySelectorAll('.btn-comment-row').forEach(btn => {
    btn.addEventListener('click', () => openDrawer(filteredData[parseInt(btn.dataset.idx)].tracking_no));
  });
}

// ─────────────────────────────────────────────────────────────
// BULK ACTIONS
// ─────────────────────────────────────────────────────────────
function selectAllVisible() {
  $('table-body').querySelectorAll('.row-check').forEach((cb, i) => {
    cb.checked = true; selectedRows.add(i);
    $('table-body').querySelector(`tr[data-idx="${i}"]`)?.classList.add('selected-row');
  });
  $('select-all').checked = true;
  updateBulkBar();
}
function syncSelectAll() {
  const total = $('table-body').querySelectorAll('.row-check').length;
  $('select-all').checked = selectedRows.size === total && total > 0;
}
$('select-all').addEventListener('change', function() {
  $('table-body').querySelectorAll('.row-check').forEach((cb, i) => {
    cb.checked = this.checked;
    this.checked ? selectedRows.add(i) : selectedRows.delete(i);
    $('table-body').querySelector(`tr[data-idx="${i}"]`)?.classList.toggle('selected-row', this.checked);
  });
  updateBulkBar();
});

function updateBulkBar() {
  const n = selectedRows.size;
  $('bulk-bar').classList.toggle('hidden', n === 0);
  $('bulk-count').textContent = `${n} seleccionado${n!==1?'s':''}`;
}

// Copy all fields (tab-separated)
$('bulk-copy-btn').addEventListener('click', () => {
  const lines = [...selectedRows].sort((a,b)=>a-b).map(i => {
    const r = filteredData[i];
    return [r.tracking_no, r.status, r.tag||'', r.courier_name, r.receiver_city, r.zip_code, r.phone,
      r.actual_inbound_time ? new Date(r.actual_inbound_time).toLocaleDateString('es-MX') : ''].join('\t');
  });
  navigator.clipboard.writeText(lines.join('\n'));
  flash($('bulk-copy-btn'), '✓ Copiado', '⎘ Copiar todo');
});

// Copy tracking numbers only (one per line)
$('bulk-trackings-btn').addEventListener('click', () => {
  const lines = [...selectedRows].sort((a,b)=>a-b).map(i => filteredData[i].tracking_no).filter(Boolean);
  navigator.clipboard.writeText(lines.join('\n'));
  flash($('bulk-trackings-btn'), '✓ Copiado', '⎘ Solo trackings');
});

$('bulk-clear-btn').addEventListener('click', () => {
  selectedRows.clear();
  $('table-body').querySelectorAll('.row-check').forEach(cb => cb.checked = false);
  $('table-body').querySelectorAll('tr.selected-row').forEach(tr => tr.classList.remove('selected-row'));
  $('select-all').checked = false;
  updateBulkBar();
});

$('refresh-btn').addEventListener('click', loadData);

// ─────────────────────────────────────────────────────────────
// DRAWER — package detail + comments
// ─────────────────────────────────────────────────────────────
function openDrawer(trackingNo) {
  drawerTracking = trackingNo;
  const row = allData.find(r => r.tracking_no === trackingNo);
  $('drawer-tracking').textContent = trackingNo;

  // Info grid
  const fields = [
    ['Status',   row?.status || '—'],
    ['Tag',      row?.tag    || 'Sin tag'],
    ['Ciudad',   row?.receiver_city || '—'],
    ['CP',       row?.zip_code || '—'],
    ['Mensajero',row?.courier_name || '—'],
    ['Días',     row?.dias_de_atraso ?? '—'],
    ['Ingreso',  row?.actual_inbound_time ? new Date(row.actual_inbound_time).toLocaleDateString('es-MX') : '—'],
    ['Teléfono', row?.phone || '—'],
  ];
  $('drawer-info').innerHTML = fields.map(([l,v]) =>
    `<div class="drawer-info-item">
       <div class="drawer-info-label">${l}</div>
       <div class="drawer-info-val">${esc(String(v))}</div>
     </div>`
  ).join('');

  // Tag buttons
  const currentTag = row?.tag || null;
  $('drawer-tag-group').querySelectorAll('.tag-opt-btn[data-tag]').forEach(btn => {
    const t = btn.dataset.tag;
    btn.className = 'tag-opt-btn' + (t === '' ? ' clear-tag' : '');
    if (t && t === currentTag) {
      const s = TAG_STYLES[t];
      if (s) btn.classList.add(s.cls);
    }
    btn.onclick = () => setTag(trackingNo, t || null);
  });

  loadComments(trackingNo);
  $('drawer').classList.add('open');
  $('drawer-overlay').classList.add('visible');
}

function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer-overlay').classList.remove('visible');
  drawerTracking = null;
}

$('drawer-close').addEventListener('click', closeDrawer);
$('drawer-overlay').addEventListener('click', closeDrawer);

// Set tag from drawer
async function setTag(trackingNo, tag) {
  if (!tag) {
    await db.from('package_tags').delete().eq('tracking_no', trackingNo);
    tagMap[trackingNo] = null;
  } else {
    await db.from('package_tags').upsert({ tracking_no: trackingNo, tag, auto_tagged: false, updated_at: new Date().toISOString() }, { onConflict: 'tracking_no' });
    tagMap[trackingNo] = tag;
  }
  // Update allData and filteredData in place
  const rowA = allData.find(r => r.tracking_no === trackingNo);
  if (rowA) rowA.tag = tag;
  const rowF = filteredData.find(r => r.tracking_no === trackingNo);
  if (rowF) rowF.tag = tag;
  // Re-open with updated info
  openDrawer(trackingNo);
  // Re-render table (to update badge in row)
  renderTable();
}

// ── Comments ──────────────────────────────────────────────────
async function loadComments(trackingNo) {
  $('drawer-comments').innerHTML = '<p class="comment-empty">Cargando comentarios…</p>';
  const { data, error } = await db.from('package_comments')
    .select('*').eq('tracking_no', trackingNo).order('created_at', { ascending: true });
  if (error || !data?.length) {
    $('drawer-comments').innerHTML = '<p class="comment-empty">Sin comentarios aún.</p>';
    return;
  }
  $('drawer-comments').innerHTML = data.map(c => `
    <div class="comment-item">
      <div class="comment-meta">
        <span class="comment-author">${esc(c.author)}</span>
        <span class="comment-time">${new Date(c.created_at).toLocaleString('es-MX')}</span>
      </div>
      <div class="comment-body">${esc(c.body)}</div>
    </div>`
  ).join('');
}

$('comment-submit').addEventListener('click', async () => {
  const author = $('comment-author').value.trim() || 'Anónimo';
  const body   = $('comment-body').value.trim();
  if (!body || !drawerTracking) return;

  $('comment-submit').disabled = true;
  const { error } = await db.from('package_comments').insert({ tracking_no: drawerTracking, author, body });
  $('comment-submit').disabled = false;

  if (!error) {
    $('comment-body').value = '';
    loadComments(drawerTracking);
  }
});

// ─────────────────────────────────────────────────────────────
// OPERATIONS TAB — Bulk Tagger
// ─────────────────────────────────────────────────────────────
const tagSelBtns = document.querySelectorAll('.tag-sel-btn');
tagSelBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tagSelBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    bulkTagSelected = btn.dataset.tag;
    updateBulkTagBtn();
  });
});

$('bulk-tag-input').addEventListener('input', updateBulkTagBtn);

function updateBulkTagBtn() {
  const lines = $('bulk-tag-input').value.split('\n').map(s=>s.trim()).filter(Boolean);
  $('bulk-tag-count').textContent = lines.length ? `${lines.length} tracking${lines.length!==1?'s':''}` : '';
  $('bulk-tag-submit').disabled = !(lines.length && bulkTagSelected);
}

$('bulk-tag-submit').addEventListener('click', async () => {
  const lines = $('bulk-tag-input').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if (!lines.length || !bulkTagSelected) return;

  $('bulk-tag-submit').disabled = true;
  feedback('bulk-tag-feedback', '', '');

  const rows = lines.map(t => ({ tracking_no: t, tag: bulkTagSelected, auto_tagged: false, updated_at: new Date().toISOString() }));

  // Batch upsert
  let ok = true;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('package_tags').upsert(rows.slice(i, i+500), { onConflict: 'tracking_no' });
    if (error) { ok = false; feedback('bulk-tag-feedback', `Error: ${error.message}`, 'err'); break; }
  }

  if (ok) {
    // Update in-memory tagMap + allData
    rows.forEach(r => {
      tagMap[r.tracking_no] = r.tag;
      const a = allData.find(x => x.tracking_no === r.tracking_no);
      if (a) a.tag = r.tag;
    });
    applyFilters();
    feedback('bulk-tag-feedback', `✓ ${rows.length} paquete${rows.length!==1?'s':''} etiquetado${rows.length!==1?'s':''}`, 'ok');
    $('bulk-tag-input').value = '';
    tagSelBtns.forEach(b => b.classList.remove('selected'));
    bulkTagSelected = null;
    updateBulkTagBtn();
  }
  $('bulk-tag-submit').disabled = false;
});

// ─────────────────────────────────────────────────────────────
// OPERATIONS TAB — Did Not Arrive
// ─────────────────────────────────────────────────────────────
// Default date = today
$('dna-date').value = today();
$('ret-date').value = today();

$('dna-submit').addEventListener('click', async () => {
  const tracking = $('dna-tracking').value.trim();
  if (!tracking) { feedback('dna-feedback', 'Ingresa el tracking', 'err'); return; }

  const { error } = await db.from('did_not_arrive').insert({
    tracking_no:   tracking,
    assigned_date: $('dna-date').value || today(),
    notes:         $('dna-notes').value.trim() || null,
    reported:      $('dna-reported').checked,
  });

  if (error) { feedback('dna-feedback', error.message, 'err'); return; }
  feedback('dna-feedback', `✓ Agregado: ${tracking}`, 'ok');
  $('dna-tracking').value = ''; $('dna-notes').value = ''; $('dna-reported').checked = false;
  await loadOpsData();
});

function renderDNATable() {
  if (!dnaData.length) { $('dna-body').innerHTML = `<tr><td colspan="5" class="ops-empty">Sin registros</td></tr>`; return; }
  $('dna-body').innerHTML = dnaData.map(r => `
    <tr>
      <td style="font-family:var(--mono);font-size:10px;color:var(--accent2)">${esc(r.tracking_no)}</td>
      <td style="font-size:11px">${r.assigned_date || '—'}</td>
      <td>${r.arrived_later
        ? `<span class="arrived-badge">LLEGÓ</span>`
        : r.reported ? `<span class="reported-badge">REPORTADO</span>` : '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${esc(r.notes)}</td>
      <td><button class="btn-danger" data-table="dna" data-id="${r.id}">✕</button></td>
    </tr>`
  ).join('');
  bindDeleteBtns();
}

// ─────────────────────────────────────────────────────────────
// OPERATIONS TAB — Return Packages
// ─────────────────────────────────────────────────────────────
$('ret-submit').addEventListener('click', async () => {
  const tracking = $('ret-tracking').value.trim();
  if (!tracking) { feedback('ret-feedback', 'Ingresa el tracking', 'err'); return; }

  const { error } = await db.from('return_packages').insert({
    tracking_no: tracking,
    sent_by:     $('ret-sent-by').value.trim() || null,
    sent_date:   $('ret-date').value || today(),
    notes:       $('ret-notes').value.trim() || null,
  });

  if (error) { feedback('ret-feedback', error.message, 'err'); return; }
  feedback('ret-feedback', `✓ Agregado: ${tracking}`, 'ok');
  $('ret-tracking').value = ''; $('ret-sent-by').value = ''; $('ret-notes').value = '';
  await loadOpsData();
});

function renderRetTable() {
  if (!retData.length) { $('ret-body').innerHTML = `<tr><td colspan="5" class="ops-empty">Sin registros</td></tr>`; return; }
  $('ret-body').innerHTML = retData.map(r => `
    <tr>
      <td style="font-family:var(--mono);font-size:10px;color:var(--accent2)">${esc(r.tracking_no)}</td>
      <td style="font-size:11px">${esc(r.sent_by)}</td>
      <td style="font-size:11px">${r.sent_date || '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${esc(r.notes)}</td>
      <td><button class="btn-danger" data-table="ret" data-id="${r.id}">✕</button></td>
    </tr>`
  ).join('');
  bindDeleteBtns();
}

function bindDeleteBtns() {
  document.querySelectorAll('.btn-danger[data-table]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id    = parseInt(btn.dataset.id);
      const table = btn.dataset.table === 'dna' ? 'did_not_arrive' : 'return_packages';
      const { error } = await db.from(table).delete().eq('id', id);
      if (!error) loadOpsData();
    });
  });
}

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '—';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function flash(btn, tempText, origText) {
  btn.textContent = tempText;
  setTimeout(() => btn.textContent = origText, 1600);
}

function feedback(id, msg, type) {
  const el = $(id);
  el.textContent = msg;
  el.className = 'ops-feedback' + (type ? ` ${type}` : '');
  if (msg) setTimeout(() => { el.className = 'ops-feedback'; el.textContent = ''; }, 4000);
}

// ─────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────
loadData();
