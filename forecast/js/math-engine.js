class ForecastEngine {
  constructor(options = {}) {
    this.alpha = options.alpha || 0.3; // Réactivité (0.3 = équilibré)

    // Historique complet (tous les jours, y compris spéciaux)
    this.history = [];

    // Historique utilisé pour l'entraînement (hors jours spéciaux)
    this.trainingHistory = [];

    // Jours normaux groupés par weekday (0=dimanche, ..., 6=samedi)
    this.byWeekday = {};

    // Optionnel : map JS de jours spéciaux passés à la construction
    // ex: { "2025-11-01": "ferie", "2025-11-29": "promo" }
    this.specialDayTags = options.specialDays || null;

    // Zones calendrier (config simple et explicite)
    this.calendarZones = [
      { name: 'richesse',  fromDay: 28,  toDay: 31  },
      { name: 'richesse', fromDay: 1,  toDay: 5 },
      { name: 'croisiere', fromDay: 6,  toDay: 20 },
      { name: 'economie',    fromDay: 21, toDay: 27 }
    ];

    this.models = {
      dailyTrend: {},          // { weekday: { level } }
      slotProfiles: {},        // { weekday: { slot: proportion } }
      errorStats: { mae: 0, mape: 0, stdDev: 0, count: 0 }, // global
      errorByWeekday: {},      // { weekday: { mae, mape, stdDev, count } }
      calendarBiasByZone: {}   // { zone: { biasPct, count } }
    };
  }

  /**
   * Détermine si un jour est "spécial" :
   * - si l'objet day a une propriété `special` non vide (provenant du JSON)
   * - ou si la date est présente dans `specialDayTags` passé en option
   */
  _isSpecialDay(day) {
    if (!day || !day.date) return false;

    // Flag direct dans l'historique (history.json)
    if (day.special && day.special !== 'none') return true;

    // Map passée côté JS (optionnel)
    if (this.specialDayTags && this.specialDayTags[day.date]) return true;

    return false;
  }

  /**
   * Retourne la zone calendrier pour une date ISO (YYYY-MM-DD) :
   * - "debut"  : J1 à J5
   * - "milieu" : J6 à J24
   * - "fin"    : J25 à J31
   */
  _getCalendarZone(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDate(); // 1..31

    for (const z of this.calendarZones) {
      if (day >= z.fromDay && day <= z.toDay) return z.name;
    }
    // Fallback théorique (ne devrait pas arriver)
    return 'milieu';
  }

  /**
   * Charge les données brutes (tableau de jours) et entraîne le modèle.
   * rawDays: [{ date, weekday?, total, slots, special? }, ...]
   */
  loadData(rawDays) {
    // Tri chronologique et stockage de l'historique complet
    this.history = [...rawDays].sort((a, b) => new Date(a.date) - new Date(b.date));

    // On définit l'historique d'entraînement = hors jours spéciaux
    this.trainingHistory = this.history.filter(day => !this._isSpecialDay(day));

    // Si, pour une raison quelconque, tout a été filtré, on fallback sur l'historique complet
    const base = this.trainingHistory.length > 0 ? this.trainingHistory : this.history;

    // Construction des structures par jour de semaine à partir de base
    this._splitByWeekday(base);
    this._trainTrendsAndProfiles();
    this._computeErrorStats();
  }

  /**
   * Regroupe les jours par weekday à partir d'une liste de jours.
   */
  _splitByWeekday(days) {
    this.byWeekday = {};
    days.forEach(day => {
      const wd = day.weekday;
      if (!this.byWeekday[wd]) this.byWeekday[wd] = [];
      this.byWeekday[wd].push(day);
    });
  }

  /**
   * Entraîne :
   * - la tendance (EWMA) par jour de semaine
   * - le profil horaire (répartition slots) par jour de semaine
   */
  _trainTrendsAndProfiles() {
    const alpha = this.alpha;
    this.models.dailyTrend = {};
    this.models.slotProfiles = {};

    Object.entries(this.byWeekday).forEach(([wd, days]) => {
      // 1. Tendance (EWMA) sur le total jour
      let prev = null;
      days.forEach(d => {
        const total = Number(d.total) || 0;
        if (prev === null) {
          prev = total;
        } else {
          prev = alpha * total + (1 - alpha) * prev;
        }
      });
      this.models.dailyTrend[wd] = { level: prev ?? 0 };

      // 2. Profil par créneau (moyenne des parts)
      const slotSums = {};
      let totalSum = 0;

      days.forEach(d => {
        if (!d.slots) return;
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

  /**
   * Calcule les stats d'erreurs (MAE, MAPE, stdDev) :
   * - par weekday -> this.models.errorByWeekday[wd]
   * - global -> this.models.errorStats
   * - biais calendaire par zone -> this.models.calendarBiasByZone[zone]
   *
   * On utilise un EWMA "one-step-ahead" par weekday.
   */
  _computeErrorStats() {
    const residualsByW = {};
    const pctErrorsByW = {};

    // Pour le calendaire : erreurs relatives signées par zone
    const signedPctByZone = {
      richesse: [],
      croisiere: [],
      economie: []
    };

    // On calcule les résidus (erreurs) séparément par weekday
    Object.entries(this.byWeekday).forEach(([wd, days]) => {
      residualsByW[wd] = [];
      pctErrorsByW[wd] = [];
      let prev = null;

      days.forEach(d => {
        const total = Number(d.total) || 0;
        if (prev !== null) {
          const prediction = prev;
          const err = total - prediction;
          residualsByW[wd].push(err);

          if (total > 0) {
            // Erreur relative absolue (pour MAPE / fiabilité globale)
            pctErrorsByW[wd].push(Math.abs(err / total));

            // Erreur relative signée (pour le biais calendaire)
            const signedPct = err / total; // >0 = modèle sous-prédit, <0 = sur-prédit
            const zone = this._getCalendarZone(d.date);
            if (!signedPctByZone[zone]) signedPctByZone[zone] = [];
            signedPctByZone[zone].push(signedPct);
          }

          prev = this.alpha * total + (1 - this.alpha) * prev;
        } else {
          prev = total;
        }
      });
    });

    this.models.errorByWeekday = {};
    const allResiduals = [];
    const allPctErrors = [];

    const computeStats = (residuals, pctErrors) => {
      const n = residuals.length;
      if (n === 0) return { mae: 0, mape: 0, stdDev: 0, count: 0 };

      const abs = residuals.map(e => Math.abs(e));
      const mae = abs.reduce((a, b) => a + b, 0) / n;

      const mape = pctErrors.length
        ? (pctErrors.reduce((a, b) => a + b, 0) / pctErrors.length) * 100
        : 0;

      const mean = residuals.reduce((a, b) => a + b, 0) / n;
      const varSum = residuals.reduce((a, e) => a + Math.pow(e - mean, 2), 0);
      const stdDev = Math.sqrt(varSum / (n > 1 ? (n - 1) : 1));

      return { mae, mape, stdDev, count: n };
    };

    // Stats par weekday + agrégation globale
    Object.entries(residualsByW).forEach(([wd, resids]) => {
      const pct = pctErrorsByW[wd] || [];
      const stats = computeStats(resids, pct);
      this.models.errorByWeekday[wd] = stats;
      allResiduals.push(...resids);
      allPctErrors.push(...pct);
    });

    // Stats globales (tous weekdays confondus) – pour le deck, compat getErrorStats()
    const globalStats = computeStats(allResiduals, allPctErrors);
    this.models.errorStats = globalStats;

    // === Biais calendaire par zone (début / milieu / fin de mois) ===
    const computeZoneStats = (arr) => {
      const n = arr.length;
      if (n === 0) return { biasPct: 0, count: 0 };
      const mean = arr.reduce((a, b) => a + b, 0) / n; // moyenne d'err/total
      return { biasPct: mean * 100, count: n };        // en pourcentage
    };

    this.models.calendarBiasByZone = {
      richesse:  computeZoneStats(signedPctByZone.richesse  || []),
      croisiere: computeZoneStats(signedPctByZone.croisiere || []),
      economie:  computeZoneStats(signedPctByZone.economie  || [])
    };
  }

  /**
   * Retourne les stats d'erreurs pour un weekday donné.
   * Fallback sur les stats globales si pas assez de données.
   */
  getErrorStatsForWeekday(weekday) {
    const key = String(weekday);
    const stats = this.models.errorByWeekday[key];
    if (stats && stats.count > 0) return stats;
    return this.models.errorStats;
  }

  /**
   * Résumé des biais calendaires par zone.
   * Retourne un objet du type :
   * {
   *   debut:  { biasPct: +8.3,  count: 12 },
   *   milieu: { biasPct: -1.2,  count: 45 },
   *   fin:    { biasPct: -5.0,  count: 10 }
   * }
   */
  getCalendarBiasSummary() {
    return this.models.calendarBiasByZone || {};
  }

    // === BACKTEST (rejeu de l'historique en "one-step-ahead") ===

  /**
   * Rejoue l'historique comme si on était "dans le passé"
   * et renvoie, pour chaque jour utilisé dans l'entraînement,
   * la prévision que le modèle aurait faite AVANT de connaître la vraie valeur.
   *
   * Retourne un tableau d'objets :
   * {
   *   date: "YYYY-MM-DD",
   *   weekday: 0..6,
   *   total: valeur réelle du jour,
   *   prediction: valeur prévue (null pour le tout premier lundi/mardi/etc),
   *   error: total - prediction (ou null si prediction null),
   *   absError: |error|,
   *   absPctError: |error| / total (ou null si total = 0),
   *   special: tag éventuel (si présent dans l'historique),
   *   calendarZone: "richesse" / "croisiere" / "economie"
   * }
   */
  getBacktestSeries() {
    // Si le modèle n'a pas encore été entraîné, on ne peut rien faire
    if (!this.byWeekday || Object.keys(this.byWeekday).length === 0) {
      return [];
    }

    const alpha = this.alpha;

    // On va reconstituer les prévisions "one-step-ahead" par weekday,
    // exactement comme dans _computeErrorStats(), mais cette fois on garde
    // les valeurs jour par jour.
    const rows = [];

    Object.entries(this.byWeekday).forEach(([wd, days]) => {
      let prev = null; // niveau EWMA pour ce weekday

      // IMPORTANT : "days" est déjà trié chronologiquement (car base l'était)
      days.forEach(d => {
        const total = Number(d.total) || 0;
        let prediction = null;
        let error = null;
        let absError = null;
        let absPctError = null;

        // Si prev n'est pas null, on a une prévision "one-step-ahead"
        if (prev !== null) {
          prediction = prev;
          error = total - prediction;
          absError = Math.abs(error);
          if (total > 0) {
            absPctError = Math.abs(error / total);
          }
        }

        // Mise à jour de prev avec la vraie valeur (comme dans _computeErrorStats)
        if (prev === null) {
          prev = total;
        } else {
          prev = alpha * total + (1 - alpha) * prev;
        }

        rows.push({
          date: d.date,
          weekday: d.weekday,
          total,
          prediction,
          error,
          absError,
          absPctError,
          special: d.special || null,
          calendarZone: this._getCalendarZone(d.date)
        });
      });
    });

    // Pour que ce soit exploitable facilement en UI, on trie tout par date croissante
    rows.sort((a, b) => new Date(a.date) - new Date(b.date));

    return rows;
  }

  /**
   * Raccourci : renvoie le backtest pour une date précise (YYYY-MM-DD),
   * ou null si cette date n'est pas dans l'historique utilisé.
   */
  getBacktestForDate(dateStr) {
    const series = this.getBacktestSeries();
    return series.find(d => d.date === dateStr) || null;
  }


  // === PRÉDICTIONS ===

  predictDay(dateObj) {
    const wd = dateObj.getDay();
    const trend = this.models.dailyTrend[wd]?.level || 0;
    const totalForecast = Math.max(0, trend);

    // Utilise l'écart-type du weekday (ou global en fallback)
    const stats = this.getErrorStatsForWeekday(wd);
    const stdDev = stats.stdDev || 0;

    const lower = Math.max(0, totalForecast - stdDev); // Marge basse (1 sigma)
    const upper = totalForecast + stdDev;              // Marge haute

    // Ventilation par slot via le profil de ce weekday
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

  getErrorStats() {
    // Compat totale avec l'existant : le deck continue d'utiliser le global
    return this.models.errorStats;
  }

  // Nombre de jours dans l'historique complet (affichage UI)
  getHistoryLength() {
    return this.history.length;
  }

  // Optionnel : nombre de jours utilisés réellement pour entraîner le modèle
  getTrainingLength() {
    return this.trainingHistory.length;
  }
}

window.ForecastEngine = ForecastEngine;