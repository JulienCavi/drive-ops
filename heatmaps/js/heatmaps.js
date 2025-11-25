// ==================== ÉTAT TACTIQUE ====================
const state = {
  catalogue: null,
  plans: new Map(),
  datasets: new Map(),
  currentZoneId: null,
  zoomLevel: 0.5,
  minDate: null,
  maxDate: null,
  filters: {
    types: new Set(['mono']), 
    dateFrom: null,
    dateTo: null
  },
  panX: 0,
  panY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0
};

const els = {
  zoneSelect: document.getElementById('zone-select'),
  typeFilters: document.getElementById('type-filters'),
  dateFrom: document.getElementById('date-from'),
  dateTo: document.getElementById('date-to'),
  btnFullRange: document.getElementById('btn-full-range'),
  planWrapper: document.getElementById('plan-wrapper'),
  planTable: document.getElementById('plan-table'),
  viewport: document.getElementById('plan-viewport'),
  zoomVal: document.getElementById('zoom-val'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  statPoints: document.getElementById('total-points'),
  statMax: document.getElementById('max-intensity'),
  loader: document.getElementById('loader'),
  tooltip: document.getElementById('tooltip')
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const resp = await fetch('data/catalogue.json'); // RACINE
    state.catalogue = await resp.json();

    analyzeDates();
    initControls();
    initPanZoom();

    if (state.catalogue.zones.length > 0) {
      await loadZone(state.catalogue.zones[0].id);
    }
    setZoom(state.zoomLevel);
    els.loader.classList.add('hidden');
  } catch (err) {
    console.error(err);
    els.loader.innerHTML = `<span style="color:red">ERREUR: ${err.message}</span>`;
  }
}

function analyzeDates() {
  const dates = state.catalogue.datasets.map(ds => ds.date).sort();
  if (dates.length === 0) return;
  state.minDate = dates[0];
  state.maxDate = dates[dates.length - 1];
}

function initControls() {
  els.zoneSelect.innerHTML = state.catalogue.zones
    .map(z => `<option value="${z.id}">${z.label}</option>`)
    .join('');
  els.zoneSelect.addEventListener('change', e => loadZone(e.target.value));

  const types = ['mono', 'multi'];
  els.typeFilters.innerHTML = types.map(t => 
    `<button class="toggle-btn ${state.filters.types.has(t) ? 'active' : ''}" data-type="${t}">
      ${t.toUpperCase()}
    </button>`
  ).join('');

  els.typeFilters.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      state.filters.types.has(type) ? state.filters.types.delete(type) : state.filters.types.add(type);
      btn.classList.toggle('active');
      updateVisualization();
    });
  });

  els.dateFrom.addEventListener('change', e => {
    state.filters.dateFrom = e.target.value;
    updateVisualization();
  });
  els.dateTo.addEventListener('change', e => {
    state.filters.dateTo = e.target.value;
    updateVisualization();
  });

  els.btnFullRange.addEventListener('click', () => {
    if (!state.minDate) return;
    state.filters.dateFrom = state.minDate;
    state.filters.dateTo = state.maxDate;
    els.dateFrom.value = state.minDate;
    els.dateTo.value = state.maxDate;
    updateVisualization();
  });

  els.zoomIn.addEventListener('click', () => setZoom(state.zoomLevel + 0.2));
  els.zoomOut.addEventListener('click', () => setZoom(state.zoomLevel - 0.2));
}

function initPanZoom() {
  els.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY * -0.002;
    setZoom(state.zoomLevel + delta);
  }, { passive: false });

  els.viewport.addEventListener('mousedown', (e) => {
    state.isDragging = true;
    state.dragStartX = e.clientX - state.panX;
    state.dragStartY = e.clientY - state.panY;
    els.viewport.classList.add('dragging');
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;
    state.panX = e.clientX - state.dragStartX;
    state.panY = e.clientY - state.dragStartY;
    updateTransform();
  });

  document.addEventListener('mouseup', () => {
    state.isDragging = false;
    els.viewport.classList.remove('dragging');
  });
}

function updateTransform() {
  els.planWrapper.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoomLevel})`;
}

async function loadZone(zoneId) {
  state.currentZoneId = zoneId;
  if (!state.plans.has(zoneId)) {
    const zoneConfig = state.catalogue.zones.find(z => z.id === zoneId);
    const res = await fetch(zoneConfig.plan); // RACINE (ex: mezza.json)
    state.plans.set(zoneId, await res.json());
  }
  renderGrid(state.plans.get(zoneId));
  updateVisualization();
  setZoom(state.zoomLevel);
}

function renderGrid(planData) {
  els.planTable.innerHTML = '';
  
  let maxRow = 0;
  let maxCol = 0;
  
  const meubles = Object.entries(planData);
  meubles.forEach(([id, pos]) => {
    if (pos.row > maxRow) maxRow = pos.row;
    if (pos.col > maxCol) maxCol = pos.col;
  });

  for (let r = 0; r <= maxRow; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c <= maxCol; c++) {
      const td = document.createElement('td');
      const meuble = meubles.find(([id, pos]) => pos.row === r && pos.col === c);

      if (meuble) {
        const [id] = meuble;
        td.dataset.id = id;
        td.classList.add('meuble-cell');
        td.innerHTML = `<div class="cell-content"><span class="cell-label">${id}</span></div>`;
        
        td.addEventListener('mouseenter', e => showTooltip(e, id));
        td.addEventListener('mouseleave', hideTooltip);
      } else {
        td.classList.add('empty-cell');
      }
      tr.appendChild(td);
    }
    els.planTable.appendChild(tr);
  }
}

async function updateVisualization() {
  const { dateFrom, dateTo, types } = state.filters;
  
  if (types.size === 0) {
    clearMap();
    return;
  }

  const heatMap = new Map();
  let maxVal = 0, totalPoints = 0;

  for (const ds of state.catalogue.datasets) {
    if (ds.zone !== state.currentZoneId || !types.has(ds.type)) continue;
    if (dateFrom && ds.date < dateFrom) continue;
    if (dateTo && ds.date > dateTo) continue;

    if (!state.datasets.has(ds.file)) {
      const res = await fetch(ds.file); // RACINE (ex: mezza_mono_20251101.csv)
      state.datasets.set(ds.file, parseCSV(await res.text()));
    }
    
    state.datasets.get(ds.file).forEach(row => {
      const meubleId = row.loc.substring(0, 4);
      const qty = parseInt(row.qty) || 0;
      heatMap.set(meubleId, (heatMap.get(meubleId) || 0) + qty);
      totalPoints += qty;
    });
  }

  heatMap.forEach(qty => maxVal = Math.max(maxVal, qty));

  els.planTable.querySelectorAll('td[data-id]').forEach(td => {
    const id = td.dataset.id;
    const val = heatMap.get(id) || 0;
    if (val > 0 && maxVal > 0) {
      const intensity = val / maxVal;
      td.style.backgroundColor = getHeatColor(intensity);
      td.style.color = intensity > 0.6 ? '#000' : 'rgba(255,255,255,0.9)';
      td.dataset.val = val;
    } else {
      td.style.backgroundColor = 'rgba(255,255,255,0.03)';
      td.style.color = 'rgba(255,255,255,0.3)';
      td.dataset.val = 0;
    }
  });

  els.statPoints.textContent = totalPoints.toLocaleString();
  els.statMax.textContent = maxVal.toLocaleString();
}

function clearMap() {
  els.planTable.querySelectorAll('td[data-id]').forEach(td => {
    td.style.backgroundColor = 'rgba(255,255,255,0.03)';
    td.style.color = 'rgba(255,255,255,0.3)';
    td.dataset.val = 0;
  });
  els.statPoints.textContent = '0';
  els.statMax.textContent = '0';
}

function parseCSV(text) {
  return text.split('\n').slice(1).map(line => {
    const [loc, qty] = line.split(',');
    return loc ? { loc: loc.trim(), qty: qty ? qty.trim() : 0 } : null;
  }).filter(x => x);
}

function getHeatColor(intensity) {
  const h = 220 - (intensity * 40);
  const s = 60 + (intensity * 40);
  const l = 15 + (intensity * 80);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function setZoom(lvl) {
  state.zoomLevel = Math.max(0.1, Math.min(4, lvl));
  updateTransform();
  els.zoomVal.textContent = Math.round(state.zoomLevel * 100) + '%';
  els.planTable.classList.toggle('show-labels', state.zoomLevel > 0.5);
}

function showTooltip(e, id) {
  const val = e.target.dataset.val || 0;
  els.tooltip.innerHTML = `<span class="tooltip-header">${id}</span>Picks: <strong>${val}</strong>`;
  els.tooltip.classList.add('visible');
  const rect = e.target.getBoundingClientRect();
  els.tooltip.style.top = (rect.top - 45) + 'px';
  els.tooltip.style.left = (rect.left + 20) + 'px';
}

function hideTooltip() {
  els.tooltip.classList.remove('visible');
}
