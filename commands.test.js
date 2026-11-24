const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./commands.js');

const ID = 'spa-test-1';
const B = (path, extra) => ({ path, body: Object.assign({ spaId: ID, via: 'WEB' }, extra) });
const pump = { componentType: 'PUMP', port: '1', value: 'OFF', availableValues: ['OFF', 'LOW', 'HIGH'] };
const st = (o) => Object.assign({
  online: true, celsius: true, tempRange: 'HIGH', hour: 7, minute: 5,
  setupParams: { lowRangeLow: 10, lowRangeHigh: 37, highRangeLow: 27, highRangeHigh: 40 }, components: []
}, o);

test('component: URL et corps exacts', () => {
  assert.deepEqual(C.component(ID, pump, 'LOW'), B('/component-state', { componentType: 'jet', state: 'LOW', deviceNumber: 1 }));
  const light = { componentType: 'LIGHT', port: 0, availableValues: ['OFF', 'ON'] };
  assert.deepEqual(C.component(ID, light, 'ON'), B('/component-state', { componentType: 'light', state: 'ON', deviceNumber: 0 }));
  const circ = { componentType: 'CIRCULATION_PUMP', port: '0', availableValues: ['OFF', 'ON'] };
  assert.deepEqual(C.component(ID, circ, 'OFF'), B('/component-state', { componentType: 'circ-pump', state: 'OFF' }));
  assert.equal(C.component(ID, { componentType: 'OZONE', availableValues: ['OFF', 'ON'] }, 'ON').body.componentType, 'ozone');
});

test('component: pompe ON => HIGH, LOW/MED refusés si absents', () => {
  const p = { componentType: 'PUMP', port: 0, availableValues: ['OFF', 'HIGH'] };
  assert.equal(C.component(ID, p, 'ON').body.state, 'HIGH');
  assert.throws(() => C.component(ID, p, 'LOW'), /non disponible/);
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
  assert.throws(() => C.nextState({ availableValues: ['DISABLED'], value: 'DISABLED' }), /suivant/);
});

test('temperature: arrondi 0,5 et conversion °F', () => {
  const s = st({ tempRange: 'LOW' });
  assert.deepEqual(C.temperature(ID, 10.5, s), B('/temperature/value', { value: 50.9 }));
  assert.equal(C.temperature(ID, 10, s).body.value, 50);
  assert.equal(C.temperature(ID, 37, s).body.value, 98.6);
  assert.equal(C.temperature(ID, 36.8, s).body.value, 98.6); // 36.8 -> 37.0
  assert.equal(C.temperature(ID, 36.7, s).body.value, 97.7); // 36.7 -> 36.5
});

test('temperature: plage active, °F du boîtier, erreurs', () => {
  assert.throws(() => C.temperature(ID, 9, st({ tempRange: 'LOW' })), /hors plage \(10–37 °C\)/);
  assert.throws(() => C.temperature(ID, 26, st()), /hors plage \(27–40 °C\)/);
  assert.equal(C.temperature(ID, 26, st({ tempRange: 'LOW' })).body.value, 78.8);
  const f = st({ celsius: false, tempRange: 'LOW', setupParams: { lowRangeLow: 50, lowRangeHigh: 99 } });
  assert.equal(C.temperature(ID, 10, f).body.value, 50);
  assert.equal(C.temperature(ID, 37, f).body.value, 98.6);
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

test('timeFormat: HH:MM, unverified, heure absente', () => {
  const r = C.timeFormat(ID, st(), true);
  assert.deepEqual(r, Object.assign(B('/time', { time: '07:05', isMilitaryFormat: true }), { unverified: true }));
  assert.throws(() => C.timeFormat(ID, st({ hour: null }), true), /Heure/);
  assert.throws(() => C.timeFormat(ID, st({ minute: undefined }), false), /Heure/);
});

test('filterCycle: corps, unverified, validations', () => {
  const f = { componentType: 'FILTER', port: '1' };
  assert.deepEqual(C.filterCycle(ID, f, '08:30', 2), Object.assign(B('/filter-cycles/schedule', { deviceNumber: 1, numOfIntervals: 8, time: '08:30' }), { unverified: true }));
  assert.equal(C.filterCycle(ID, { componentType: 'FILTER', port: 0 }, '00:00', 0.25).body.numOfIntervals, 1);
  assert.equal(C.filterCycle(ID, f, '23:59', 24).body.numOfIntervals, 96);
  assert.throws(() => C.filterCycle(ID, f, '8:30', 2), /HH:MM/);
  assert.throws(() => C.filterCycle(ID, f, '24:00', 2), /HH:MM/);
  assert.throws(() => C.filterCycle(ID, f, '08:30', 0), /Durée/);
  assert.throws(() => C.filterCycle(ID, f, '08:30', 25), /Durée/);
  assert.throws(() => C.filterCycle(ID, { componentType: 'FILTER' }, '08:30', 2), /Port/);
  assert.throws(() => C.filterCycle(ID, pump, '08:30', 2), /filtre/);
});

test('allOff: seulement les équipements actifs, jamais circ/ozone/filtre/heater', () => {
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
  assert.deepEqual(r.map(x => x.body.componentType), ['jet', 'light', 'microsilk']);
  assert.ok(r.every(x => x.body.state === 'OFF'));
  assert.deepEqual(C.allOff(ID, st({ components: [{ componentType: 'PUMP', port: 0, value: 'OFF', availableValues: ['OFF'] }] })), []);
  assert.deepEqual(C.allOff(ID, null), []);
});

test('guard: hors ligne, absent, panelLock non bloquant', () => {
  assert.deepEqual(C.guard(st()), { ok: true, reason: null });
  assert.deepEqual(C.guard(st({ online: false })), { ok: false, reason: 'spa hors ligne' });
  assert.equal(C.guard(null).ok, false);
  assert.equal(C.guard(st({ panelLock: true })).ok, true);
});
