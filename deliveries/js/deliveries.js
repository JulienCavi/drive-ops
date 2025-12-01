// ==================== ÉTAT GLOBAL ====================
const state = {
  catalogue: null,
  datasets: new Map(), 
  slots: [], 
  
  params: {
    mode: 'single', // 'single', 'compare', 'weekday'
    dateA: null,
    dateB: null,
    weekday: '1', // 1 = Lundi
    metric: 'total',
    showRef: false
  }
};

// ==================== DOM ELEMENTS ====================
const els = {
  modeSelect: document.getElementById('mode-select'),
  dateASelect: document.getElementById('date-a-select'),
  dateBSelect: document.getElementById('date-b-select'),
  weekdaySelect: document.getElementById('weekday-select'),
  metricSelect: document.getElementById('metric-select'),
  showRefCheck: document.getElementById('show-weekday-ref'),
  
  chartStage: document.getElementById('chart'),
  xAxis: document.getElementById('x-axis'),
  statsContent: document.getElementById('stats-content'),
  loader: document.getElementById('loader'),
  
  // Groupes
  grpDateA: document.getElementById('group-date-a'),
  grpDateB: document.getElementById('group-date-b'),
  grpWeekday: document.getElementById('group-weekday'),
  lblDateA: document.getElementById('label-date-a'),
  legendA: document.getElementById('legend-a'),
  legendB: document.getElementById('legend-b'),
  refWrapper: document.getElementById('ref-wrapper')
};

// ==================== INIT ====================
document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    // Attention au chemin data/
    const resp = await fetch('data/catalogue_deliveries.json');
    state.catalogue = await resp.json();

    initControls();

    // Premier Rendu (Dernière date)
    if (state.catalogue.datasets.length > 0) {
      const last = state.catalogue.datasets[state.catalogue.datasets.length - 1];
      state.params.dateA = last.date;
      els.dateASelect.value = last.date;
      await updateVisualization();
    }

    els.loader.classList.add('hidden');
  } catch (err) {
    console.error(err);
    els.loader.innerHTML = `<span style="color:red">ERREUR: ${err.message}</span>`;
  }
}

function initControls() {
  const opts = state.catalogue.datasets.map(ds => 
    `<option value="${ds.date}">${ds.label}</option>`
  ).join('');
  els.dateASelect.innerHTML = opts;
  els.dateBSelect.innerHTML = opts;

  els.modeSelect.addEventListener('change', (e) => {
    state.params.mode = e.target.value;
    updateUIState();
    updateVisualization();
  });

  els.dateASelect.addEventListener('change', (e) => { state.params.dateA = e.target.value; updateVisualization(); });
  els.dateBSelect.addEventListener('change', (e) => { state.params.dateB = e.target.value; updateVisualization(); });
  els.weekdaySelect.addEventListener('change', (e) => { state.params.weekday = e.target.value; updateVisualization(); });
  els.metricSelect.addEventListener('change', (e) => { state.params.metric = e.target.value; updateVisualization(); });
  els.showRefCheck.addEventListener('change', (e) => { state.params.showRef = e.target.checked; updateVisualization(); });

  updateUIState();
}

function updateUIState() {
  const m = state.params.mode;
  
  els.grpDateA.classList.add('hidden');
  els.grpDateB.classList.add('hidden');
  els.grpWeekday.classList.add('hidden');
  els.refWrapper.classList.add('hidden');
  
  if (m === 'single') {
    els.grpDateA.classList.remove('hidden');
    els.refWrapper.classList.remove('hidden');
    els.lblDateA.textContent = "DATE CIBLE";
    els.legendA.textContent = "Sélection";
    els.legendB.textContent = "Moyenne Hebdo";
  } else if (m === 'compare') {
    els.grpDateA.classList.remove('hidden');
    els.grpDateB.classList.remove('hidden');
    els.lblDateA.textContent = "DATE A";
    els.legendA.textContent = "Date A";
    els.legendB.textContent = "Date B";
  } else if (m === 'weekday') {
    els.grpWeekday.classList.remove('hidden');
    els.legendA.textContent = "Moyenne";
    els.legendB.textContent = "-";
  }
}

// ==================== DATA ====================
async function updateVisualization() {
  const dataA = await getDataForContext('A');
  const dataB = await getDataForContext('B');
  state.slots = getSlotsUnion(dataA, dataB);

  renderChart(state.slots, dataA, dataB);
  renderStats(dataA, dataB);
}

async function getDataForContext(ctx) {
  const m = state.params.mode;
  let targetDate = null;

  if (ctx === 'A') {
    if (m === 'single' || m === 'compare') targetDate = state.params.dateA;
    else return await getWeekdayAverage(state.params.weekday);
  } else {
    if (m === 'compare') targetDate = state.params.dateB;
    else if (m === 'single' && state.params.showRef) {
      const dayOfWeek = new Date(state.params.dateA).getDay();
      return await getWeekdayAverage(dayOfWeek);
    } else return null;
  }

  if (!targetDate) return null;
  return await loadDataset(targetDate);
}

async function loadDataset(date) {
  const meta = state.catalogue.datasets.find(d => d.date === date);
  if (!meta) return null;

  if (!state.datasets.has(date)) {
    // Attention chemin racine ou data/
    const res = await fetch(meta.file);
    const text = await res.text();
    state.datasets.set(date, parseCSV(text));
  }
  return state.datasets.get(date);
}

async function getWeekdayAverage(dayIndex) {
  const matches = state.catalogue.datasets.filter(d => new Date(d.date).getDay() == dayIndex);
  if (matches.length === 0) return null;

  const allData = [];
  for (const m of matches) {
    allData.push(await loadDataset(m.date));
  }

  const slotMap = new Map();
  allData.forEach(dayData => {
    dayData.forEach(row => {
      if (!slotMap.has(row.slot)) slotMap.set(row.slot, { t:0, d:0, c:0, n:0 });
      const s = slotMap.get(row.slot);
      s.t += row.total; s.d += row.drive; s.c += row.collab; s.n++;
    });
  });

  const avgData = [];
  slotMap.forEach((v, k) => {
    avgData.push({
      slot: k,
      total: Math.round(v.t / v.n),
      drive: Math.round(v.d / v.n),
      collab: Math.round(v.c / v.n)
    });
  });
  return avgData;
}

function parseCSV(text) {
  const lines = text.split('\n').slice(1);
  return lines.map(line => {
    const [date, slot, t, d, c] = line.split(',');
    if (!slot) return null;
    const drive = parseInt(d) || 0;
    const collab = parseInt(c) || 0;
    const total = parseInt(t) || (drive + collab);
    return { slot: slot.trim(), total, drive, collab };
  }).filter(x => x);
}

function getSlotsUnion(dA, dB) {
  const s = new Set();
  if (dA) dA.forEach(r => s.add(r.slot));
  if (dB) dB.forEach(r => s.add(r.slot));
  return Array.from(s).sort((a, b) => {
    const [hA, mA] = a.split(':').map(Number);
    const [hB, mB] = b.split(':').map(Number);
    return hA - hB || mA - mB;
  });
}

// ==================== STATS & CHART ====================
function computeMedianSlot(data, metric) {
  if (!data || data.length === 0) return "-";
  const total = data.reduce((acc, r) => acc + r[metric], 0);
  const target = total / 2;
  const sorted = [...data].sort((a, b) => state.slots.indexOf(a.slot) - state.slots.indexOf(b.slot));
  let sum = 0;
  for (const row of sorted) {
    sum += row[metric];
    if (sum >= target) return row.slot;
  }
  return "-";
}

function computePeak(data, metric) {
  if (!data || data.length === 0) return { val: 0, slot: "-" };
  let max = 0, slot = "-";
  data.forEach(r => { if (r[metric] > max) { max = r[metric]; slot = r.slot; } });
  return { val: max, slot };
}

function renderChart(slots, dataA, dataB) {
  els.chartStage.innerHTML = '';
  els.xAxis.innerHTML = '';

  let maxVal = 0;
  const metric = state.params.metric;
  const getVal = (data, slot) => {
    const row = data ? data.find(r => r.slot === slot) : null;
    return row ? row[metric] : 0;
  };

  slots.forEach(s => maxVal = Math.max(maxVal, getVal(dataA, s), getVal(dataB, s)));
  maxVal = Math.max(10, maxVal * 1.1);

  slots.forEach(slot => {
    const valA = getVal(dataA, slot);
    const valB = getVal(dataB, slot);
    const hA = (valA / maxVal) * 100;
    const hB = (valB / maxVal) * 100;

    // Group
    const group = document.createElement('div');
    group.className = 'bar-group';
    
    // Wrapper A
    const wA = document.createElement('div');
    wA.className = 'bar-wrapper';
    if (valA > 0) {
      wA.innerHTML = `<div class="bar-value">${valA}</div><div class="bar" style="height:${hA}%"></div>`;
    }
    group.appendChild(wA);

    // Wrapper B (Secondary)
    if (dataB) {
      const wB = document.createElement('div');
      wB.className = 'bar-wrapper';
      if (valB > 0) {
        wB.innerHTML = `<div class="bar-value secondary">${valB}</div><div class="bar secondary" style="height:${hB}%"></div>`;
      }
      group.appendChild(wB);
    }

    els.chartStage.appendChild(group);

    // Label
    const lbl = document.createElement('div');
    lbl.className = 'x-label';
    lbl.textContent = slot;
    els.xAxis.appendChild(lbl);
  });
}

function renderStats(dataA, dataB) {
  const m = state.params.metric;
  
  // Calculs A
  const totalA = dataA ? dataA.reduce((acc, r) => acc + r[m], 0) : 0;
  const peakA = computePeak(dataA, m);
  const medianA = computeMedianSlot(dataA, m);

  // Calculs B (si dispo)
  const hasB = !!dataB;
  const totalB = dataB ? dataB.reduce((acc, r) => acc + r[m], 0) : 0;
  const peakB = computePeak(dataB, m);
  const medianB = computeMedianSlot(dataB, m);

  // Template HTML conditionnel
  const cardContent = (label, valA, subA, valB, subB) => {
    if (!hasB) {
      // Mode Simple
      return `
        <div class="stat-title">${label}</div>
        <div class="stat-value">${valA}</div>
        <div class="stat-sub">${subA}</div>
      `;
    } else {
      // Mode Comparaison (Grid interne)
      return `
        <div class="stat-title">${label}</div>
        <div class="stat-compare-grid">
          <div class="stat-col">
            <div class="stat-value val-a">${valA}</div>
            <div class="stat-sub">${subA}</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-col">
            <div class="stat-value val-b">${valB}</div>
            <div class="stat-sub">${subB}</div>
          </div>
        </div>
      `;
    }
  };

  els.statsContent.innerHTML = `
    <div class="stat-card">
      ${cardContent(
        "VOLUME TOTAL", 
        totalA, "Livraisons effectuées",
        totalB, "Livraisons effectuées"
      )}
    </div>
    <div class="stat-card">
      ${cardContent(
        "PIC D'ACTIVITÉ", 
        peakA.val, `à ${peakA.slot}`,
        peakB.val, `à ${peakB.slot}`
      )}
    </div>
    <div class="stat-card">
      ${cardContent(
        "SLOT MÉDIAN", 
        medianA, "50% du volume",
        medianB, "50% du volume"
      )}
    </div>
  `;
}

