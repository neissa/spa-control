// Logique pure de lecture du spa (aucun réseau, aucun DOM). Chargé par index.html (classique) et par les tests (require).
var SpaView = (function () {
  // Copie de SpaStats.toC pour rester autonome : °F arrondi à l'entier (toF), puis °C arrondi à 0,5; null si 0/absent ou hors 32-140 °F.
  function toF(v) { v = Math.round(Number(v)); return !v || v < 32 || v > 140 ? null : v; }
  function toC(v) { var f = toF(v); return f == null ? null : Math.round((f - 32) * 5 / 9 * 2) / 2; }
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  var NAMES = { PUMP: 'Pompe', CIRCULATION_PUMP: 'Pompe de circulation', LIGHT: 'Lumière', BLOWER: 'Soufflerie', MISTER: 'Brumisateur', MICROSILK: 'Microsilk', AUX: 'Auxiliaire', OZONE: 'Ozone', FILTER: 'Filtre' };
  var KIND = { PUMP: 'pump', CIRCULATION_PUMP: 'pump', LIGHT: 'light' };
  var NEEDS_PORT = ['PUMP', 'LIGHT', 'BLOWER', 'MISTER', 'AUX'];
  var portOk = function (c) { return c.port != null && c.port !== '' && isFinite(Number(c.port)); };

  // Ignore les éléments qui ne sont pas des objets (données partielles de l'API).
  var objs = function (a) { return (Array.isArray(a) ? a : []).filter(function (x) { return x && typeof x === 'object'; }); };

  function components(state, labels) {
    labels = labels || {};
    var list = objs(state.components).filter(function (c) { return Object.hasOwn(NAMES, c.componentType); });
    var count = {}, seen = {};
    list.forEach(function (c) { count[c.componentType] = (count[c.componentType] || 0) + 1; });
    var out = list.map(function (c) {
      var t = c.componentType, i = seen[t] = (seen[t] || 0) + 1;
      var key = t + ':' + (c.port != null ? c.port : i - 1);
      return {
        key: key, type: t, kind: KIND[t] || 'other', comp: c,
        label: (Object.hasOwn(labels, key) && labels[key]) || NAMES[t] + (count[t] > 1 ? ' ' + i : ''),
        value: c.value == null ? null : c.value,
        on: !!c.value && c.value !== 'OFF' && c.value !== 'DISABLED'
      };
    });
    // Jamais de commande sur le mauvais composant : port requis absent, ou clé partagée par deux composants => ambigu, aucun contrôle.
    var keys = {};
    out.forEach(function (k) { keys[k.key] = (keys[k.key] || 0) + 1; });
    out.forEach(function (k) {
      k.ambiguous = (NEEDS_PORT.indexOf(k.type) >= 0 && !portOk(k.comp)) || keys[k.key] > 1;
      k.control = k.ambiguous ? null : control(k.comp);
    });
    return out;
  }

  // Contrôle proposé pour un composant : interrupteur (OFF + un état), bouton à niveaux (>= 3 états) ou rien. Même liste que SpaCmd.allOff + circulation exclue.
  var PILOT = ['PUMP', 'LIGHT', 'BLOWER', 'MISTER', 'AUX', 'MICROSILK'];
  function control(c) {
    if (!c || PILOT.indexOf(c.componentType) < 0 || c.value === 'DISABLED') return null;
    var av = (Array.isArray(c.availableValues) ? c.availableValues : []).filter(function (v) { return v !== 'DISABLED'; });
    if (av.indexOf('OFF') < 0 || av.length < 2) return null;
    return av.length === 2 ? { kind: 'switch', onValue: av.filter(function (v) { return v !== 'OFF'; })[0] } : { kind: 'cycle' };
  }

  function temps(state) {
    var p = state.setupParams || {};
    return {
      current: toC(state.currentTemp), set: toC(state.desiredTemp), setF: toF(state.desiredTemp),
      rangeF: { lowMin: toF(p.lowRangeLow), lowMax: toF(p.lowRangeHigh), highMin: toF(p.highRangeLow), highMax: toF(p.highRangeHigh) },
      range: { lowMin: toC(p.lowRangeLow), lowMax: toC(p.lowRangeHigh), highMin: toC(p.highRangeLow), highMax: toC(p.highRangeHigh) },
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
    var text = h == null || m == null ? '—' : military ? pad(h) + ':' + pad(m) : ((h % 12) || 12) + ':' + pad(m) + (h < 12 ? ' AM' : ' PM');
    // L'API renvoie year/month/day = 0 : on compare seulement hh:mm (secondes de now ignorées, donc écart entier), sur le cercle de 24 h, dans ]-720, 720].
    var drift = null;
    if (typeof h === 'number' && typeof m === 'number' && isFinite(h) && isFinite(m)) {
      var dn = new Date(now);
      drift = (((h * 60 + m - (dn.getHours() * 60 + dn.getMinutes())) % 1440) + 1440) % 1440;
      if (drift > 720) drift -= 1440;
    }
    var notSet = !!state.timeNotSet;
    return { text: text, military: military, notSet: notSet, driftMin: drift, drifted: notSet || (drift != null && Math.abs(drift) > toleranceMin) };
  }

  // Écart signé (min) -> texte lisible : négatif = horloge en retard.
  function driftText(d) {
    var a = Math.abs(d), t = a >= 60 ? Math.floor(a / 60) + ' h ' + (a % 60) + ' min' : a + ' min';
    return (d < 0 ? 'en retard de ' : 'en avance de ') + t;
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
      salesDate: n(i.salesDate), registrationDate: n(i.registrationDate), errorCode: n(state.errorCode), messages: objs(state.statusMessages)
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
    if (c.drifted) out.push({ level: 'warning', code: 'clock', text: c.notSet ? "L'horloge du spa n'est pas réglée." : "L'horloge du spa est " + driftText(c.driftMin) + ' : à corriger.' });
    objs(state.statusMessages).forEach(function (m) {
      var sev = String(m.severity || '').toUpperCase();
      if (sev === 'INFO') return;
      out.push({ level: sev === 'ERROR' || sev === 'CRITICAL' ? 'critical' : 'warning', code: 'msg:' + m.code, text: m.message });
    });
    return out;
  }

  return { toC: toC, toF: toF, driftText: driftText, components: components, control: control, temps: temps, ping: ping, clock: clock, heating: heating, tech: tech, schedules: schedules, alerts: alerts };
})();
if (typeof module !== 'undefined') module.exports = SpaView;
