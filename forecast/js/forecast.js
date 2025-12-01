// forecast.js

// Helpers UI : apparition smooth des panels + highlight des toggles
function smoothShowPanel(el) {
  if (!el) return;
  el.style.display = 'flex';
  el.classList.remove('fade-in');
  // Force un reflow pour relancer l'animation si on rappelle la fonction
  void el.offsetWidth;
  el.classList.add('fade-in');
}

function hidePanel(el) {
  if (!el) return;
  el.style.display = 'none';
}

function setToggleRowState(inputEl, isOn) {
  if (!inputEl) return;
  const row = inputEl.closest('.toggle-row');
  if (!row) return;
  row.classList.toggle('is-on', !!isOn);
}


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
    slotDetailXAxis: document.getElementById('slot-detail-xaxis'),
    calendarToggle: document.getElementById('calendar-toggle'),
    backtestToggle: document.getElementById('backtest-toggle'),
    backtestView: document.getElementById('backtest-view'),
    backtestChart: document.getElementById('backtest-chart'),
    backtestTableBody: document.getElementById('backtest-tbody')
  };

    // État visuel initial des toggles
  setToggleRowState(els.calendarToggle, els.calendarToggle && els.calendarToggle.checked);
  setToggleRowState(els.backtestToggle, els.backtestToggle && els.backtestToggle.checked);

  // Modèle avec alpha fixe (pour l’instant)
  const engine = new ForecastEngine({ alpha: 0.3 });

  // Variables partagées dans tout initForecastModule
  let backtestSeries = null;
  let calendarBias = null;
  let forecastStartDate = new Date();

  /**
   * Active / désactive le mode backtest.
   * Quand backtest ON : on cache les vues de prévision et on affiche la vue backtest.
   * Quand backtest OFF : on relance le rendu de prévision classique.
   */
  function toggleBacktestMode(isOn) {
    if (!els.backtestView || !backtestSeries || !backtestSeries.length) {
      // Si pas de série dispo, on force OFF et on corrige le visuel
      if (els.backtestToggle) {
        els.backtestToggle.checked = false;
        setToggleRowState(els.backtestToggle, false);
      }
      return;
    }

    if (isOn) {
      // On masque les vues prévisionnelles (graph + slots)
      hidePanel(els.trendView);
      hidePanel(els.slotDetailView);

      if (els.chart) els.chart.innerHTML = '';
      if (els.slotDetailChart) els.slotDetailChart.innerHTML = '';
      if (els.slotDetailXAxis) els.slotDetailXAxis.innerHTML = '';

      // On affiche la vue backtest avec un petit fade-in
      smoothShowPanel(els.backtestView);
      renderBacktest(backtestSeries, els);
    } else {
      // On cache la vue backtest
      hidePanel(els.backtestView);

      // On revient à la vue normale selon l’horizon courant
      const h = parseInt(els.horizonSelect.value, 10) || 7;
      const useCal = !!(els.calendarToggle && els.calendarToggle.checked);
      renderForecast(engine, els, h, forecastStartDate, calendarBias, useCal);
    }

    // Sécurité : maintenir le visuel du toggle aligné
    if (els.backtestToggle) {
      setToggleRowState(els.backtestToggle, !!isOn);
    }
  }


  try {
    // On charge l'historique depuis data/history.json
    const catalogue = await loadCatalogue();
    const rawDays = await loadAllOrderDays(catalogue.datasets);
    engine.loadData(rawDays);

    // Séries de backtest (rejeu historique one-step-ahead)
    backtestSeries = typeof engine.getBacktestSeries === 'function'
      ? engine.getBacktestSeries()
      : null;

    // Résumé calendaire (biais Richesse/Croisière/Économie)
    calendarBias = engine.getCalendarBiasSummary
      ? engine.getCalendarBiasSummary()
      : null;

    const lastDayEntry = rawDays.length > 0 ? rawDays[rawDays.length - 1] : null;

    if (lastDayEntry) {
      const lastDate = new Date(lastDayEntry.date);
      lastDate.setDate(lastDate.getDate() + 1);
      forecastStartDate = lastDate;

      // On affiche le nb de jours d’historique total
      if (els.historyCount) {
        els.historyCount.textContent = `${engine.getHistoryLength()} jours`;
      }
      if (els.lastUpdate) {
        els.lastUpdate.textContent =
          `Dernier jour analysé : ${formatDisplayDate(lastDayEntry.date, { weekday: 'short' })}`;
      }
    } else {
      if (els.lastUpdate) {
        els.lastUpdate.textContent = 'Aucune donnée historique';
      }
    }

    const initialHorizon = parseInt(els.horizonSelect.value, 10) || 7;
    const initialUseCalendarBias = !!(els.calendarToggle && els.calendarToggle.checked);
    renderForecast(engine, els, initialHorizon, forecastStartDate, calendarBias, initialUseCalendarBias);

    // Changement d'horizon (1 jour / 7 jours / etc.)
    els.horizonSelect.addEventListener('change', () => {
      if (els.backtestToggle && els.backtestToggle.checked) {
        els.backtestToggle.checked = false;
        toggleBacktestMode(false);
        setToggleRowState(els.backtestToggle, false);
      }
      const h = parseInt(els.horizonSelect.value, 10) || 7;
      const useCal = !!(els.calendarToggle && els.calendarToggle.checked);
      renderForecast(engine, els, h, forecastStartDate, calendarBias, useCal);
    });


    // Toggle effet calendaire
    if (els.calendarToggle) {
      els.calendarToggle.addEventListener('change', () => {
        // Visuel du toggle calendaire
        setToggleRowState(els.calendarToggle, els.calendarToggle.checked);

        // Si backtest actif → on le coupe (et on l'éteint visuellement)
        if (els.backtestToggle && els.backtestToggle.checked) {
          els.backtestToggle.checked = false;
          toggleBacktestMode(false);
          setToggleRowState(els.backtestToggle, false);
        }

        const h = parseInt(els.horizonSelect.value, 10) || 7;
        const useCal = !!els.calendarToggle.checked;
        renderForecast(engine, els, h, forecastStartDate, calendarBias, useCal);
      });
    }


    // Toggle Backtest
    if (els.backtestToggle) {
      els.backtestToggle.addEventListener('change', () => {
        const isOn = !!els.backtestToggle.checked;
        setToggleRowState(els.backtestToggle, isOn);
        toggleBacktestMode(isOn);
      });
    }


    if (els.loader) {
      els.loader.classList.add('hidden');
    }
  } catch (err) {
    console.error(err);
    if (els.loader) {
      els.loader.innerHTML = `<span style="color:red">ERREUR: ${err.message}</span>`;
    }
  }
}

/**
 * On lit directement data/history.json et on le renvoie
 * sous forme { datasets: [...] } pour ne rien casser.
 */
async function loadCatalogue() {
  const res = await fetch('data/history.json');
  if (!res.ok) throw new Error(`history.json introuvable (${res.status})`);
  const data = await res.json(); // tableau de jours
  return { datasets: data };
}

/**
 * Chaque élément "ds" est déjà un jour :
 * { date, total, slots, (optionnel) weekday, (optionnel) special }
 */
async function loadAllOrderDays(datasets) {
  const days = datasets
    .map(ds => {
      const dateStr = ds.date;
      const dObj = new Date(dateStr);

      return {
        date: dateStr,
        weekday: typeof ds.weekday === 'number' ? ds.weekday : dObj.getDay(),
        total: Number(ds.total) || 0,
        slots: ds.slots || {},
        // ⬇️ on propage le flag "special" s'il existe
        special: ds.special || null
      };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return days;
}

/**
 * Ancienne fonction de parsing CSV conservée au cas où.
 * Elle n'est plus utilisée avec history.json, mais tu peux
 * la garder si tu veux faire des imports à la volée.
 */
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

/**
 * Applique (optionnellement) le biais calendaire Richesse/Croisière/Économie
 * aux prévisions, uniquement pour l'affichage.
 */
function applyCalendarBiasToPredictions(preds, calendarBias, useCalendarBias) {
  if (!useCalendarBias || !calendarBias) return preds;

  const prudence = 0.5;        // n'applique que 50% du biais mesuré
  const clampMin = 0.8;        // max -20%
  const clampMax = 1.2;        // max +20%

  return preds.map(d => {
    const zoneKey = getCalendarZoneForDate(d.date);
    const info = calendarBias[zoneKey];
    if (!info || !info.count || info.count < 5) {
      // Pas assez de recul → on ne touche pas
      return d;
    }

    let factor = 1 + prudence * (info.biasPct / 100);
    if (!isFinite(factor)) factor = 1;
    factor = Math.max(clampMin, Math.min(clampMax, factor));

    const total = d.total * factor;
    const lower = d.lower * factor;
    const upper = d.upper * factor;

    let slots = d.slots;
    if (slots) {
      const adjSlots = {};
      Object.entries(slots).forEach(([slot, val]) => {
        adjSlots[slot] = val * factor;
      });
      slots = adjSlots;
    }

    return {
      ...d,
      total,
      lower,
      upper,
      slots
    };
  });
}

/**
 * Rendu principal : prévisions + stats + graphe.
 */
function renderForecast(engine, els, horizon, startDate, calendarBias, useCalendarBias) {
  // Prévisions "brutes" du moteur (neutres calendrier)
  const basePreds = engine.predictHorizon(startDate, horizon);
  const baseWeekPreds = engine.predictHorizon(startDate, 7);
  const err = engine.getErrorStats();

  // Version éventuellement ajustée pour l'affichage
  const displayPreds = applyCalendarBiasToPredictions(basePreds, calendarBias, useCalendarBias);
  const weekPreds = applyCalendarBiasToPredictions(baseWeekPreds, calendarBias, useCalendarBias);

  // Fiabilité par date (basée sur le weekday du modèle brut)
  let reliabilityByDate = null;
  if (typeof engine.getErrorStatsForWeekday === 'function') {
    reliabilityByDate = {};
    basePreds.forEach(d => {
      const stats = engine.getErrorStatsForWeekday(d.weekday);
      const rel = stats && stats.mape ? (100 - stats.mape) : null; // 0–100
      reliabilityByDate[d.date] = rel;
    });
  }

  // Deck des 3 cartes (Demain / 7J / Fiabilité)
  renderTrendStats(
    displayPreds,
    weekPreds,
    err,
    calendarBias,
    reliabilityByDate,
    els.statsDeck
  );

  // Choix de la vue : horizon = 1 → détail créneau, sinon → graphe multi-jours
    if (horizon === 1) {
    // Vue détail J+1
    hidePanel(els.trendView);
    smoothShowPanel(els.slotDetailView);

    if (els.chart) els.chart.innerHTML = '';
    if (displayPreds.length > 0) {
      renderSlotDetail(displayPreds[0], err, els);
    }
  } else {
    // Vue multi-jours
    smoothShowPanel(els.trendView);
    hidePanel(els.slotDetailView);

    if (els.slotDetailChart) els.slotDetailChart.innerHTML = '';
    if (els.slotDetailXAxis) els.slotDetailXAxis.innerHTML = '';

    renderChart(displayPreds, els.chart, reliabilityByDate);
  }

}

/**
 * Zone calendrier pour une date (même logique que le moteur) :
 * Richesse : 28→31 ou 1→5
 * Croisière : 6→20
 * Économie : 21→27
 */
function getCalendarZoneForDate(isoDate) {
  const d = new Date(isoDate);
  const day = d.getDate();

  // Richesse : 28→31 OU 1→5
  if (day >= 28 || day <= 5) return 'richesse';

  // Croisière : 6→20
  if (day >= 6 && day <= 20) return 'croisiere';

  // Économie : 21→27
  return 'economie';
}

/**
 * 3 cartes du deck : Demain, 7J, Fiabilité.
 */
function renderTrendStats(currentPreds, weekPreds, err, calendarBias, reliabilityByDate, container) {
  if (!container || !currentPreds.length) return;

  const tomorrow = weekPreds[0];
  const totalWeek = weekPreds.reduce((sum, d) => sum + d.total, 0);

  // Fiabilité globale du modèle (MAPE global)
  const reliabilityGlobal = err.mape ? (100 - err.mape).toFixed(0) : '--';

  // Fiabilité pour le jour de demain (basée sur son weekday)
  let reliabilityTomorrow = '--';
  if (tomorrow && reliabilityByDate && reliabilityByDate[tomorrow.date] != null) {
    reliabilityTomorrow = reliabilityByDate[tomorrow.date].toFixed(0);
  }

  // Texte de tendance calendaire (Richesse / Croisière / Économie)
  let calendarLine = 'Calendrier : --';

  if (calendarBias && tomorrow && tomorrow.date) {
    const zoneKey = getCalendarZoneForDate(tomorrow.date); // 'richesse' | 'croisiere' | 'economie'
    const info = calendarBias[zoneKey];

    if (info && info.count > 0) {
      const labelZone =
        zoneKey === 'richesse'
          ? 'Zone "Richesse"'
          : zoneKey === 'economie'
            ? 'Zone "Économie"'
            : 'Zone "Croisière"';

      const bias = info.biasPct || 0;
      const sign = bias >= 0 ? '+' : '';
      calendarLine = `Calendrier : ${labelZone} (${sign}${bias.toFixed(0)}% observé · n=${info.count})`;
    }
  }

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
      <div class="stat-value stat-confidence">${reliabilityGlobal}%</div>
      <div class="stat-sub">
        Globale : ±${err.stdDev.toFixed(0)} commandes / jour<br/>
        Demain (${formatDisplayDate(tomorrow.date, {weekday: 'short'})}) : ${reliabilityTomorrow}% sur ce jour<br/>
        ${calendarLine}
      </div>
    </div>
  `;
}

/**
 * Graphe principal avec fourchettes + fiabilité sous chaque point.
 */
function renderChart(preds, container, reliabilityByDate = null) {
  if (!container) return;
  container.innerHTML = '';
  if (!preds || preds.length === 0) return;

  const data = preds.map(d => ({
    label: formatChartDate(d.date),
    value: d.total,
    low: d.lower,
    high: d.upper,
    date: d.date // on garde l'ISO pour retrouver la fiabilité
  }));

  const w = container.clientWidth;
  const h = container.clientHeight || 300;
  const padding = { top: 35, right: 30, bottom: 45, left: 40 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const allY = data.flatMap(d => [d.value, d.low, d.high]);
  const minY = 0;
  const maxY = Math.max(...allY) * 1.25 || 1;

  const getX = (i) =>
    data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW;
  const getY = (v) =>
    chartH - ((v - minY) / (maxY - minY)) * chartH;

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  const g = document.createElementNS(svgNs, "g");
  g.setAttribute("transform", `translate(${padding.left}, ${padding.top})`);
  svg.appendChild(g);

  // Zone d'incertitude
  let areaPath = "";
  data.forEach((d, i) => {
    areaPath += (i === 0 ? "M" : "L") + `${getX(i)},${getY(d.low)} `;
  });
  for (let i = data.length - 1; i >= 0; i--) {
    areaPath += `L${getX(i)},${getY(data[i].high)} `;
  }
  areaPath += "Z";

  const area = document.createElementNS(svgNs, "path");
  area.setAttribute("d", areaPath);
  area.setAttribute("fill", "var(--f-accent-dim)");
  g.appendChild(area);

  // Courbe principale
  let linePath = "";
  data.forEach((d, i) => {
    linePath += (i === 0 ? "M" : "L") + `${getX(i)},${getY(d.value)} `;
  });

  const line = document.createElementNS(svgNs, "path");
  line.setAttribute("d", linePath);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--f-accent)");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-dasharray", "4,4");
  g.appendChild(line);

  // Points & labels
  data.forEach((d, i) => {
    const cx = getX(i);
    const cy = getY(d.value);

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

    // Fiabilité sous la date, si dispo
    if (reliabilityByDate && reliabilityByDate[d.date] != null) {
      const rel = reliabilityByDate[d.date];
      const relTxt = document.createElementNS(svgNs, "text");
      relTxt.setAttribute("x", cx);
      relTxt.setAttribute("y", chartH + 34);
      relTxt.setAttribute("text-anchor", "middle");
      relTxt.setAttribute("fill", "var(--txt-secondary)");
      relTxt.setAttribute("font-size", "9");
      relTxt.setAttribute("font-family", "var(--font-mono)");
      relTxt.textContent = `${rel.toFixed(0)}%`;
      g.appendChild(relTxt);
    }
  });

  container.appendChild(svg);
}

/**
 * Vue backtest : trace Réel vs Prévu sur les X derniers jours
 * + petit tableau récapitulatif.
 */
function renderBacktest(series, els) {
  const container = els.backtestChart;
  const tbody = els.backtestTableBody;
  if (!container || !tbody) return;

  // On garde uniquement les jours avec une vraie prévision (pas le tout premier de chaque weekday)
  const usable = series.filter(d => d.prediction != null && !d.special);
  if (!usable.length) {
    container.innerHTML = '<p style="font-size:0.8rem;color:var(--txt-secondary);">Pas assez de données pour afficher le backtest.</p>';
    tbody.innerHTML = '';
    return;
  }

  // On limite à 30 derniers jours pour garder un graphe lisible
  const recent = usable.slice(-30);

  // ===== Graphe Réel vs Prévu =====
  container.innerHTML = '';

  const w = container.clientWidth || 600;
  const h = container.clientHeight || 220;
  const padding = { top: 35, right: 30, bottom: 45, left: 40 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const data = recent.map(d => ({
    date: d.date,
    label: formatChartDate(d.date),
    real: d.total,
    pred: d.prediction
  }));

  const allY = data.flatMap(d => [d.real, d.pred]);
  const minY = 0;
  const maxY = Math.max(...allY) * 1.2 || 1;

  const getX = (i) =>
    data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW;
  const getY = (v) =>
    chartH - ((v - minY) / (maxY - minY)) * chartH;

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  const g = document.createElementNS(svgNs, "g");
  g.setAttribute("transform", `translate(${padding.left}, ${padding.top})`);
  svg.appendChild(g);

  // Ligne RÉEL (pleine)
  let lineReal = "";
  data.forEach((d, i) => {
    lineReal += (i === 0 ? "M" : "L") + `${getX(i)},${getY(d.real)} `;
  });
  const pathReal = document.createElementNS(svgNs, "path");
  pathReal.setAttribute("d", lineReal);
  pathReal.setAttribute("fill", "none");
  pathReal.setAttribute("stroke", "var(--txt-secondary)");
  pathReal.setAttribute("stroke-width", "2");
  g.appendChild(pathReal);

  // Ligne PRÉVU (pointillée)
  let linePred = "";
  data.forEach((d, i) => {
    linePred += (i === 0 ? "M" : "L") + `${getX(i)},${getY(d.pred)} `;
  });
  const pathPred = document.createElementNS(svgNs, "path");
  pathPred.setAttribute("d", linePred);
  pathPred.setAttribute("fill", "none");
  pathPred.setAttribute("stroke", "var(--f-accent)");
  pathPred.setAttribute("stroke-width", "2");
  pathPred.setAttribute("stroke-dasharray", "4,4");
  g.appendChild(pathPred);

  // Points + labels de date
  data.forEach((d, i) => {
    const cx = getX(i);

    const realCircle = document.createElementNS(svgNs, "circle");
    realCircle.setAttribute("cx", cx);
    realCircle.setAttribute("cy", getY(d.real));
    realCircle.setAttribute("r", 3);
    realCircle.setAttribute("fill", "var(--txt-secondary)");
    g.appendChild(realCircle);

    const predCircle = document.createElementNS(svgNs, "circle");
    predCircle.setAttribute("cx", cx);
    predCircle.setAttribute("cy", getY(d.pred));
    predCircle.setAttribute("r", 3);
    predCircle.setAttribute("fill", "var(--bg-void)");
    predCircle.setAttribute("stroke", "var(--f-accent)");
    predCircle.setAttribute("stroke-width", "2");
    g.appendChild(predCircle);

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

  // ===== Tableau récap (en bas) =====

  const rowsHtml = recent
    .slice()          // on ne modifie pas l'original
    .reverse()        // on affiche le plus récent en haut
    .map(d => {
      const total = d.total;
      const pred = d.prediction;
      const diff = total - pred;                 // Réel - Prévu
      const absPct = total > 0 ? Math.abs(diff / total) * 100 : null;

      let rowClass = 'bt-row-ok';
      if (absPct != null) {
        if (absPct >= 40) rowClass = 'bt-row-bad';
        else if (absPct >= 20) rowClass = 'bt-row-warn';
      }

      const sign = diff > 0 ? '+' : '';
      const errPctTxt = absPct != null ? absPct.toFixed(1) + '%' : '--';

      return `
        <tr class="${rowClass}">
          <td>${formatDisplayDate(d.date, { day: '2-digit', month: '2-digit', weekday: 'short' })}</td>
          <td>${Math.round(total)}</td>
          <td>${Math.round(pred)}</td>
          <td>${sign}${Math.round(diff)}</td>
          <td>${errPctTxt}</td>
        </tr>
      `;
    })
    .join('');

  tbody.innerHTML = rowsHtml;
}

/**
 * Détail par créneau pour horizon = 1.
 */
function renderSlotDetail(dayData, errorStats, els) {
  const { date, total, slots, lower, upper } = dayData;
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

  const maxVal = Math.max(...slotData.map(d => d.value)) * 1.15 || 1;
  const barWidth = chartW / slotData.length;
  const getY = (v) => chartH - ((v / maxVal) * chartH);

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  const g = document.createElementNS(svgNs, "g");
  g.setAttribute("transform", `translate(${padding.left}, ${padding.top})`);
  svg.appendChild(g);

  // Écart-type du jour courant (dérivé de la fourchette [lower, upper])
  const dailyStdDev = Math.max(0, (upper || 0) - (total || 0));

  slotData.forEach((d, i) => {
    const x = i * barWidth;
    const y = getY(d.value);

    // On répartit l'incertitude du jour sur les créneaux au prorata du volume
    const slotError = total > 0 ? (dailyStdDev * (d.value / total)) : 0;
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

// Gestion de la modale d'info
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
