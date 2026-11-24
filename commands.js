// Constructeurs purs de commandes spa (aucun réseau, aucun DOM) : chaque fonction renvoie {path, body}
// (path relatif à /spa-commands) ou lève une Error en français. Spécification : docs/API.md. Les commandes de programme renvoient {method, path, body} (chemin complet depuis /web). POST non testés sur un vrai spa.
var SpaCmd = (function () {
  var PUMPS = { PUMP: 1, CIRCULATION_PUMP: 1 }; // OFF toujours accepté et cycle complet (essais réels sur jet)
  var API = { PUMP: 'jet', CIRCULATION_PUMP: 'circ-pump', LIGHT: 'light', BLOWER: 'blower', MISTER: 'mister', MICROSILK: 'microsilk', AUX: 'aux', OZONE: 'ozone' };
  var NEEDS_DEVICE = { PUMP: 1, LIGHT: 1, BLOWER: 1, MISTER: 1, AUX: 1 };
  var ORDER = ['OFF', 'LOW', 'MED', 'HIGH', 'ON'];
  var HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  function req(spaId, path, extra) {
    if (typeof spaId !== 'string' || !spaId) throw new Error('Identifiant du spa manquant.');
    var body = { spaId: spaId, via: 'WEB' };
    for (var k in extra) body[k] = extra[k];
    return { path: path, body: body };
  }
  function oneOf(v, list, what) {
    if (list.indexOf(v) < 0) throw new Error(what + ' invalide : « ' + v + ' » (attendu : ' + list.join(', ') + ').');
    return v;
  }

  function component(spaId, comp, target) {
    if (!comp || typeof comp !== 'object') throw new Error('Composant manquant.');
    var t = comp.componentType, api = Object.hasOwn(API, t) ? API[t] : null;
    if (!api) throw new Error('Le composant « ' + t + ' » ne se pilote pas.');
    var av = Array.isArray(comp.availableValues) ? comp.availableValues.filter(function (v) { return v !== 'DISABLED'; }) : [];
    if (t === 'PUMP' && target === 'ON' && av.indexOf('ON') < 0 && av.indexOf('HIGH') >= 0) target = 'HIGH';
    // Essai réel (24/11/2026) : OFF éteint toute pompe même si availableValues n'est que LOW/HIGH. Les autres composants restent stricts.
    if (av.indexOf(target) < 0 && !(PUMPS[t] && target === 'OFF')) throw new Error('État « ' + target + ' » non disponible pour ' + t + ' (disponibles : ' + (av.join(', ') || 'aucun') + ').');
    var extra = { componentType: api, state: target };
    if (NEEDS_DEVICE[t]) {
      var n = comp.port == null || comp.port === '' ? NaN : Number(comp.port);
      if (!isFinite(n)) throw new Error('Port manquant pour ' + t + '.');
      extra.deviceNumber = n;
    }
    return req(spaId, '/component-state', extra);
  }

  // Cycle dans availableValues (hors DISABLED), du plus faible au plus fort, puis retour à OFF.
  // Pompe : OFF est toujours dans le cycle (OFF -> LOW, car HIGH demandé depuis l'arrêt n'a rien fait lors des essais réels).
  function nextState(comp) {
    var av = comp && Array.isArray(comp.availableValues) ? comp.availableValues : [];
    if (comp && PUMPS[comp.componentType]) av = av.concat('OFF');
    var list = ORDER.filter(function (v) { return av.indexOf(v) >= 0; });
    if (list.length < 2) throw new Error('Aucun état suivant possible.');
    return list[(list.indexOf(comp.value) + 1) % list.length]; // valeur inconnue (-1) => list[0] (OFF)
  }

  // Consigne en °F ENTIERS (comme le portail). Bornes de la plage active (setupParams, toujours en °F) puis plafond absolu 50-104 °F (10-40 °C).
  function temperatureF(spaId, f, state) {
    if (typeof f !== 'number' || !isFinite(f) || Math.round(f) !== f) throw new Error('Consigne invalide : entier en °F attendu.');
    var p = (state && state.setupParams) || {}, lo, hi;
    if (state && state.tempRange === 'LOW') { lo = p.lowRangeLow; hi = p.lowRangeHigh; }
    else if (state && state.tempRange === 'HIGH') { lo = p.highRangeLow; hi = p.highRangeHigh; }
    lo = Math.round(Number(lo)); hi = Math.round(Number(hi));
    if (!lo || !hi) throw new Error('Plage de température du spa inconnue.');
    if (f < lo || f > hi) throw new Error('Consigne ' + f + ' °F hors plage (' + lo + '–' + hi + ' °F).');
    if (f < 50 || f > 104) throw new Error('Consigne ' + f + ' °F refusée : limite absolue 50–104 °F (10–40 °C).');
    return req(spaId, '/temperature/value', { value: f });
  }
  function temperature(spaId, celsius, state) {
    if (typeof celsius !== 'number' || !isFinite(celsius)) throw new Error('Consigne invalide : nombre attendu.');
    return temperatureF(spaId, Math.round(celsius * 9 / 5 + 32), state);
  }

  function heaterMode(spaId, mode) { return req(spaId, '/temperature/heater-mode', { mode: oneOf(mode, ['READY', 'REST', 'READY_REST'], 'Mode') }); }
  function range(spaId, r) { return req(spaId, '/temperature/range', { range: oneOf(r, ['HIGH', 'LOW'], 'Plage') }); }
  function panel(spaId, locked) {
    if (typeof locked !== 'boolean') throw new Error('Verrouillage : booléen attendu.');
    return req(spaId, '/panel/state', { state: locked ? 'LOCK_PANEL' : 'UNLOCK_PANEL' });
  }
  function scale(spaId, s) { return req(spaId, '/temperature/scale', { scale: oneOf(s, ['CELSIUS', 'FAHRENHEIT'], 'Échelle') }); }
  function tempLock(spaId, locked) { // non vérifié sur un vrai spa
    if (typeof locked !== 'boolean') throw new Error('Verrouillage : booléen attendu.');
    var r = req(spaId, '/panel/state', { state: locked ? 'LOCK_TEMP_SETTING' : 'UNLOCK_TEMP_SETTING' });
    r.unverified = true;
    return r;
  }
  function filter2(spaId, on) {
    if (typeof on !== 'boolean') throw new Error('Filtre 2 : booléen attendu.');
    return req(spaId, '/filter-cycles/toggle-filter2-state', { state: on ? 'ON' : 'OFF' });
  }

  function timeFormat(spaId, state, military) {
    if (!state || state.hour == null || state.minute == null) throw new Error('Heure du spa absente : format impossible à changer.');
    if (typeof military !== 'boolean') throw new Error('Format 24 h : booléen attendu.');
    return time(spaId, pad(state.hour) + ':' + pad(state.minute), military);
  }
  // Format `HH:MM` 24 h confirmé par le portail (capture du 24/11/2026), mais sans effet observé sur le spa …0009 : reste signalé « expérimental » dans l'interface.
  function time(spaId, hhmm, military) {
    if (typeof hhmm !== 'string' || !HHMM.test(hhmm)) throw new Error('Heure invalide (HH:MM attendu).');
    if (typeof military !== 'boolean') throw new Error('Format 24 h : booléen attendu.');
    var r = req(spaId, '/time', { time: hhmm, isMilitaryFormat: military });
    r.unverified = true;
    return r;
  }

  function filterCycle(spaId, filterComp, startHHMM, hours) {
    if (!filterComp || filterComp.componentType !== 'FILTER') throw new Error("Ce composant n'est pas un filtre.");
    var n = filterComp.port == null || filterComp.port === '' ? NaN : Number(filterComp.port);
    if (!isFinite(n)) throw new Error('Port manquant pour le filtre.');
    if (typeof startHHMM !== 'string' || !HHMM.test(startHHMM)) throw new Error('Heure de début invalide (HH:MM attendu).');
    if (typeof hours !== 'number' || !(hours >= 0.25 && hours <= 24)) throw new Error('Durée invalide (0,25 à 24 h).');
    var r = req(spaId, '/filter-cycles/schedule', { deviceNumber: n, numOfIntervals: Math.round(hours * 4), time: startHHMM });
    // numOfIntervals = minutes / 15 (60 min = 4), confirmé par le portail; sans effet observé sur le spa …0009.
    r.unverified = true;
    return r;
  }

  // ---- Programmes (/spa-schedules, chemin complet depuis /web, renvoie {method, path, body}). Spécification : docs/API.md « Requêtes capturées ». ----
  var SID = /^[0-9a-f]{24}$/i;
  function schedId(id) {
    if (typeof id !== 'string' || !SID.test(id)) throw new Error('Identifiant de programme invalide.');
    return encodeURIComponent(id);
  }
  function schedParts(p) {
    if (!p || typeof p !== 'object') throw new Error('Programme manquant.');
    var name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) throw new Error('Nom du programme requis.');
    if (name.length > 40) throw new Error('Nom trop long (40 caractères maximum).');
    var days = Array.isArray(p.days) ? p.days : [];
    if (!days.length || !days.every(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; })) throw new Error('Choisissez au moins un jour (0 = dimanche à 6 = samedi).');
    days = days.filter(function (d, i) { return days.indexOf(d) === i; }).sort(function (a, b) { return a - b; });
    if (!Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23) throw new Error('Heure invalide (0 à 23).');
    if (!Number.isInteger(p.minute) || p.minute < 0 || p.minute > 59) throw new Error('Minute invalide (0 à 59).');
    oneOf(p.mode, ['READY', 'REST'], 'Mode');
    if (typeof p.tempC !== 'number' || !isFinite(p.tempC) || p.tempC < 10 || p.tempC > 40) throw new Error('Consigne du programme : 10 à 40 °C.');
    return { name: name, values: { heaterTemp: Math.round(p.tempC * 9 / 5 + 32), heaterMode: p.mode }, settings: { days: days, hour: p.hour, minute: p.minute } };
  }
  function scheduleCreate(spaId, p) {
    if (typeof spaId !== 'string' || !spaId) throw new Error('Identifiant du spa manquant.');
    var b = schedParts(p);
    return { method: 'POST', path: '/spa-schedules', body: { spaId: spaId, name: b.name, values: b.values, settings: b.settings, enabled: true } };
  }
  function scheduleUpdate(id, p) { var q = schedId(id), b = schedParts(p); return { method: 'PATCH', path: '/spa-schedules/' + q, body: b }; }
  function scheduleTrigger(id) { return { method: 'POST', path: '/spa-schedules/' + schedId(id) + '/trigger', body: {} }; }
  function scheduleDelete(id) { return { method: 'DELETE', path: '/spa-schedules/' + schedId(id), body: null }; }

  // Éteint seulement les équipements de confort. Jamais CIRCULATION_PUMP (pilotable seule, mais la couper coupe aussi la filtration : choix délibéré),
  // ni OZONE, FILTER, HEATER : systèmes automatiques (filtration, désinfection, chauffe) qu'on ne coupe pas d'un clic.
  // Renvoie {requests, skipped}: un composant allumé qui ne peut pas être éteint (pas de OFF sauf pompe, toujours éteignable, port manquant, même port
  // qu'un autre) est SAUTÉ et listé dans skipped [{label, reason}]; chaque requête porte .comp (le composant visé).
  function allOff(spaId, state, labelOf) {
    if (typeof spaId !== 'string' || !spaId) throw new Error('Identifiant du spa manquant.');
    var list = (state && Array.isArray(state.components) ? state.components : []).filter(function (c) { return c && typeof c === 'object'; });
    var same = {};
    list.forEach(function (c) { var k = c.componentType + ':' + c.port; same[k] = (same[k] || 0) + 1; });
    var requests = [], skipped = [];
    list.forEach(function (c) {
      if (['PUMP', 'LIGHT', 'BLOWER', 'MISTER', 'AUX', 'MICROSILK'].indexOf(c.componentType) < 0 || !c.value || c.value === 'OFF' || c.value === 'DISABLED') return;
      var label = labelOf ? labelOf(c) : c.componentType + (c.port != null ? ' ' + c.port : '');
      if (same[c.componentType + ':' + c.port] > 1) return skipped.push({ label: label, reason: 'composant ambigu (même port)' });
      var av = Array.isArray(c.availableValues) ? c.availableValues : [];
      if (av.indexOf('OFF') < 0 && c.componentType !== 'PUMP') return skipped.push({ label: label, reason: "pas d'état Éteint disponible" });
      if (NEEDS_DEVICE[c.componentType] && (c.port == null || c.port === '' || !isFinite(Number(c.port)))) return skipped.push({ label: label, reason: 'port manquant' });
      try { var r = component(spaId, c, 'OFF'); r.comp = c; requests.push(r); }
      catch (e) { skipped.push({ label: label, reason: e.message }); }
    });
    return { requests: requests, skipped: skipped };
  }

  // Ne bloque que sur l'absence d'état ou le spa hors ligne (pas sur panelLock). À appeler avant tout envoi.
  function guard(state) {
    if (!state) return { ok: false, reason: 'état du spa indisponible' };
    if (!state.online) return { ok: false, reason: 'spa hors ligne' };
    return { ok: true, reason: null };
  }

  return { component: component, nextState: nextState, temperature: temperature, temperatureF: temperatureF, heaterMode: heaterMode, range: range, panel: panel, tempLock: tempLock, time: time, scheduleCreate: scheduleCreate, scheduleUpdate: scheduleUpdate, scheduleTrigger: scheduleTrigger, scheduleDelete: scheduleDelete, scale: scale, filter2: filter2, timeFormat: timeFormat, filterCycle: filterCycle, allOff: allOff, guard: guard };
})();
if (typeof module !== 'undefined') module.exports = SpaCmd;
