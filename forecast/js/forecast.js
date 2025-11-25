document.addEventListener('DOMContentLoaded', initForecastModule);

async function initForecastModule() {
  const els = {
    horizonSelect: document.getElementById('horizon-select'),
    historyCount: document.getElementById('history-count'),
    lastUpdate: document.getElementById('last-update'),
    loader: document.getElementById('loader'),
    trendView: document.getElementById('trend-view'),
    chart: document.getElementById('forecast-chart'),
    statsDeck: document.getElementById('stats-deck'),
    slotDetailView: document.getElementById('slot-detail-view'),
    slotDetailChart: document.getElementById('slot-detail-chart'),
    slotDetailTitle: document.getElementById('slot-detail-title'),
    slotDetailXAxis: document.getElementById('slot-detail-xaxis')
  };

  const engine = new ForecastEngine({ alpha: 0.3 });

  try {
    const catalogue = await loadCatalogue();
    const rawDays = await loadAllOrderDays(catalogue.datasets);
    engine.loadData(rawDays);

    const lastDayEntry = rawDays.length > 0 ? rawDays[rawDays.length - 1] : null;
    let forecastStartDate = new Date(); 

    if (lastDayEntry) {
      const lastDate = new Date(lastDayEntry.date);
      lastDate.setDate(lastDate.getDate() + 1);
      forecastStartDate = lastDate;

      els.historyCount.textContent = `${engine.getHistoryLength()} jours`;
      els.lastUpdate.textContent = `Dernier jour analysé : ${formatDisplayDate(lastDayEntry.date, {weekday: 'short'})}`;
    } else {
      els.lastUpdate.textContent = 'Aucune donnée historique';
    }

    const horizon = parseInt(els.horizonSelect.value, 10) || 7;
    renderForecast(engine, els, horizon, forecastStartDate);

    els.horizonSelect.addEventListener('change', () => {
      const h = parseInt(els.horizonSelect.value, 10) || 7;
      renderForecast(engine, els, h, forecastStartDate);
    });

    els.loader.classList.add('hidden');
  } catch (err) {
    console.error(err);
    els.loader.innerHTML = `<span style="color:red">ERREUR: ${err.message}</span>`;
  }
}

async function loadCatalogue() {
  const res = await fetch('catalogue_orders.json');
  if (!res.ok) throw new Error(`catalogue_orders.json introuvable (${res.status})`);
  return res.json();
}

async function loadAllOrderDays(datasets) {
  const days = [];
  for (const ds of datasets) {
    const res = await fetch(ds.file);
    if (!res.ok) throw new Error(`Fichier ${ds.file} introuvable`);
    const text = await res.text();
    days.push(parseOrderCSV(text, ds.date));
  }
  return days.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function parseOrderCSV(text, forcedDate) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idxSlot = header.indexOf('slot');
  const idxCmd = header.indexOf('commandes_reservees');

  const slots = {};
  let total = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    const slot = cols[idxSlot].trim();
    const val = parseInt(cols[idxCmd], 10) || 0;

    if (slot) {
      slots[slot] = (slots[slot] || 0) + val;
      total += val;
    }
  }

  const dObj = new Date(forcedDate);
  return { date: forcedDate, weekday: dObj.getDay(), total, slots };
}

function renderForecast(engine, els, horizon, startDate) {
  const displayPreds = engine.predictHorizon(startDate, horizon);
  const weekPreds = engine.predictHorizon(startDate, 7);
  const err = engine.getErrorStats();

  renderTrendStats(displayPreds, weekPreds, err, els.statsDeck);

  if (horizon === 1) {
    els.trendView.style.display = 'none';
    els.slotDetailView.style.display = 'flex';
    els.chart.innerHTML = ''; 
    if (displayPreds.length > 0) renderSlotDetail(displayPreds[0], err, els);
  } else {
    els.trendView.style.display = 'flex';
    els.slotDetailView.style.display = 'none';
    els.slotDetailChart.innerHTML = '';
    els.slotDetailXAxis.innerHTML = '';
    renderChart(displayPreds, els.chart);
  }
}

function renderTrendStats(currentPreds, weekPreds, err, container) {
  if (!container || !currentPreds.length) return;
  
  const tomorrow = weekPreds[0];
  const totalWeek = weekPreds.reduce((sum, d) => sum + d.total, 0);
  const reliability = err.mape ? (100 - err.mape).toFixed(0) : '--';

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-title">DEMAIN (${formatDisplayDate(tomorrow.date, {weekday: 'short'})})</div>
      <div class="stat-value">${Math.round(tomorrow.total)}</div>
      <div class="stat-sub">Commandes prévues</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">VOLUME SEMAINE (7J)</div>
      <div class="stat-value">${Math.round(totalWeek)}</div>
      <div class="stat-sub">Total prévisionnel</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">FIABILITÉ MODÈLE</div>
      <div class="stat-value stat-confidence">${reliability}%</div>
      <div class="stat-sub">±${err.stdDev.toFixed(0)} commandes / jour</div>
    </div>
  `;
}

function renderChart(preds, container) {
  container.innerHTML = '';
  if (!preds || preds.length === 0) return;

  const data = preds.map(d => ({
    label: formatChartDate(d.date),
    value: d.total,
    low: d.lower,
    high: d.upper
  }));

  const w = container.clientWidth;
  const h = container.clientHeight || 300;
  const padding = { top: 35, right: 30, bottom: 45, left: 40 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const allY = data.flatMap(d => [d.value, d.low, d.high]);
  const minY = 0;
  const maxY = Math.max(...allY) * 1.25;

  const getX = (i) => (i / (data.length - 1)) * chartW;
  const getY = (v) => chartH - ((v - minY) / (maxY - minY)) * chartH;

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  const g = document.createElementNS(svgNs, "g");
  g.setAttribute("transform", `translate(${padding.left}, ${padding.top})`);
  svg.appendChild(g);

  let areaPath = "";
  data.forEach((d, i) => areaPath += (i===0 ? "M" : "L") + `${getX(i)},${getY(d.low)} `);
  for (let i = data.length - 1; i >= 0; i--) areaPath += `L${getX(i)},${getY(data[i].high)} `;
  areaPath += "Z";

  const area = document.createElementNS(svgNs, "path");
  area.setAttribute("d", areaPath);
  area.setAttribute("fill", "var(--f-accent-dim)");
  g.appendChild(area);

  let linePath = "";
  data.forEach((d, i) => linePath += (i===0 ? "M" : "L") + `${getX(i)},${getY(d.value)} `);
  
  const line = document.createElementNS(svgNs, "path");
  line.setAttribute("d", linePath);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--f-accent)");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-dasharray", "4,4");
  g.appendChild(line);

  data.forEach((d, i) => {
    const cx = getX(i), cy = getY(d.value);
    
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", 4);
    circle.setAttribute("fill", "var(--bg-void)");
    circle.setAttribute("stroke", "var(--f-accent)");
    circle.setAttribute("stroke-width", "2");
    g.appendChild(circle);

    const valTxt = document.createElementNS(svgNs, "text");
    valTxt.setAttribute("x", cx);
    valTxt.setAttribute("y", cy - 14);
    valTxt.setAttribute("text-anchor", "middle");
    valTxt.setAttribute("fill", "var(--f-accent)");
    valTxt.setAttribute("font-size", "12");
    valTxt.setAttribute("font-weight", "bold");
    valTxt.setAttribute("font-family", "var(--font-mono)");
    valTxt.textContent = Math.round(d.value);
    g.appendChild(valTxt);

    const rangeTxt = document.createElementNS(svgNs, "text");
    rangeTxt.setAttribute("x", cx);
    rangeTxt.setAttribute("y", getY(d.low) + 18);
    rangeTxt.setAttribute("text-anchor", "middle");
    rangeTxt.setAttribute("fill", "rgba(255,255,255,0.7)");
    rangeTxt.setAttribute("font-size", "11");
    rangeTxt.setAttribute("font-family", "var(--font-mono)");
    rangeTxt.textContent = `[${Math.round(d.low)} - ${Math.round(d.high)}]`;
    g.appendChild(rangeTxt);

    const dateTxt = document.createElementNS(svgNs, "text");
    dateTxt.setAttribute("x", cx);
    dateTxt.setAttribute("y", chartH + 20);
    dateTxt.setAttribute("text-anchor", "middle");
    dateTxt.setAttribute("fill", "var(--txt-secondary)");
    dateTxt.setAttribute("font-size", "10");
    dateTxt.setAttribute("font-family", "var(--font-mono)");
    dateTxt.textContent = d.label;
    g.appendChild(dateTxt);
  });

  container.appendChild(svg);
}

function renderSlotDetail(dayData, errorStats, els) {
  const { date, total, slots } = dayData;
  els.slotDetailTitle.textContent = `Détail de la Charge pour ${formatDisplayDate(date)}`;
  
  const container = els.slotDetailChart;
  const xaxisContainer = els.slotDetailXAxis;
  container.innerHTML = '';
  xaxisContainer.innerHTML = '';
  if (!slots) return;

  const slotData = Object.entries(slots)
    .map(([slot, value]) => ({ slot, value }))
    .sort((a, b) => {
      const getMins = (s) => {
        const [h, m] = s.split(':').map(Number);
        return h * 60 + (m || 0);
      };
      return getMins(a.slot) - getMins(b.slot);
    });

  const w = container.clientWidth;
  const h = container.clientHeight || 180;
  const padding = { top: 25, bottom: 5, left: 0, right: 0 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  
  const maxVal = Math.max(...slotData.map(d => d.value)) * 1.15;
  const barWidth = chartW / slotData.length;
  const getY = (v) => chartH - ((v / maxVal) * chartH);

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  const g = document.createElementNS(svgNs, "g");
  g.setAttribute("transform", `translate(${padding.left}, ${padding.top})`);
  svg.appendChild(g);

  slotData.forEach((d, i) => {
    const x = i * barWidth;
    const y = getY(d.value);

    const slotError = total > 0 ? (errorStats.stdDev * (d.value / total)) : 0;
    const yHigh = Math.max(0, getY(d.value + slotError));
    const yLow = Math.min(chartH, getY(Math.max(0, d.value - slotError)));

    const group = document.createElementNS(svgNs, "g");

    const whisker = document.createElementNS(svgNs, "line");
    whisker.setAttribute('x1', x + barWidth / 2);
    whisker.setAttribute('y1', yLow);
    whisker.setAttribute('x2', x + barWidth / 2);
    whisker.setAttribute('y2', yHigh);
    whisker.setAttribute('stroke', 'rgba(255,255,255,0.3)');
    whisker.setAttribute('stroke-width', '1');
    group.appendChild(whisker);
    
    const bar = document.createElementNS(svgNs, "rect");
    bar.setAttribute('x', x + barWidth * 0.15);
    bar.setAttribute('y', y);
    bar.setAttribute('width', barWidth * 0.7);
    bar.setAttribute('height', chartH - y);
    bar.setAttribute('fill', 'var(--f-accent)');
    bar.setAttribute('opacity', '0.8');
    bar.setAttribute('rx', '2');
    bar.setAttribute('class', 'forecast-bar');
    group.appendChild(bar);

    if (d.value > 0) {
      const valTxt = document.createElementNS(svgNs, "text");
      valTxt.setAttribute('x', x + barWidth / 2);
      valTxt.setAttribute('y', y - 6);
      valTxt.setAttribute('text-anchor', 'middle');
      valTxt.setAttribute('fill', 'var(--txt-primary)');
      valTxt.setAttribute('font-size', '10');
      valTxt.setAttribute('font-weight', 'bold');
      valTxt.setAttribute('font-family', 'var(--font-mono)');
      valTxt.textContent = Math.round(d.value);
      group.appendChild(valTxt);
    }
    
    g.appendChild(group);

    const label = document.createElement('div');
    label.className = 'slot-label';
    label.textContent = d.slot;
    xaxisContainer.appendChild(label);
  });

  container.appendChild(svg);
}

function formatDisplayDate(iso, options = {}) {
  const defaults = { weekday: 'long', day: 'numeric', month: 'long' };
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { ...defaults, ...options });
}

function formatChartDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
}

document.addEventListener('DOMContentLoaded', () => {
  const infoBtn = document.getElementById('info-btn');
  const modal = document.getElementById('info-modal');
  const closeBtn = document.getElementById('modal-close');

  if (infoBtn && modal && closeBtn) {
    infoBtn.addEventListener('click', () => modal.classList.add('active'));
    closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        modal.classList.remove('active');
      }
    });
  }
});
