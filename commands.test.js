const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./commands.js');

const ID = 'spa-test-1';
const B = (path, extra) => ({ path, body: Object.assign({ spaId: ID, via: 'WEB' }, extra) });
const pump = { componentType: 'PUMP', port: '1', value: 'OFF', availableValues: ['OFF', 'LOW', 'HIGH'] };
const st = (o) => Object.assign({
  online: true, celsius: true, tempRange: 'HIGH', hour: 7, minute: 5,
  setupParams: { lowRangeLow: 50, lowRangeHigh: 99, highRangeLow: 80, highRangeHigh: 104 }, components: [] // bornes toujours en °F
}, o);

test('component: URL et corps exacts', () => {
  assert.deepEqual(C.component(ID, pump, 'LOW'), B('/component-state', { componentType: 'jet', state: 'LOW', deviceNumber: 1 }));
  const light = { componentType: 'LIGHT', port: 0, availableValues: ['OFF', 'ON'] };
  assert.deepEqual(C.component(ID, light, 'ON'), B('/component-state', { componentType: 'light', state: 'ON', deviceNumber: 0 }));
  const circ = { componentType: 'CIRCULATION_PUMP', port: '0', availableValues: ['OFF', 'ON'] };
  assert.deepEqual(C.component(ID, circ, 'OFF'), B('/component-state', { componentType: 'circ-pump', state: 'OFF' }));
  assert.equal(C.component(ID, { componentType: 'OZONE', availableValues: ['OFF', 'ON'] }, 'ON').body.componentType, 'ozone');
});

test('component: circulation sans deviceNumber, OFF toujours accepté, cycle OFF/LOW/HIGH', () => {
  const c3 = { componentType: 'CIRCULATION_PUMP', port: null, value: 'OFF', availableValues: ['OFF', 'LOW', 'HIGH'] };
  assert.deepEqual(C.component(ID, c3, 'LOW'), B('/component-state', { componentType: 'circ-pump', state: 'LOW' }));
  assert.ok(!('deviceNumber' in C.component(ID, c3, 'HIGH').body));
  const c2 = { componentType: 'CIRCULATION_PUMP', port: '0', value: 'OFF', availableValues: ['LOW', 'HIGH'] };
  assert.equal(C.component(ID, c2, 'OFF').body.state, 'OFF');
  assert.throws(() => C.component(ID, c2, 'MED'), /non disponible/);
  assert.equal(C.nextState(c3), 'LOW');
  assert.equal(C.nextState(Object.assign({}, c3, { value: 'LOW' })), 'HIGH');
  assert.equal(C.nextState(Object.assign({}, c3, { value: 'HIGH' })), 'OFF');
  const c1 = { componentType: 'CIRCULATION_PUMP', value: 'OFF', availableValues: ['OFF', 'HIGH'] };
  assert.equal(C.nextState(c1), 'HIGH'); assert.equal(C.nextState(Object.assign({}, c1, { value: 'HIGH' })), 'OFF');
});

test('component: pompe ON => HIGH, LOW/MED refusés si absents', () => {
  const p = { componentType: 'PUMP', port: 0, availableValues: ['OFF', 'HIGH'] };
  assert.equal(C.component(ID, p, 'ON').body.state, 'HIGH');
  assert.throws(() => C.component(ID, p, 'LOW'), /non disponible/);
  assert.throws(() => C.component(ID, p, 'MED'), /non disponible/);
});

test('component: OFF toujours accepté pour une pompe (essai réel), pas pour les autres composants', () => {
  const p = { componentType: 'PUMP', port: 0, availableValues: ['LOW', 'HIGH'] };
  assert.deepEqual(C.component(ID, p, 'OFF'), B('/component-state', { componentType: 'jet', state: 'OFF', deviceNumber: 0 }));
  assert.equal(C.component(ID, p, 'LOW').body.state, 'LOW');
  for (const t of ['LIGHT', 'BLOWER', 'MISTER', 'AUX']) assert.throws(() => C.component(ID, { componentType: t, port: 0, availableValues: ['ON'] }, 'OFF'), /non disponible/);
  assert.throws(() => C.component(ID, p, 'MED'), /non disponible/);
});

test('component: erreurs (type, valeur, DISABLED, port)', () => {
  for (const t of ['FILTER', 'GATEWAY', 'CONTROLLER', 'HEATER']) assert.throws(() => C.component(ID, { componentType: t, availableValues: ['ON'] }, 'ON'), /ne se pilote pas/);
  assert.throws(() => C.component(ID, pump, 'MED'), /non disponible/);
  assert.throws(() => C.component(ID, { componentType: 'LIGHT', port: 0, availableValues: ['OFF', 'DISABLED'] }, 'DISABLED'), /non disponible/);
  assert.throws(() => C.component(ID, { componentType: 'PUMP', port: null, availableValues: ['OFF'] }, 'OFF'), /Port manquant/);
  assert.throws(() => C.component('', pump, 'OFF'), /Identifiant/);
});

test('nextState: 3 listes', () => {
  const n = (av, value) => C.nextState({ availableValues: av, value });
  assert.equal(n(['OFF', 'HIGH'], 'OFF'), 'HIGH');
  assert.equal(n(['OFF', 'HIGH'], 'HIGH'), 'OFF');
  assert.equal(n(['OFF', 'LOW', 'HIGH'], 'OFF'), 'LOW');
  assert.equal(n(['OFF', 'LOW', 'HIGH'], 'LOW'), 'HIGH');
  assert.equal(n(['OFF', 'LOW', 'HIGH'], 'HIGH'), 'OFF');
  assert.equal(n(['DISABLED', 'ON', 'OFF'], 'OFF'), 'ON');
  assert.equal(n(['OFF', 'LOW', 'MED', 'HIGH'], 'MED'), 'HIGH');
  const pn = (av, value) => C.nextState({ componentType: 'PUMP', availableValues: av, value });
  assert.equal(pn(['LOW', 'HIGH'], 'OFF'), 'LOW'); // pompe sans OFF listé : cycle complet
  assert.equal(pn(['LOW', 'HIGH'], 'LOW'), 'HIGH');
  assert.equal(pn(['LOW', 'HIGH'], 'HIGH'), 'OFF');
  assert.equal(pn(['HIGH'], 'OFF'), 'HIGH'); // sinon le plus faible niveau
  assert.equal(pn(['OFF', 'LOW', 'HIGH'], 'OFF'), 'LOW');
  assert.throws(() => C.nextState({ availableValues: ['DISABLED'], value: 'DISABLED' }), /suivant/);
});

test('temperature: arrondi 0,5 et conversion °F', () => {
  const s = st({ tempRange: 'LOW' });
  assert.deepEqual(C.temperature(ID, 10.5, s), B('/temperature/value', { value: 51 }));
  assert.equal(C.temperature(ID, 10, s).body.value, 50);
  assert.equal(C.temperature(ID, 37, s).body.value, 99);
  assert.equal(C.temperature(ID, 36.8, s).body.value, 98); // 98,24 °F -> 98
  assert.equal(C.temperature(ID, 13, s).body.value, 55);
  assert.ok(Number.isInteger(C.temperature(ID, 22.3, s).body.value)); // toujours un entier
  assert.deepEqual(C.temperatureF(ID, 51, s), B('/temperature/value', { value: 51 }));
  for (const bad of [50.5, '51', NaN, null, Infinity]) assert.throws(() => C.temperatureF(ID, bad, s), /entier/);
});

test('temperature: plage active, °F du boîtier, erreurs', () => {
  assert.throws(() => C.temperature(ID, 9, st({ tempRange: 'LOW' })), /hors plage \(50–99 °F\)/);
  assert.throws(() => C.temperature(ID, 26, st()), /hors plage \(80–104 °F\)/);
  assert.throws(() => C.temperature(ID, 38, st({ tempRange: 'LOW' })), /hors plage/); // 100 °F > 99
  assert.throws(() => C.temperature(ID, 37.5, st({ tempRange: 'LOW' })), /hors plage/); // 99,5 °F -> 100 > 99
  assert.equal(C.temperature(ID, 40, st()).body.value, 104);
  assert.throws(() => C.temperatureF(ID, 105, st({ setupParams: { highRangeLow: 80, highRangeHigh: 110 } })), /limite absolue/);
  // plafond absolu 10-40 °C même si les bornes annoncent plus large
  const wide = st({ tempRange: 'LOW', setupParams: { lowRangeLow: 33, lowRangeHigh: 139 } });
  assert.throws(() => C.temperature(ID, 5, wide), /limite absolue/);
  assert.throws(() => C.temperature(ID, 45, wide), /limite absolue/);
  assert.equal(C.temperature(ID, 20, wide).body.value, 68);
  assert.throws(() => C.temperatureF(ID, 49, st({ tempRange: 'LOW', setupParams: { lowRangeLow: 33, lowRangeHigh: 139 } })), /limite absolue/);
  assert.equal(C.temperature(ID, 26, st({ tempRange: 'LOW' })).body.value, 79);
  const f = st({ celsius: false, tempRange: 'LOW', setupParams: { lowRangeLow: 50, lowRangeHigh: 99 } });
  assert.equal(C.temperature(ID, 10, f).body.value, 50);
  assert.equal(C.temperature(ID, 37, f).body.value, 99);
  assert.throws(() => C.temperature(ID, 38, f), /hors plage/);
  for (const bad of [NaN, Infinity, '38', null]) assert.throws(() => C.temperature(ID, bad, st()), /invalide/);
  assert.throws(() => C.temperature(ID, 30, st({ setupParams: {} })), /inconnue/);
});

test('mode, plage, panneau, échelle, filtre 2', () => {
  assert.deepEqual(C.heaterMode(ID, 'READY_REST'), B('/temperature/heater-mode', { mode: 'READY_REST' }));
  assert.throws(() => C.heaterMode(ID, 'ECO'), /invalide/);
  assert.deepEqual(C.range(ID, 'LOW'), B('/temperature/range', { range: 'LOW' }));
  assert.throws(() => C.range(ID, 'MID'), /invalide/);
  assert.deepEqual(C.panel(ID, true), B('/panel/state', { state: 'LOCK_PANEL' }));
  assert.equal(C.panel(ID, false).body.state, 'UNLOCK_PANEL');
  assert.throws(() => C.panel(ID, 'yes'), /booléen/);
  assert.deepEqual(C.scale(ID, 'FAHRENHEIT'), B('/temperature/scale', { scale: 'FAHRENHEIT' }));
  assert.throws(() => C.scale(ID, 'KELVIN'), /invalide/);
  assert.deepEqual(C.filter2(ID, true), B('/filter-cycles/toggle-filter2-state', { state: 'ON' }));
  assert.equal(C.filter2(ID, false).body.state, 'OFF');
});

test('timeFormat: HH:MM, heure absente', () => {
  const r = C.timeFormat(ID, st(), true);
  assert.deepEqual(r, B('/time', { time: '07:05', isMilitaryFormat: true }));
  assert.throws(() => C.timeFormat(ID, st({ hour: null }), true), /Heure/);
  assert.throws(() => C.timeFormat(ID, st({ minute: undefined }), false), /Heure/);
});

test('filterCycle: corps, validations', () => {
  const f = { componentType: 'FILTER', port: '1' };
  assert.deepEqual(C.filterCycle(ID, f, '08:30', 2), B('/filter-cycles/schedule', { deviceNumber: 1, numOfIntervals: 8, time: '08:30' }));
  assert.equal(C.filterCycle(ID, { componentType: 'FILTER', port: 0 }, '00:00', 0.25).body.numOfIntervals, 1);
  assert.equal(C.filterCycle(ID, f, '23:59', 24).body.numOfIntervals, 96);
  assert.throws(() => C.filterCycle(ID, f, '8:30', 2), /HH:MM/);
  assert.throws(() => C.filterCycle(ID, f, '24:00', 2), /HH:MM/);
  assert.throws(() => C.filterCycle(ID, f, '08:30', 0), /Durée/);
  assert.throws(() => C.filterCycle(ID, f, '08:30', 25), /Durée/);
  assert.throws(() => C.filterCycle(ID, { componentType: 'FILTER' }, '08:30', 2), /Port/);
  assert.throws(() => C.filterCycle(ID, pump, '08:30', 2), /filtre/);
});

test('allOff: seulement les équipements actifs, jamais circulation (pilotable seule)/ozone/filtre/heater', () => {
  const s = st({ components: [
    { componentType: 'PUMP', port: '0', value: 'HIGH', availableValues: ['OFF', 'HIGH'] },
    { componentType: 'PUMP', port: '1', value: 'OFF', availableValues: ['OFF', 'HIGH'] },
    { componentType: 'LIGHT', port: 0, value: 'ON', availableValues: ['OFF', 'ON'] },
    { componentType: 'BLOWER', port: 0, value: 'DISABLED', availableValues: ['DISABLED'] },
    { componentType: 'MICROSILK', value: 'ON', availableValues: ['OFF', 'ON'] },
    { componentType: 'CIRCULATION_PUMP', port: '0', value: 'ON', availableValues: ['OFF', 'ON'] },
    { componentType: 'OZONE', value: 'ON', availableValues: ['OFF', 'ON'] },
    { componentType: 'FILTER', port: '1', value: 'ON', availableValues: ['OFF', 'ON'] },
    { componentType: 'HEATER', value: 'ON', availableValues: ['OFF', 'ON'] }
  ] });
  const r = C.allOff(ID, s);
  assert.deepEqual(r.requests.map(x => x.body.componentType), ['jet', 'light', 'microsilk']);
  assert.ok(r.requests.every(x => x.body.state === 'OFF'));
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(C.allOff(ID, st({ components: [{ componentType: 'PUMP', port: 0, value: 'OFF', availableValues: ['OFF'] }] })), { requests: [], skipped: [] });
  assert.deepEqual(C.allOff(ID, null), { requests: [], skipped: [] });
});

test('allOff: spa B, composant allumé sans OFF / sans port / en double => sauté, pas d\'exception', () => {
  const s = st({ components: [
    { componentType: 'BLOWER', port: '0', value: 'HIGH', availableValues: ['HIGH'] }, // pas de OFF (hors pompe)
    { componentType: 'PUMP', port: '1', value: 'HIGH', availableValues: ['OFF', 'LOW', 'HIGH'] },
    { componentType: 'PUMP', port: null, value: 'LOW', availableValues: ['OFF', 'LOW', 'HIGH'] }, // port manquant
    { componentType: 'LIGHT', port: '0', value: 'ON', availableValues: ['OFF', 'ON'] },
    { componentType: 'LIGHT', port: '0', value: 'ON', availableValues: ['OFF', 'ON'] } // même port
  ] });
  const r = C.allOff(ID, s, c => 'N' + c.componentType);
  assert.deepEqual(r.requests.map(x => x.body.deviceNumber), [1]);
  assert.equal(r.requests[0].comp, s.components[1]);
  assert.equal(r.skipped.length, 4);
  assert.match(r.skipped[0].reason, /pas d'état Éteint/);
  assert.equal(r.skipped[0].label, 'NBLOWER');
  assert.match(r.skipped[1].reason, /port manquant/);
  assert.match(r.skipped[2].reason, /ambigu/);
  assert.throws(() => C.allOff('', s), /Identifiant/);
});

test('allOff: une pompe LOW/HIGH sans OFF est éteinte avec OFF', () => {
  const s = st({ components: [{ componentType: 'PUMP', port: 0, value: 'HIGH', availableValues: ['LOW', 'HIGH'] }] });
  const r = C.allOff(ID, s);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.requests.map(x => [x.body.componentType, x.body.state, x.body.deviceNumber]), [['jet', 'OFF', 0]]);
});

test('guard: hors ligne, absent, panelLock non bloquant', () => {
  assert.deepEqual(C.guard(st()), { ok: true, reason: null });
  assert.deepEqual(C.guard(st({ online: false })), { ok: false, reason: 'spa hors ligne' });
  assert.equal(C.guard(null).ok, false);
  assert.equal(C.guard(st({ panelLock: true })).ok, true);
});
