class ForecastEngine {
  constructor(options = {}) {
    this.alpha = options.alpha || 0.3; // Réactivité (0.3 = équilibré)
    this.history = [];                 
    this.byWeekday = {};               
    this.models = {
      dailyTrend: {},                  
      slotProfiles: {},                
      errorStats: { mae: 0, mape: 0, stdDev: 0, count: 0 }
    };
  }

  loadData(rawDays) {
    // Tri chronologique
    this.history = [...rawDays].sort((a, b) => new Date(a.date) - new Date(b.date));
    this._splitByWeekday();
    this._trainTrendsAndProfiles();
    this._computeErrorStats();
  }

  _splitByWeekday() {
    this.byWeekday = {};
    this.history.forEach(day => {
      if (!this.byWeekday[day.weekday]) this.byWeekday[day.weekday] = [];
      this.byWeekday[day.weekday].push(day);
    });
  }

  _trainTrendsAndProfiles() {
    const alpha = this.alpha;
    this.models.dailyTrend = {};
    this.models.slotProfiles = {};

    Object.entries(this.byWeekday).forEach(([wd, days]) => {
      // 1. Tendance (EWMA)
      let prev = null;
      days.forEach(d => {
        if (prev === null) {
          prev = d.total;
        } else {
          prev = alpha * d.total + (1 - alpha) * prev;
        }
      });
      this.models.dailyTrend[wd] = { level: prev };

      // 2. Profil par créneau (Moyenne des parts)
      const slotSums = {};
      let totalSum = 0;
      days.forEach(d => {
        Object.entries(d.slots).forEach(([slot, val]) => {
          const v = Number(val) || 0;
          if (!slotSums[slot]) slotSums[slot] = 0;
          slotSums[slot] += v;
          totalSum += v;
        });
      });

      const profile = {};
      if (totalSum > 0) {
        Object.entries(slotSums).forEach(([slot, v]) => {
          profile[slot] = v / totalSum;
        });
      }
      this.models.slotProfiles[wd] = profile;
    });
  }

  _computeErrorStats() {
    const residuals = [];
    const pctErrors = [];

    Object.entries(this.byWeekday).forEach(([wd, days]) => {
      let prev = null;
      days.forEach(d => {
        if (prev !== null) {
          const prediction = prev;
          const err = d.total - prediction;
          residuals.push(err);
          if (d.total > 0) pctErrors.push(Math.abs(err / d.total));
          prev = this.alpha * d.total + (1 - this.alpha) * prev;
        } else {
          prev = d.total;
        }
      });
    });

    if (residuals.length === 0) return;

    const n = residuals.length;
    const abs = residuals.map(e => Math.abs(e));
    const mae = abs.reduce((a, b) => a + b, 0) / n;
    const mape = pctErrors.length ? (pctErrors.reduce((a, b) => a + b, 0) / pctErrors.length) * 100 : 0;
    
    // Écart-type pour la marge d'erreur
    const mean = residuals.reduce((a, b) => a + b, 0) / n;
    const varSum = residuals.reduce((a, e) => a + Math.pow(e - mean, 2), 0);
    const stdDev = Math.sqrt(varSum / (n - 1));

    this.models.errorStats = { mae, mape, stdDev, count: n };
  }

  // === PRÉDICTIONS ===

  predictDay(dateObj) {
    const wd = dateObj.getDay();
    const trend = this.models.dailyTrend[wd]?.level || 0;
    const totalForecast = Math.max(0, trend);

    const { stdDev } = this.models.errorStats;
    const lower = Math.max(0, totalForecast - stdDev); // Marge basse (1 sigma)
    const upper = totalForecast + stdDev;              // Marge haute

    // Ventilation par slot
    const profile = this.models.slotProfiles[wd] || {};
    const slots = {};
    Object.entries(profile).forEach(([slot, p]) => {
      slots[slot] = totalForecast * p;
    });

    return { total: totalForecast, lower, upper, slots };
  }

  predictHorizon(startDate, horizonDays) {
    const out = [];
    for (let i = 0; i < horizonDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const pred = this.predictDay(d);
      out.push({
        date: d.toISOString().slice(0, 10),
        weekday: d.getDay(),
        ...pred
      });
    }
    return out;
  }

  getErrorStats() { return this.models.errorStats; }
  getHistoryLength() { return this.history.length; }
}

window.ForecastEngine = ForecastEngine;
