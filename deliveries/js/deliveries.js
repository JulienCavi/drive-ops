// ======== STATE GLOBAL =========
const deliveriesState = {
  manifest: null,
  datasetsByDate: new Map(),
  slots: [],
  ready: false,
};

// ======== CONSTANTES =========
const WEEKDAY_LABELS = [
  "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"
];

// ======== DOM =========
let statusBar;
let modeSelect;
let dateASelect;
let dateBSelect;
let weekdaySelect;
let metricSelect;
let showWeekdayRefCheckbox;
let chartEl;
let statsEl;

// ======== INIT DOM =========
document.addEventListener("DOMContentLoaded", () => {
  statusBar = document.getElementById("status-bar");
  modeSelect = document.getElementById("mode-select");
  dateASelect = document.getElementById("date-a-select");
  dateBSelect = document.getElementById("date-b-select");
  weekdaySelect = document.getElementById("weekday-select");
  metricSelect = document.getElementById("metric-select");
  showWeekdayRefCheckbox = document.getElementById("show-weekday-ref");
  chartEl = document.getElementById("chart");
  statsEl = document.getElementById("stats-content");

  modeSelect.addEventListener("change", () => {
    updateVisibility();
    render();
  });
  
  dateASelect.addEventListener("change", render);
  dateBSelect.addEventListener("change", render);
  weekdaySelect.addEventListener("change", render);
  metricSelect.addEventListener("change", render);
  
  if (showWeekdayRefCheckbox) {
    showWeekdayRefCheckbox.addEventListener("change", render);
  }

  initDeliveriesModule().catch((err) => {
    console.error(err);
    statusBar.textContent = "Erreur lors du chargement des données : " + err.message;
  });
});

// ======== INITIALISATION ==========
async function initDeliveriesModule() {
  statusBar.textContent = "Chargement du catalogue de livraisons...";

  const resp = await fetch("data/catalogue_deliveries.json");
  if (!resp.ok) throw new Error(`Impossible de charger le catalogue (${resp.status})`);

  deliveriesState.manifest = await resp.json();

  for (const ds of deliveriesState.manifest.datasets) {
    await loadDataset(ds);
  }

  populateDateSelects();
  
  // ← FIX : Mettre "drive" par défaut au lieu de "total"
  if (metricSelect) {
    metricSelect.value = "drive";
  }
  
  deliveriesState.ready = true;
  updateVisibility();
  render();

  statusBar.textContent = `Journée : ${dateASelect.selectedOptions[0]?.text || '—'} – métrique : ${metricSelect.selectedOptions[0]?.text || 'Drive'}`;
}


async function loadDataset(ds) {
  const resp = await fetch(ds.file);
  if (!resp.ok) {
    console.warn(`Dataset ${ds.file} introuvable`);
    return;
  }

  const text = await resp.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return;

  const records = lines.slice(1).map((line) => {
    const parts = line.split(/[,;]/);
    
    // Parse avec trim pour éviter les espaces
    const date = parts[0]?.trim() || '';
    const slot = parts[1]?.trim() || '';
    const total = parseInt(parts[2]?.trim(), 10) || 0;
    const drive = parseInt(parts[3]?.trim(), 10) || 0;
    const collab = parseInt(parts[4]?.trim(), 10) || 0;
    
    // ← FIX : Si total est 0 ou invalide, recalculer à partir de drive + collab
    const computedTotal = total > 0 ? total : (drive + collab);
    
    return {
      date,
      slot,
      total: computedTotal, // ← Utilise le total calculé
      drive,
      collab,
    };
  });

  const slotMap = new Map();
  for (const rec of records) {
    if (!deliveriesState.slots.includes(rec.slot)) {
      deliveriesState.slots.push(rec.slot);
    }
    slotMap.set(rec.slot, {
      total: rec.total,
      drive: rec.drive,
      collab: rec.collab,
    });
  }

  // TRI CHRONOLOGIQUE
  deliveriesState.slots.sort((a, b) => {
    const [hA, mA] = a.split(':').map(Number);
    const [hB, mB] = b.split(':').map(Number);
    return hA * 60 + mA - (hB * 60 + mB);
  });

  const dateObj = parseDate(ds.date);
  const weekday = dateObj ? dateObj.getDay() : 0;

  deliveriesState.datasetsByDate.set(ds.date, {
    date: ds.date,
    label: ds.label,
    weekday,
    slots: slotMap,
  });
}


function parseDate(str) {
  if (!str) return null;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(+y, +m - 1, +d);
}

// ======== VISIBILITÉ ========
function updateVisibility() {
  const mode = modeSelect.value;
  
  const dateACard = document.querySelector('[data-group="date-a"]');
  const dateBCard = document.querySelector('[data-group="date-b"]');
  const weekdayCard = document.querySelector('[data-group="weekday"]');
  const optionsCard = document.querySelector('[data-group="options"]');

  if (mode === "single") {
    if (dateACard) dateACard.dataset.hidden = "false";
    if (dateBCard) dateBCard.dataset.hidden = "true";
    if (weekdayCard) weekdayCard.dataset.hidden = "true";
    if (optionsCard) optionsCard.dataset.hidden = "false";
  } else if (mode === "compare") {
    if (dateACard) dateACard.dataset.hidden = "false";
    if (dateBCard) dateBCard.dataset.hidden = "false";
    if (weekdayCard) weekdayCard.dataset.hidden = "true";
    if (optionsCard) optionsCard.dataset.hidden = "false";
  } else if (mode === "weekday") {
    if (dateACard) dateACard.dataset.hidden = "true";
    if (dateBCard) dateBCard.dataset.hidden = "true";
    if (weekdayCard) weekdayCard.dataset.hidden = "false";
    if (optionsCard) optionsCard.dataset.hidden = "true";
  }
}

// ======== POPULATE SELECTS ========
function populateDateSelects() {
  const dates = Array.from(deliveriesState.datasetsByDate.keys()).sort();

  dateASelect.innerHTML = dates
    .map((d) => {
      const ds = deliveriesState.datasetsByDate.get(d);
      return `<option value="${d}">${ds.label}</option>`;
    })
    .join("");

  dateBSelect.innerHTML = dates
    .map((d) => {
      const ds = deliveriesState.datasetsByDate.get(d);
      return `<option value="${d}">${ds.label}</option>`;
    })
    .join("");

  if (dates.length > 0) {
    dateASelect.value = dates[dates.length - 1];
    dateBSelect.value = dates[dates.length - 1];
  }
}

// ======== RENDER =========
function render() {
  if (!deliveriesState.ready) return;

  const mode = modeSelect.value;
  const metric = metricSelect.value;

  if (mode === "single") {
    renderSingle(metric);
  } else if (mode === "compare") {
    renderCompare(metric);
  } else if (mode === "weekday") {
    renderWeekday(metric);
  }

  // Update status bar
  if (mode === "single") {
    const dateText = dateASelect.selectedOptions[0]?.text || "";
    statusBar.textContent = `Journée : ${dateText} – métrique : ${metricSelect.selectedOptions[0]?.text}`;
  } else if (mode === "compare") {
    const dateAText = dateASelect.selectedOptions[0]?.text || "";
    const dateBText = dateBSelect.selectedOptions[0]?.text || "";
    statusBar.textContent = `Comparaison : ${dateAText} vs ${dateBText} – métrique : ${metricSelect.selectedOptions[0]?.text}`;
  } else if (mode === "weekday") {
    const weekdayText = weekdaySelect.selectedOptions[0]?.text || "";
    statusBar.textContent = `Profil : ${weekdayText} – métrique : ${metricSelect.selectedOptions[0]?.text}`;
  }
}

// ======== RENDER SINGLE ========
function renderSingle(metric) {
  const dateA = dateASelect.value;
  const dsA = deliveriesState.datasetsByDate.get(dateA);
  if (!dsA) return;

  const showRef = showWeekdayRefCheckbox && showWeekdayRefCheckbox.checked;
  const dsRef = showRef ? computeWeekdayAverage(dsA.weekday) : null;

  let maxGlobal = 0;
  for (const slot of deliveriesState.slots) {
    const dataA = dsA.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const valueA = dataA[metric] || 0;
    let valueRef = 0;
    if (dsRef && dsRef.slots.has(slot)) {
      valueRef = dsRef.slots.get(slot)[metric] || 0;
    }
    const localMax = Math.max(valueA, valueRef);
    if (localMax > maxGlobal) maxGlobal = localMax;
  }

  if (maxGlobal === 0) maxGlobal = 1;

  chartEl.innerHTML = "";

  for (const slot of deliveriesState.slots) {
    const dataA = dsA.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const valueA = dataA[metric] || 0;

    let valueRef = 0;
    if (dsRef && dsRef.slots.has(slot)) {
      valueRef = dsRef.slots.get(slot)[metric] || 0;
    }

    const groupEl = document.createElement("div");
    groupEl.className = "bar-group";

    const barsContainer = document.createElement("div");
    barsContainer.className = "bars-container";

    const barEl = document.createElement("div");
    barEl.className = "bar";
    barEl.style.height = `${(valueA / maxGlobal) * 100}%`;
    barEl.title = `${slot} : ${valueA}`;
    barsContainer.appendChild(barEl);

    if (showRef && dsRef) {
      const barRef = document.createElement("div");
      barRef.className = "bar bar-ref";
      barRef.style.height = `${(valueRef / maxGlobal) * 100}%`;
      barRef.title = `Moy. ${WEEKDAY_LABELS[dsA.weekday]} : ${valueRef}`;
      barsContainer.appendChild(barRef);
    }

    const valueEl = document.createElement("div");
    valueEl.className = "bar-value";
    valueEl.textContent = valueA;

    const labelEl = document.createElement("div");
    labelEl.className = "bar-label";
    labelEl.textContent = slot;

    groupEl.appendChild(barsContainer);
    groupEl.appendChild(valueEl);
    groupEl.appendChild(labelEl);
    chartEl.appendChild(groupEl);
  }

  // STATS
  const medianInfo = computeTemporalMedian(dsA.slots, metric);
  let total = 0;
  let peakSlot = "";
  let peakValue = 0;

  for (const slot of deliveriesState.slots) {
    const data = dsA.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const value = data[metric] || 0;
    total += value;
    if (value > peakValue) {
      peakValue = value;
      peakSlot = slot;
    }
  }

  const statsData = [
    { label: dsA.label, value: total, detail: null },
    { label: 'Créneau peak', value: peakSlot, detail: `${peakValue} livraisons` },
    { label: 'Médiane temporelle', value: medianInfo ? medianInfo.slot : '—', detail: '50% du volume atteint' },
    { label: 'Concentration', value: `${computeConcentration(dsA.slots, metric)} créneaux`, detail: 'pour 50% du volume' }
  ];

  renderStats(statsData);
}

// ======== RENDER COMPARE ========
function renderCompare(metric) {
  const dateA = dateASelect.value;
  const dateB = dateBSelect.value;
  const dsA = deliveriesState.datasetsByDate.get(dateA);
  const dsB = deliveriesState.datasetsByDate.get(dateB);
  if (!dsA || !dsB) return;

  const showRef = showWeekdayRefCheckbox && showWeekdayRefCheckbox.checked;
  const dsRef = showRef ? computeWeekdayAverage(dsA.weekday) : null;

  let maxGlobal = 0;
  for (const slot of deliveriesState.slots) {
    const dataA = dsA.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const dataB = dsB.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const valueA = dataA[metric] || 0;
    const valueB = dataB[metric] || 0;
    let valueRef = 0;
    if (dsRef && dsRef.slots.has(slot)) {
      valueRef = dsRef.slots.get(slot)[metric] || 0;
    }
    const localMax = Math.max(valueA, valueB, valueRef);
    if (localMax > maxGlobal) maxGlobal = localMax;
  }

  if (maxGlobal === 0) maxGlobal = 1;

  chartEl.innerHTML = "";

  for (const slot of deliveriesState.slots) {
    const dataA = dsA.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const dataB = dsB.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const valueA = dataA[metric] || 0;
    const valueB = dataB[metric] || 0;

    let valueRef = 0;
    if (dsRef && dsRef.slots.has(slot)) {
      valueRef = dsRef.slots.get(slot)[metric] || 0;
    }

    const groupEl = document.createElement("div");
    groupEl.className = "bar-group compare-mode";

    const barsContainer = document.createElement("div");
    barsContainer.className = "bars-container";

    const barA = document.createElement("div");
    barA.className = "bar bar-a";
    barA.style.height = `${(valueA / maxGlobal) * 100}%`;
    barA.title = `${dsA.label} : ${valueA}`;
    barsContainer.appendChild(barA);

    const barB = document.createElement("div");
    barB.className = "bar bar-b";
    barB.style.height = `${(valueB / maxGlobal) * 100}%`;
    barB.title = `${dsB.label} : ${valueB}`;
    barsContainer.appendChild(barB);

    if (showRef && dsRef) {
      const barRef = document.createElement("div");
      barRef.className = "bar bar-ref";
      barRef.style.height = `${(valueRef / maxGlobal) * 100}%`;
      barRef.title = `Moy. ${WEEKDAY_LABELS[dsA.weekday]} : ${valueRef}`;
      barsContainer.appendChild(barRef);
    }

    const valueEl = document.createElement("div");
    valueEl.className = "bar-value";
    valueEl.innerHTML = `<span style="color: #38bdf8;">${valueA}</span> / <span style="color: #f97373;">${valueB}</span>`;

    const labelEl = document.createElement("div");
    labelEl.className = "bar-label";
    labelEl.textContent = slot;

    groupEl.appendChild(barsContainer);
    groupEl.appendChild(valueEl);
    groupEl.appendChild(labelEl);
    chartEl.appendChild(groupEl);
  }

  // STATS
  let totalA = 0, totalB = 0;
  for (const slot of deliveriesState.slots) {
    const dataA = dsA.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const dataB = dsB.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    totalA += dataA[metric] || 0;
    totalB += dataB[metric] || 0;
  }

  const diff = totalA - totalB;
  const diffPercent = totalB > 0 ? ((diff / totalB) * 100).toFixed(1) : 0;
  const diffSign = diff > 0 ? "+" : "";

  const statsData = [
    { label: dsA.label, value: totalA, detail: '(Série A)' },
    { label: dsB.label, value: totalB, detail: '(Série B)' },
    { label: 'Différence', value: `${diffSign}${diff}`, detail: `${diffSign}${diffPercent} %` }
  ];

  renderStats(statsData);
}

// ======== RENDER WEEKDAY ========
function renderWeekday(metric) {
  const weekday = parseInt(weekdaySelect.value, 10);
  if (isNaN(weekday)) {
    chartEl.innerHTML = '<p style="color: var(--color-text-secondary); padding: 2rem; text-align: center;">Sélectionnez un jour de la semaine</p>';
    statsEl.innerHTML = '';
    return;
  }

  const dsAvg = computeWeekdayAverage(weekday);
  if (!dsAvg) {
    chartEl.innerHTML = '<p style="color: var(--color-text-secondary); padding: 2rem; text-align: center;">Aucune donnée pour ce jour</p>';
    statsEl.innerHTML = '';
    return;
  }

  let maxGlobal = 0;
  for (const slot of deliveriesState.slots) {
    const data = dsAvg.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const value = data[metric] || 0;
    if (value > maxGlobal) maxGlobal = value;
  }

  if (maxGlobal === 0) maxGlobal = 1;

  chartEl.innerHTML = "";

  for (const slot of deliveriesState.slots) {
    const data = dsAvg.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    const value = data[metric] || 0;

    const groupEl = document.createElement("div");
    groupEl.className = "bar-group";

    const barsContainer = document.createElement("div");
    barsContainer.className = "bars-container";

    const barEl = document.createElement("div");
    barEl.className = "bar";
    barEl.style.height = `${(value / maxGlobal) * 100}%`;
    barEl.title = `${slot} : ${value}`;
    barsContainer.appendChild(barEl);

    const valueEl = document.createElement("div");
    valueEl.className = "bar-value";
    valueEl.textContent = value;

    const labelEl = document.createElement("div");
    labelEl.className = "bar-label";
    labelEl.textContent = slot;

    groupEl.appendChild(barsContainer);
    groupEl.appendChild(valueEl);
    groupEl.appendChild(labelEl);
    chartEl.appendChild(groupEl);
  }

  // STATS
  const medianInfo = computeTemporalMedian(dsAvg.slots, metric);
  let total = 0;
  for (const slot of deliveriesState.slots) {
    const data = dsAvg.slots.get(slot) || { total: 0, drive: 0, collab: 0 };
    total += data[metric] || 0;
  }

  const statsData = [
    { label: `Moy. ${WEEKDAY_LABELS[weekday]}`, value: total, detail: 'Total moyen' },
    { label: 'Médiane temporelle', value: medianInfo ? medianInfo.slot : '—', detail: '50% du volume atteint' }
  ];

  renderStats(statsData);
}

// ======== RENDER STATS (format cards) ========
function renderStats(data) {
  let html = '';
  
  for (const item of data) {
    html += `
      <div class="stat-card">
        <div class="stat-label">${item.label}</div>
        <div class="stat-value">${item.value}</div>
        ${item.detail ? `<div class="stat-detail">${item.detail}</div>` : ''}
      </div>
    `;
  }
  
  statsEl.innerHTML = html;
}

// ======== WEEKDAY AVERAGE ========
function computeWeekdayAverage(weekday) {
  const filtered = Array.from(deliveriesState.datasetsByDate.values()).filter(
    (ds) => ds.weekday === weekday
  );

  if (filtered.length === 0) return null;

  const avgSlots = new Map();

  for (const slot of deliveriesState.slots) {
    let sumTotal = 0, sumDrive = 0, sumCollab = 0, count = 0;

    for (const ds of filtered) {
      if (ds.slots.has(slot)) {
        const data = ds.slots.get(slot);
        sumTotal += data.total || 0;
        sumDrive += data.drive || 0;
        sumCollab += data.collab || 0;
        count++;
      }
    }

    if (count > 0) {
      avgSlots.set(slot, {
        total: Math.round(sumTotal / count),
        drive: Math.round(sumDrive / count),
        collab: Math.round(sumCollab / count),
      });
    }
  }

  return {
    date: null,
    label: `Moyenne ${WEEKDAY_LABELS[weekday]}`,
    weekday,
    slots: avgSlots,
  };
}

// ======== MÉDIANE TEMPORELLE ========
function computeTemporalMedian(slotsData, metric) {
  let total = 0;
  for (const slot of deliveriesState.slots) {
    const data = slotsData.get(slot) || { total: 0, drive: 0, collab: 0 };
    total += data[metric] || 0;
  }

  if (total === 0) return null;

  const target = total / 2;
  let cumul = 0;
  let medianSlot = null;

  for (const slot of deliveriesState.slots) {
    const data = slotsData.get(slot) || { total: 0, drive: 0, collab: 0 };
    const value = data[metric] || 0;
    cumul += value;

    if (cumul >= target && !medianSlot) {
      medianSlot = slot;
      break;
    }
  }

  return { slot: medianSlot, total };
}

// ======== CONCENTRATION ========
function computeConcentration(slotsData, metric) {
  let total = 0;
  const values = [];

  for (const slot of deliveriesState.slots) {
    const data = slotsData.get(slot) || { total: 0, drive: 0, collab: 0 };
    const value = data[metric] || 0;
    total += value;
    values.push(value);
  }

  if (total === 0) return 0;

  values.sort((a, b) => b - a);

  const target = total / 2;
  let cumul = 0;
  let count = 0;

  for (const value of values) {
    cumul += value;
    count++;
    if (cumul >= target) break;
  }

  return count;
}
