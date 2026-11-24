// Chargé par index.html (classique) et par les tests (require).
// shortcut: "pompe active" = un composant PUMP/CIRCULATION_PUMP/FILTER à ON/HIGH/LOW/MEDIUM; "chauffe" = c8zHeaterState != OFF. À vérifier sur données réelles.
var SpaStats = (function () {
  var ACTIVE = ['PUMP', 'CIRCULATION_PUMP', 'FILTER'], ON = ['ON', 'HIGH', 'LOW', 'MEDIUM'];

  // Toutes les températures de l'état sont en °F, quel que soit state.celsius (échelle d'affichage du panneau seulement).
  // °F arrondi à l'entier, converti, puis °C arrondi à 0,5 (51 °F => 10,5 ; 55 => 13,0).
  // null si 0/absent ou hors plage plausible (32-140 °F = 0-60 °C : « 262.00 » = sonde non lue).
  function toC(v) {
    v = Math.round(Number(v)); if (!v || v < 32 || v > 140) return null;
    return Math.round((v - 32) * 5 / 9 * 2) / 2;
  }

  // Réduit un état brut à ce qu'on stocke (localStorage ~5 Mo)
  function compact(state, c8z, ts) {
    return {
      ts: ts,
      online: !!state.online,
      running: (state.components || []).some(function (c) { return ACTIVE.indexOf(c.componentType) >= 0 && ON.indexOf(c.value) >= 0; }),
      heating: !!(c8z && c8z.c8zHeaterState && c8z.c8zHeaterState !== 'OFF'),
      temp: toC(state.currentTemp), set: toC(state.desiredTemp), err: state.errorCode
    };
  }

  // samples triés par ts; maxGapMs: au-delà l'intervalle est ignoré (page fermée)
  function runtimes(samples, maxGapMs) {
    var r = { onlineS: 0, offlineS: 0, runningS: 0, heatingS: 0, runningNoHeatS: 0 };
    for (var i = 0; i < samples.length - 1; i++) {
      var dt = samples[i + 1].ts - samples[i].ts; if (dt > maxGapMs) continue;
      var s = dt / 1000, x = samples[i];
      if (x.online) r.onlineS += s; else r.offlineS += s;
      if (x.running) r.runningS += s;
      if (x.heating) r.heatingS += s;
      if (x.running && !x.heating) r.runningNoHeatS += s;
    }
    return r;
  }
  return { compact: compact, runtimes: runtimes, toC: toC };
})();
if (typeof module !== 'undefined') module.exports = SpaStats;
