// Logique pure de lecture du spa (aucun réseau, aucun DOM). Chargé par index.html (classique) et par les tests (require).
var SpaView = (function () {
  // Copie de SpaStats.toC pour rester autonome dans le navigateur comme sous node. 0 = pas de mesure.
  function toC(v, celsius) {
    v = Number(v); if (!v) return null;
    return Math.round((celsius ? v : (v - 32) * 5 / 9) * 10) / 10;
  }
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  var NAMES = { PUMP: 'Pompe', CIRCULATION_PUMP: 'Pompe de circulation', LIGHT: 'Lumière', BLOWER: 'Soufflerie', MISTER: 'Brumisateur', MICROSILK: 'Microsilk', AUX: 'Auxiliaire', OZONE: 'Ozone', FILTER: 'Filtre' };
  var KIND = { PUMP: 'pump', CIRCULATION_PUMP: 'pump', LIGHT: 'light' };

  function components(state, labels) {
    labels = labels || {};
    var list = (state.components || []).filter(function (c) { return NAMES[c.componentType]; });
    var count = {}, seen = {};
    list.forEach(function (c) { count[c.componentType] = (count[c.componentType] || 0) + 1; });
    return list.map(function (c) {
      var t = c.componentType, i = seen[t] = (seen[t] || 0) + 1;
      var key = t + ':' + (c.port != null ? c.port : i - 1);
      return {
        key: key, type: t, kind: KIND[t] || 'other',
        label: labels[key] || NAMES[t] + (count[t] > 1 ? ' ' + i : ''),
        value: c.value == null ? null : c.value,
        on: !!c.value && c.value !== 'OFF' && c.value !== 'DISABLED'
      };
    });
  }

  function temps(state) {
    var p = state.setupParams || {}, c = state.celsius;
    return {
      current: toC(state.currentTemp, c), set: toC(state.desiredTemp, c),
      range: { lowMin: toC(p.lowRangeLow, c), lowMax: toC(p.lowRangeHigh, c), highMin: toC(p.highRangeLow, c), highMax: toC(p.highRangeHigh, c) },
      rangeMode: state.tempRange
    };
  }

  function ping(state, now, maxMin) {
    if (maxMin == null) maxMin = 60;
    var t = [state.uplinkTimestamp, state.updatedAt].map(function (s) { return s ? new Date(s).getTime() : NaN; })
      .filter(function (x) { return !isNaN(x); });
    if (!t.length) return { lastSeen: null, ageMin: null, stale: true };
    var last = Math.max.apply(null, t), age = (new Date(now).getTime() - last) / 60000;
    return { lastSeen: new Date(last), ageMin: age, stale: age > maxMin };
  }

  // shortcut: hour est supposé en 24 h même si military=false (seul l'affichage change); à vérifier sur données réelles.
  function clock(state, now, toleranceMin) {
    if (toleranceMin == null) toleranceMin = 5;
    var h = state.hour, m = state.minute, military = !!state.military;
    var text = military ? pad(h) + ':' + pad(m) : ((h % 12) || 12) + ':' + pad(m) + (h < 12 ? ' AM' : ' PM');
    var drift = null;
    if (state.year != null && state.month != null && state.day != null && h != null && m != null) {
      drift = Math.round((new Date(state.year, state.month - 1, state.day, h, m).getTime() - new Date(now).getTime()) / 60000);
    }
    var notSet = !!state.timeNotSet;
    return { text: text, military: military, notSet: notSet, driftMin: drift, drifted: notSet || (drift != null && Math.abs(drift) > toleranceMin) };
  }

  function heating(state, c8z) {
    var s = c8z && c8z.c8zHeaterState != null ? c8z.c8zHeaterState : null;
    return { mode: state.heaterMode, range: state.tempRange, eco: state.ecoMode, c8zState: s, c8zStatus: c8z && c8z.c8zStatus != null ? c8z.c8zStatus : null, active: !!s && s !== 'OFF' };
  }

  function tech(state, spaInfo) {
    var si = state.systemInfo || {}, i = spaInfo || {};
    var n = function (v) { return v == null ? null : v; };
    return {
      serial: n(state.spaSerialNumber != null ? state.spaSerialNumber : i.serialNumber), model: n(i.modelType), dealer: n(i.dealerName), oem: n(i.oemName),
      controller: n(state.controllerType), firmware: n(si.controllerSoftwareVersion), gateway: n(i.buildNumber),
      salesDate: n(i.salesDate), registrationDate: n(i.registrationDate), errorCode: n(state.errorCode), messages: state.statusMessages || []
    };
  }

  var DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  // shortcut: jours numériques 0 = dimanche … 6 = samedi (à vérifier sur données réelles); les chaînes restent telles quelles.
  function schedules(list) {
    return (list || []).map(function (s) {
      var st = s.settings || {}, v = s.values || {};
      return {
        id: s._id, name: s.name, enabled: !!s.enabled, time: pad(st.hour || 0) + ':' + pad(st.minute || 0),
        days: (st.days || []).map(function (d) { return typeof d === 'number' ? DAYS[d] : d; }),
        timeZone: st.timeZone == null ? null : st.timeZone, setTemp: v.heaterTemp, heaterMode: v.heaterMode, tempRange: v.tempRange
      };
    }).sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  }

  function alerts(state, spaInfo, now, opts) {
    opts = opts || {};
    var out = [], p = ping(state, now, opts.maxPingMin), c = clock(state, now, opts.toleranceMin);
    if (p.stale) out.push({ level: 'warning', code: 'ping', text: p.lastSeen ? 'Aucun signal du spa depuis ' + Math.round(p.ageMin) + ' min.' : 'Aucun signal reçu du spa.' });
    if (state.online === false) out.push({ level: 'critical', code: 'offline', text: 'Le spa est hors ligne.' });
    if (state.errorCode) out.push({ level: 'critical', code: 'error', text: "Code d'erreur " + state.errorCode + '.' });
    if (c.drifted) out.push({ level: 'warning', code: 'clock', text: c.notSet ? "L'horloge du spa n'est pas réglée." : "L'horloge du spa est décalée de " + c.driftMin + ' min : à corriger.' });
    (state.statusMessages || []).forEach(function (m) {
      var sev = String(m.severity || '').toUpperCase();
      if (sev === 'INFO') return;
      out.push({ level: sev === 'ERROR' || sev === 'CRITICAL' ? 'critical' : 'warning', code: 'msg:' + m.code, text: m.message });
    });
    return out;
  }

  return { components: components, temps: temps, ping: ping, clock: clock, heating: heating, tech: tech, schedules: schedules, alerts: alerts };
})();
if (typeof module !== 'undefined') module.exports = SpaView;
