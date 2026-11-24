// Constructeurs purs de commandes spa (aucun réseau, aucun DOM) : chaque fonction renvoie {path, body}
// (path relatif à /spa-commands) ou lève une Error en français. Spécification : docs/API.md. POST non testés sur un vrai spa.
var SpaCmd = (function () {
  var API = { PUMP: 'jet', CIRCULATION_PUMP: 'circ-pump', LIGHT: 'light', BLOWER: 'blower', MISTER: 'mister', MICROSILK: 'microsilk', AUX: 'aux', OZONE: 'ozone' };
  var NEEDS_DEVICE = { PUMP: 1, LIGHT: 1, BLOWER: 1, MISTER: 1, AUX: 1 };
  var ORDER = ['OFF', 'LOW', 'MED', 'HIGH', 'ON'];
  var HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var r1 = function (x) { return Math.round(x * 10) / 10; };

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
    if (av.indexOf(target) < 0) throw new Error('État « ' + target + ' » non disponible pour ' + t + ' (disponibles : ' + (av.join(', ') || 'aucun') + ').');
    var extra = { componentType: api, state: target };
    if (NEEDS_DEVICE[t]) {
      var n = comp.port == null || comp.port === '' ? NaN : Number(comp.port);
      if (!isFinite(n)) throw new Error('Port manquant pour ' + t + '.');
      extra.deviceNumber = n;
    }
    return req(spaId, '/component-state', extra);
  }

  // Cycle dans availableValues (hors DISABLED), du plus faible au plus fort, puis retour à OFF.
  function nextState(comp) {
    var av = comp && Array.isArray(comp.availableValues) ? comp.availableValues : [];
    var list = ORDER.filter(function (v) { return av.indexOf(v) >= 0; });
    if (list.length < 2) throw new Error('Aucun état suivant possible.');
    return list[(list.indexOf(comp.value) + 1) % list.length]; // valeur inconnue (-1) => list[0] (OFF)
  }

  function temperature(spaId, celsius, state) {
    if (typeof celsius !== 'number' || !isFinite(celsius)) throw new Error('Consigne invalide : nombre attendu.');
    var c = Math.round(celsius * 2) / 2;
    var p = (state && state.setupParams) || {}, lo, hi;
    if (state && state.tempRange === 'LOW') { lo = p.lowRangeLow; hi = p.lowRangeHigh; }
    else if (state && state.tempRange === 'HIGH') { lo = p.highRangeLow; hi = p.highRangeHigh; }
    lo = Number(lo); hi = Number(hi);
    if (!lo || !hi) throw new Error('Plage de température du spa inconnue.');
    if (state.celsius === false) { lo = (lo - 32) * 5 / 9; hi = (hi - 32) * 5 / 9; }
    if (c < lo - 0.1 || c > hi + 0.1) throw new Error('Consigne ' + c + ' °C hors plage (' + r1(lo) + '–' + r1(hi) + ' °C).');
    return req(spaId, '/temperature/value', { value: r1(c * 9 / 5 + 32) });
  }

  function heaterMode(spaId, mode) { return req(spaId, '/temperature/heater-mode', { mode: oneOf(mode, ['READY', 'REST', 'READY_REST'], 'Mode') }); }
  function range(spaId, r) { return req(spaId, '/temperature/range', { range: oneOf(r, ['HIGH', 'LOW'], 'Plage') }); }
  function panel(spaId, locked) {
    if (typeof locked !== 'boolean') throw new Error('Verrouillage : booléen attendu.');
    return req(spaId, '/panel/state', { state: locked ? 'LOCK_PANEL' : 'UNLOCK_PANEL' });
  }
  function scale(spaId, s) { return req(spaId, '/temperature/scale', { scale: oneOf(s, ['CELSIUS', 'FAHRENHEIT'], 'Échelle') }); }
  function filter2(spaId, on) {
    if (typeof on !== 'boolean') throw new Error('Filtre 2 : booléen attendu.');
    return req(spaId, '/filter-cycles/toggle-filter2-state', { state: on ? 'ON' : 'OFF' });
  }

  function timeFormat(spaId, state, military) {
    if (!state || state.hour == null || state.minute == null) throw new Error('Heure du spa absente : format impossible à changer.');
    if (typeof military !== 'boolean') throw new Error('Format 24 h : booléen attendu.');
    var r = req(spaId, '/time', { time: pad(state.hour) + ':' + pad(state.minute), isMilitaryFormat: military });
    // shortcut: format de `time` (HH:MM) non confirmé par le portail; à vérifier sur un vrai spa avant usage.
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
    // shortcut: numOfIntervals = tranches de 15 min (hours*4) est une hypothèse non confirmée; à vérifier sur un vrai spa.
    r.unverified = true;
    return r;
  }

  // Éteint seulement les équipements de confort. Jamais CIRCULATION_PUMP, OZONE, FILTER, HEATER :
  // ce sont des systèmes automatiques (filtration, désinfection, chauffe) qu'on ne coupe pas d'un clic.
  function allOff(spaId, state) {
    var list = state && Array.isArray(state.components) ? state.components : [];
    return list.filter(function (c) {
      return c && ['PUMP', 'LIGHT', 'BLOWER', 'MISTER', 'AUX', 'MICROSILK'].indexOf(c.componentType) >= 0 && c.value && c.value !== 'OFF' && c.value !== 'DISABLED';
    }).map(function (c) { return component(spaId, c, 'OFF'); });
  }

  // Ne bloque que sur l'absence d'état ou le spa hors ligne (pas sur panelLock). À appeler avant tout envoi.
  function guard(state) {
    if (!state) return { ok: false, reason: 'état du spa indisponible' };
    if (!state.online) return { ok: false, reason: 'spa hors ligne' };
    return { ok: true, reason: null };
  }

  return { component: component, nextState: nextState, temperature: temperature, heaterMode: heaterMode, range: range, panel: panel, scale: scale, filter2: filter2, timeFormat: timeFormat, filterCycle: filterCycle, allOff: allOff, guard: guard };
})();
if (typeof module !== 'undefined') module.exports = SpaCmd;
