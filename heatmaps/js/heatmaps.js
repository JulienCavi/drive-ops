// ==================== ÉTAT GLOBAL ====================
const state = {
  catalogue: null,
  plans: new Map(),
  meubleCellsByZone: new Map(),
  datasets: new Map(),
  currentZoneId: null,
  currentScale: 1,
  selectedTypes: new Set(['mono']),
  dateFrom: null,
  dateTo: null,
};

// ==================== UTILITAIRES ====================
const HEATMAP_COLORS = [
  { pct: 0.0, color: { h: 260, s: 60, l: 45 } },
  { pct: 0.2, color: { h: 220, s: 85, l: 50 } },
  { pct: 0.4, color: { h: 180, s: 80, l: 50 } },
  { pct: 0.6, color: { h: 140, s: 70, l: 50 } },
  { pct: 0.8, color: { h: 60, s: 90, l: 55 } },
  { pct: 1.0, color: { h: 10, s: 85, l: 60 } },
];

function interpolateColor(value, min, max) {
  if (max === min) return 'hsl(220, 85%, 50%)';
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  
  let lower = HEATMAP_COLORS[0];
  let upper = HEATMAP_COLORS[HEATMAP_COLORS.length - 1];
  
  for (let i = 0; i < HEATMAP_COLORS.length - 1; i++) {
    if (ratio >= HEATMAP_COLORS[i].pct && ratio <= HEATMAP_COLORS[i + 1].pct) {
      lower = HEATMAP_COLORS[i];
      upper = HEATMAP_COLORS[i + 1];
      break;
    }
  }
  
  const range = upper.pct - lower.pct;
  const rangePct = range === 0 ? 0 : (ratio - lower.pct) / range;
  
  const h = Math.round(lower.color.h + (upper.color.h - lower.color.h) * rangePct);
  const s = Math.round(lower.color.s + (upper.color.s - lower.color.s) * rangePct);
  const l = Math.round(lower.color.l + (upper.color.l - lower.color.l) * rangePct);
  
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(+y, +m - 1, +d);
}

function formatDate(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ==================== CHARGEMENT DONNÉES ====================
async function loadCatalogue() {
  try {
    const res = await fetch('catalogue.json');
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    state.catalogue = await res.json();
    
    for (const zone of state.catalogue.zones) {
      const planRes = await fetch(zone.plan);
      if (!planRes.ok) throw new Error(`Plan ${zone.id} introuvable`);
      const layout = await planRes.json();
      state.plans.set(zone.id, layout);
      
      const cellMap = new Map();
      for (const [meubleId, pos] of Object.entries(layout)) {
        const key = `${pos.row},${pos.col}`;
        cellMap.set(key, meubleId);
      }
      state.meubleCellsByZone.set(zone.id, cellMap);
    }
    
    for (const ds of state.catalogue.datasets) {
      const csvRes = await fetch(ds.file);
      if (!csvRes.ok) throw new Error(`Dataset ${ds.file} introuvable`);
      const text = await csvRes.text();
      const lines = text.trim().split(/\r?\n/).slice(1);
      const records = lines.map(line => {
        const [loc, count] = line.split(',');
        return { location: loc?.trim(), count: parseInt(count, 10) || 0 };
      });
      
      const key = `${ds.zone}|${ds.type}|${ds.date}`;
      state.datasets.set(key, { ...ds, records });
    }
    
    updateStatus('Données chargées avec succès');
  } catch (err) {
    console.error(err);
    updateStatus(`Erreur : ${err.message}`);
  }
}

// ==================== UI : ZONE & TYPES ====================
function initZoneSelector() {
  const sel = document.getElementById('zone-select');
  if (!state.catalogue?.zones) return;
  
  sel.innerHTML = state.catalogue.zones
    .map(z => `<option value="${z.id}">${z.label}</option>`)
    .join('');
  
  state.currentZoneId = state.catalogue.zones[0]?.id;
  sel.value = state.currentZoneId;
  
  sel.addEventListener('change', () => {
    state.currentZoneId = sel.value;
    render();
  });
}

function initTypeFilters() {
  const container = document.getElementById('type-filters');
  const types = [...new Set(state.catalogue.datasets.map(ds => ds.type))];
  
  container.innerHTML = types.map(t => `
    <label class="type-chip ${state.selectedTypes.has(t) ? 'active' : ''}">
      <input type="checkbox" value="${t}" ${state.selectedTypes.has(t) ? 'checked' : ''}>
      ${t}
    </label>
  `).join('');
  
  container.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') {
      const val = e.target.value;
      if (e.target.checked) {
        state.selectedTypes.add(val);
      } else {
        state.selectedTypes.delete(val);
      }
      e.target.closest('.type-chip').classList.toggle('active', e.target.checked);
      render();
    }
  });
}

function initDateFilters() {
  const fromInput = document.getElementById('date-from');
  const toInput = document.getElementById('date-to');
  const maxBtn = document.getElementById('max-period-btn');
  
  const allDates = state.catalogue.datasets
    .map(ds => parseDate(ds.date))
    .filter(Boolean)
    .sort((a, b) => a - b);
  
  if (allDates.length > 0) {
    state.dateFrom = allDates[0];
    state.dateTo = allDates[allDates.length - 1];
    fromInput.value = formatDate(state.dateFrom);
    toInput.value = formatDate(state.dateTo);
  }
  
  fromInput.addEventListener('change', () => {
    state.dateFrom = parseDate(fromInput.value);
    render();
  });
  
  toInput.addEventListener('change', () => {
    state.dateTo = parseDate(toInput.value);
    render();
  });
  
  maxBtn.addEventListener('click', () => {
    if (allDates.length > 0) {
      state.dateFrom = allDates[0];
      state.dateTo = allDates[allDates.length - 1];
      fromInput.value = formatDate(state.dateFrom);
      toInput.value = formatDate(state.dateTo);
      render();
    }
  });
}

// ==================== ZOOM ====================
function initZoom() {
  const slider = document.getElementById('zoom-slider');
  const valueDisplay = document.getElementById('zoom-value');
  const wrapper = document.getElementById('plan-wrapper');
  
  slider.addEventListener('input', () => {
    state.currentScale = parseFloat(slider.value);
    valueDisplay.textContent = `${Math.round(state.currentScale * 100)}%`;
    wrapper.style.transform = `scale(${state.currentScale})`;
  });
  
  valueDisplay.textContent = `${Math.round(state.currentScale * 100)}%`;
}

// ==================== AGRÉGATION DONNÉES ====================
function aggregateData() {
  const zoneId = state.currentZoneId;
  if (!zoneId) return { byMeuble: new Map(), total: 0, min: 0, max: 0, median: 0 };
  
  const byMeuble = new Map();
  const layout = state.plans.get(zoneId);
  if (!layout) return { byMeuble, total: 0, min: 0, max: 0, median: 0 };
  
  for (const meubleId of Object.keys(layout)) {
    byMeuble.set(meubleId, 0);
  }
  
  for (const ds of state.catalogue.datasets) {
    if (ds.zone !== zoneId) continue;
    if (!state.selectedTypes.has(ds.type)) continue;
    
    const dsDate = parseDate(ds.date);
    if (state.dateFrom && dsDate < state.dateFrom) continue;
    if (state.dateTo && dsDate > state.dateTo) continue;
    
    const key = `${ds.zone}|${ds.type}|${ds.date}`;
    const data = state.datasets.get(key);
    if (!data?.records) continue;
    
    for (const rec of data.records) {
      const parts = rec.location.match(/^([A-Z]{2})(\d{2})([A-Z])(\d)$/);
      if (!parts) continue;
      const [, prefix, aisle, bay, level] = parts;
      const meubleId = `${prefix}${aisle}`;
      
      if (byMeuble.has(meubleId)) {
        byMeuble.set(meubleId, byMeuble.get(meubleId) + rec.count);
      }
    }
  }
  
  const values = [...byMeuble.values()].filter(v => v > 0);
  const total = values.reduce((sum, v) => sum + v, 0);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length > 0
    ? sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
    : 0;
  
  return { byMeuble, total, min, max, median };
}

// ==================== RENDU ====================
function render() {
  const { byMeuble, total, min, max, median } = aggregateData();
  
  document.getElementById('stat-total').textContent = total.toLocaleString();
  document.getElementById('stat-min').textContent = min.toLocaleString();
  document.getElementById('stat-max').textContent = max.toLocaleString();
  document.getElementById('stat-median').textContent = median.toFixed(1);
  
  renderPlan(byMeuble, min, max);
}

function renderPlan(byMeuble, min, max) {
  const zoneId = state.currentZoneId;
  const layout = state.plans.get(zoneId);
  const cellMap = state.meubleCellsByZone.get(zoneId);
  if (!layout || !cellMap) return;
  
  const positions = Object.values(layout);
  const maxRow = Math.max(...positions.map(p => p.row));
  const maxCol = Math.max(...positions.map(p => p.col));
  
  const table = document.getElementById('plan-table');
  let html = '';
  
  for (let r = 0; r <= maxRow; r++) {
    html += '<tr>';
    for (let c = 0; c <= maxCol; c++) {
      const key = `${r},${c}`;
      const meubleId = cellMap.get(key);
      
      if (!meubleId) {
        html += '<td class="empty-cell"></td>';
        continue;
      }
      
      const count = byMeuble.get(meubleId) || 0;
      const color = count > 0 ? interpolateColor(count, min, max) : 'hsl(220, 20%, 30%)';
      const textColor = count > 0 ? '#ffffff' : '#6b7280';
      
      html += `
        <td class="meuble-cell" 
            data-meuble="${meubleId}" 
            data-count="${count}"
            style="background: ${color}; color: ${textColor};">
          <div class="cell-content">
            <div class="cell-id">${meubleId}</div>
            ${count > 0 ? `<div class="cell-count">${count}</div>` : ''}
          </div>
        </td>
      `;
    }
    html += '</tr>';
  }
  
  table.innerHTML = html;
  attachTooltips(byMeuble, max);
}

// ==================== TOOLTIPS ====================
function attachTooltips(byMeuble, max) {
  const tooltip = document.getElementById('tooltip');
  const cells = document.querySelectorAll('.meuble-cell');
  
  cells.forEach(cell => {
    cell.addEventListener('mouseenter', (e) => {
      const meubleId = cell.dataset.meuble;
      const count = parseInt(cell.dataset.count, 10);
      const pct = max > 0 ? ((count / max) * 100).toFixed(1) : 0;
      
      tooltip.innerHTML = `
        <div class="tooltip-title">${meubleId}</div>
        <div class="tooltip-content">
          <div>Missions : ${count}</div>
          <div>Intensité : ${pct}%</div>
        </div>
      `;
      
      tooltip.classList.add('visible');
    });
    
    cell.addEventListener('mousemove', (e) => {
      tooltip.style.left = `${e.clientX + 12}px`;
      tooltip.style.top = `${e.clientY + 12}px`;
    });
    
    cell.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
  });
}

// ==================== STATUS ====================
function updateStatus(msg) {
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = msg;
}

// ==================== INIT ====================
async function init() {
  updateStatus('Chargement des données...');
  await loadCatalogue();
  initZoneSelector();
  initTypeFilters();
  initDateFilters();
  initZoom();
  render();
}

document.addEventListener('DOMContentLoaded', init);
