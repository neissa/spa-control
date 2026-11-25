// Logique pure de l'historique (aucun réseau, localStorage ni DOM). Chargé par index.html (classique) et par les tests (require).
// Températures : °F dans l'état, °C au 0,5 ici (même règle que SpaStats.toC, copiée pour rester autonome comme spa.js).
var SpaHist = (function () {
  var num = function (v) { return typeof v === 'number' && isFinite(v); };
  function toC(v) {
    v = Math.round(Number(v)); if (!v || v < 32 || v > 140) return null;
    return Math.round((v - 32) * 5 / 9 * 2) / 2;
  }
  var TYPES = ['PUMP', 'CIRCULATION_PUMP', 'LIGHT', 'BLOWER', 'MISTER', 'AUX', 'OZONE', 'FILTER'];
  var NAMES = { PUMP: 'Pompe', CIRCULATION_PUMP: 'Pompe de circulation', LIGHT: 'Lumière', BLOWER: 'Soufflerie', MISTER: 'Brumisateur', AUX: 'Auxiliaire', OZONE: 'Ozone', FILTER: 'Filtre' };
  var VAL = { OFF: 'Éteint', ON: 'Allumé', HIGH: 'Fort', MED: 'Moyen', MEDIUM: 'Moyen', LOW: 'Doux', DISABLED: 'Désactivé' };
  var MODE = { READY: 'Prêt', REST: 'Repos', READY_REST: 'Prêt en repos' };
  var RANGE = { LOW: 'Basse', HIGH: 'Haute' };
  var Z = { mode: { C8Z_MODE_DISABLED: 'Désactivée', C8Z_MODE_HEAT: 'Chauffage', C8Z_MODE_COOL: 'Froid', C8Z_MODE_BOTH: 'Chauffage et froid' }, speed: { C8Z_SPEED_SMART: 'Intelligente', C8Z_SPEED_SILENT: 'Silencieuse', C8Z_SPEED_POWERFUL: 'Puissante' }, heater: { C8Z_HEATER_DISABLED: 'Désactivé', C8Z_HEATER_AUTO: 'Automatique', C8Z_HEATER_CONTINUOUS: 'Continu', C8Z_HEATER_M7: 'E-Boost (M7)' } };
  var ZNAME = { mode: 'mode', speed: 'vitesse', heater: "chauffage d'appoint" };
  var ZKEYS = [['mode', 'c8zMode'], ['speed', 'c8zSpeed'], ['heater', 'c8zHeater']];
  var txt = function (v) { return typeof v === 'string' && v !== '' ? v : null; };
  var lbl = function (t, v) { return Object.hasOwn(t, v) ? t[v] : v; };

  // Valeurs suivies : mode de chauffe, plage, et valeur de chaque composant identifiable (clé « TYPE:port », comme SpaView.components).
  // Une clé portée par deux composants est ambiguë : ignorée (pas de faux changement).
  function snapshot(state, c8z) {
    state = state || {}; c8z = c8z && typeof c8z === 'object' ? c8z : {};
    var list = (Array.isArray(state.components) ? state.components : []).filter(function (c) { return c && typeof c === 'object' && TYPES.indexOf(c.componentType) >= 0; });
    var seen = {}, count = {}, comps = {};
    var keys = list.map(function (c) {
      var t = c.componentType, i = seen[t] = (seen[t] || 0) + 1, k = t + ':' + (c.port != null ? c.port : i - 1);
      count[k] = (count[k] || 0) + 1; return k;
    });
    list.forEach(function (c, j) { var v = txt(c.value); if (count[keys[j]] === 1 && v) comps[keys[j]] = v; });
    var z = {};
    ZKEYS.forEach(function (p) { var v = txt(c8z[p[1]]); if (v) z[p[0]] = v; });
    return { mode: txt(state.heaterMode), range: txt(state.tempRange), comps: comps, c8z: z };
  }

  // Conserve la dernière valeur connue d'un élément absent d'une réponse partielle.
  function merge(prev, next) {
    var p = prev && typeof prev === 'object' ? prev : {}, comps = {};
    Object.keys(p.comps && typeof p.comps === 'object' ? p.comps : {}).forEach(function (k) { if (txt(p.comps[k])) comps[k] = p.comps[k]; });
    Object.keys(next.comps).forEach(function (k) { comps[k] = next.comps[k]; });
    var pz = p.c8z && typeof p.c8z === 'object' ? p.c8z : {}, nz = next.c8z && typeof next.c8z === 'object' ? next.c8z : {}, z = {};
    ZKEYS.forEach(function (q) { var v = txt(nz[q[0]]) || txt(pz[q[0]]); if (v) z[q[0]] = v; });
    return { mode: next.mode || txt(p.mode), range: next.range || txt(p.range), comps: comps, c8z: z };
  }

  // Changements entre deux relevés. Premier relevé (prev nul) : rien. Valeur absente d'un côté : rien.
  function diff(prev, next, ts, spaId) {
    var out = [];
    if (!prev || typeof prev !== 'object' || !next || typeof next !== 'object') return out;
    var add = function (k, f, t) { if (txt(f) && txt(t) && f !== t) out.push({ ts: ts, spa: spaId, k: k, f: f, t: t }); };
    add('mode', prev.mode, next.mode); add('range', prev.range, next.range);
    var pc = prev.comps && typeof prev.comps === 'object' ? prev.comps : {}, nc = next.comps && typeof next.comps === 'object' ? next.comps : {};
    Object.keys(nc).forEach(function (k) { if (Object.hasOwn(pc, k)) add('comp:' + k, pc[k], nc[k]); });
    var pz = prev.c8z && typeof prev.c8z === 'object' ? prev.c8z : {}, nz = next.c8z && typeof next.c8z === 'object' ? next.c8z : {};
    ZKEYS.forEach(function (q) { add('c8z:' + q[0], pz[q[0]], nz[q[0]]); });
    return out;
  }

  // Point de courbe [ts, °C eau, °C consigne], ou null si ni l'une ni l'autre n'est lisible.
  function point(state, ts) {
    state = state || {};
    var t = toC(state.currentTemp), s = toC(state.desiredTemp);
    return t == null && s == null ? null : [ts, t, s];
  }
  function shouldRecord(last, p, minGapMs) {
    if (minGapMs == null) minGapMs = 300000;
    if (!Array.isArray(last) || !num(last[0])) return true;
    return p[0] - last[0] >= minGapMs || last[1] !== p[1] || last[2] !== p[2];
  }

  // Élague un tableau chronologique (points [ts,…] ou objets {ts}) : trop vieux, sans date valide, puis garde les maxLen derniers.
  var tsOf = function (x) { return Array.isArray(x) ? x[0] : x && typeof x === 'object' ? x.ts : NaN; };
  function prune(arr, now, maxAgeMs, maxLen) {
    var out = (Array.isArray(arr) ? arr : []).filter(function (x) { var t = tsOf(x); return num(t) && t >= now - maxAgeMs; });
    return out.length > maxLen ? out.slice(out.length - maxLen) : out;
  }
  var isChange = function (c) { return !!c && typeof c === 'object' && num(c.ts) && typeof c.k === 'string' && typeof c.spa === 'string'; };

  // Segments continus de la température (temp) et de la consigne (set) : [[ [ts,v], … ], …]. Une coupure > maxGapMs casse le trait.
  function series(points, fromTs, toTs, maxGapMs) {
    if (maxGapMs == null) maxGapMs = 900000;
    var pts = (Array.isArray(points) ? points : []).filter(function (p) { return Array.isArray(p) && num(p[0]) && p[0] >= fromTs && p[0] <= toTs; });
    function split(i) {
      var out = [], cur = null, last = 0;
      pts.forEach(function (p) {
        if (!num(p[i])) return;
        if (!cur || p[0] - last > maxGapMs) { cur = []; out.push(cur); }
        cur.push([p[0], p[i]]); last = p[0];
      });
      return out;
    }
    return { temp: split(1), set: split(2) };
  }

  // Bornes de l'axe Y : marge, arrondies au demi-degré, amplitude d'au moins 2 °C. null si aucune valeur.
  function extent(values) {
    var v = (Array.isArray(values) ? values : []).filter(num);
    if (!v.length) return null;
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), pad = Math.max(0.5, (hi - lo) * 0.1);
    var min = Math.floor((lo - pad) * 2) / 2, max = Math.ceil((hi + pad) * 2) / 2;
    if (max - min < 2) { min = Math.floor(((lo + hi) / 2 - 1) * 2) / 2; max = min + 2; }
    return { min: min, max: max };
  }

  // Intervalles [début, fin] où le composant est actif (ni OFF ni DISABLED). key : « comp:PUMP:1 » ou « PUMP:1 ».
  // État au début : dernier changement avant la fenêtre, sinon ancien état (f) du premier changement dedans, sinon snapshotAtStart; sinon inconnu => aucun intervalle (rien d'inventé).
  function bands(changes, snapshotAtStart, fromTs, toTs, key) {
    var full = key.indexOf('comp:') === 0 ? key : 'comp:' + key, ck = full.slice(5);
    var ch = (Array.isArray(changes) ? changes : []).filter(function (c) { return isChange(c) && c.k === full; }).sort(function (a, b) { return a.ts - b.ts; });
    var before = ch.filter(function (c) { return c.ts < fromTs; }), inWin = ch.filter(function (c) { return c.ts >= fromTs && c.ts <= toTs; });
    var state = null;
    if (before.length) state = before[before.length - 1].t;
    else if (inWin.length) state = inWin[0].f;
    else if (snapshotAtStart && snapshotAtStart.comps && Object.hasOwn(snapshotAtStart.comps, ck)) state = snapshotAtStart.comps[ck];
    var active = function (v) { return !!v && v !== 'OFF' && v !== 'DISABLED'; };
    if (state == null) return [];
    var out = [], start = active(state) ? fromTs : null;
    inWin.forEach(function (c) {
      if (active(c.t)) { if (start == null) start = c.ts; }
      else if (start != null) { out.push([start, c.ts]); start = null; }
    });
    if (start != null) out.push([start, toTs]);
    return out;
  }

  // Catégorie pour le filtre de la liste : mode, plage, pompes, lumière, autre.
  function kind(c) {
    var k = c && typeof c.k === 'string' ? c.k : '';
    if (k === 'mode' || k === 'range') return k;
    if (/^c8z:/.test(k)) return 'c8z';
    if (/^comp:(PUMP|CIRCULATION_PUMP):/.test(k)) return 'pump';
    if (/^comp:LIGHT:/.test(k)) return 'light';
    return 'other';
  }

  // « Pompe 2 : Éteint → Fort ». labelOf(« PUMP:2 ») -> nom affiché (noms personnalisés); sinon nom du type.
  function describe(c, labelOf) {
    var zm = /^c8z:(mode|speed|heater)$/.exec(c.k);
    if (zm) { var zl = function (v) { return Object.hasOwn(Z[zm[1]], v) ? Z[zm[1]][v] : 'valeur inconnue'; }; return 'Clim8Zone — ' + ZNAME[zm[1]] + ' : ' + zl(c.f) + ' → ' + zl(c.t); }
    var f = lbl(VAL, c.f), t = lbl(VAL, c.t);
    if (c.k === 'mode') return 'Mode de chauffe : ' + lbl(MODE, c.f) + ' → ' + lbl(MODE, c.t);
    if (c.k === 'range') return 'Plage : ' + lbl(RANGE, c.f) + ' → ' + lbl(RANGE, c.t);
    var ck = String(c.k).replace(/^comp:/, ''), m = /^([A-Z_]+):(.*)$/.exec(ck);
    var name = (labelOf && labelOf(ck)) || (m && Object.hasOwn(NAMES, m[1]) ? NAMES[m[1]] + (m[1] === 'LIGHT' || m[1] === 'CIRCULATION_PUMP' ? '' : ' ' + m[2]) : ck);
    return name + ' : ' + f + ' → ' + t;
  }

  return { snapshot: snapshot, merge: merge, diff: diff, point: point, shouldRecord: shouldRecord, prune: prune, isChange: isChange, series: series, extent: extent, bands: bands, kind: kind, describe: describe };
})();
if (typeof module !== 'undefined') module.exports = SpaHist;
